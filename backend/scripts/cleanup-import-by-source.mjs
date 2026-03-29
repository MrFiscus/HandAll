/**
 * Dev/admin: remove all tasks (and related planning/cache rows) tied to a calendar source_url.
 * Mirrors server.js DELETE /api/tasks/source behavior.
 *
 * Usage:
 *   node scripts/cleanup-import-by-source.mjs --user-id 2 --url "file://fake_cs_student_2_weeks_cst_reduced.ics"
 *   node scripts/cleanup-import-by-source.mjs --dry-run --user-id 2 --url "file://fake_cs_student_2_weeks_cst_reduced.ics"
 *
 * Optional: --pattern "%fake_%" with --like (uses LIKE on source_url/planner_source_url instead of exact url)
 */

import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '..', 'handall.db');

function assignmentKeyForRow(task) {
  if (task?.external_id && String(task.external_id).trim()) return String(task.external_id).trim();
  return `handall-db-${task.id}`;
}

function parseArgs(argv) {
  const out = { dryRun: false, userId: null, url: null, like: false, pattern: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--like') out.like = true;
    else if (a === '--user-id') out.userId = Number(argv[++i]);
    else if (a === '--url') out.url = argv[++i];
    else if (a === '--pattern') out.pattern = argv[++i];
  }
  return out;
}

async function listUsersWithMatchingTasks(db, pattern, useLike) {
  const q = useLike
    ? `SELECT DISTINCT user_id FROM tasks WHERE source_url LIKE ? OR planner_source_url LIKE ?`
    : `SELECT DISTINCT user_id FROM tasks WHERE source_url = ? OR planner_source_url = ?`;
  const p = useLike ? [pattern, pattern] : [pattern, pattern];
  const rows = await db.all(q, ...p);
  return rows.map((r) => Number(r.user_id)).filter(Number.isFinite);
}

async function cleanupExactSourceForUser(db, userId, sourceUrl, dryRun) {
  const sourcedTasks = await db.all(
    `SELECT id, external_id, type, title, start_time, source_url
     FROM tasks
     WHERE user_id = ?
       AND (source_url = ? OR planner_source_url = ?)`,
    userId,
    sourceUrl,
    sourceUrl,
  );

  const matchedTasks = [...sourcedTasks];
  const seenTaskIds = new Set(sourcedTasks.map((t) => Number(t.id)));

  if (matchedTasks.length === 0) {
    const importRows = await db.all(
      `SELECT payload_json FROM calendar_imports WHERE user_id = ? AND source_url = ? ORDER BY created_at DESC, id DESC`,
      userId,
      sourceUrl,
    );
    for (const row of importRows) {
      let payload;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        continue;
      }
      const importedEvents = Array.isArray(payload?.events) ? payload.events : [];
      for (const event of importedEvents) {
        const externalId = event?.id != null ? String(event.id) : '';
        const title = event?.title != null ? String(event.title) : '';
        const start = event?.start != null ? String(event.start) : '';
        if (!externalId && (!title || !start)) continue;
        const task = await db.get(
          `SELECT id, external_id, type, title, start_time, source_url FROM tasks
           WHERE user_id = ? AND (external_id = ? OR (title = ? AND start_time = ?))
           ORDER BY id DESC LIMIT 1`,
          userId,
          externalId,
          title,
          start,
        );
        if (task && !seenTaskIds.has(Number(task.id))) {
          seenTaskIds.add(Number(task.id));
          matchedTasks.push(task);
        }
      }
    }
  }

  const assignmentRows = matchedTasks.filter((t) => String(t.type || '').toLowerCase() === 'assignment');
  const allAssignmentKeys = [
    ...new Set(assignmentRows.map((task) => assignmentKeyForRow(task))),
  ];

  const externalKeysForCache = [
    ...new Set(matchedTasks.map((t) => (t.external_id ? String(t.external_id).trim() : '')).filter(Boolean)),
  ];

  const sourcedTaskIds = matchedTasks.map((t) => Number(t.id)).filter(Number.isFinite);

  const report = {
    userId,
    sourceUrl,
    taskIds: sourcedTaskIds,
    assignmentKeys: allAssignmentKeys,
    tasksPreview: matchedTasks.map((t) => ({
      id: t.id,
      type: t.type,
      title: (t.title || '').slice(0, 80),
    })),
  };

  if (dryRun) {
    return { deleted: false, report };
  }

  if (allAssignmentKeys.length > 0) {
    const ph = allAssignmentKeys.map(() => '?').join(', ');
    await db.run(
      `DELETE FROM ai_planning_items WHERE user_id = ? AND assignment_external_id IN (${ph})`,
      userId,
      ...allAssignmentKeys,
    );
    await db.run(
      `DELETE FROM ai_cache_assignment WHERE user_id = ? AND assignment_key IN (${ph})`,
      userId,
      ...allAssignmentKeys,
    );
  }

  if (externalKeysForCache.length > 0) {
    const ph = externalKeysForCache.map(() => '?').join(', ');
    await db.run(`DELETE FROM ai_cache_event_class WHERE user_id = ? AND external_key IN (${ph})`, userId, ...externalKeysForCache);
  }

  if (allAssignmentKeys.length > 0) {
    const derivedTaskConditions = allAssignmentKeys.map(() => '(external_id = ? OR external_id LIKE ? OR external_id LIKE ?)').join(' OR ');
    await db.run(
      `DELETE FROM tasks WHERE user_id = ? AND lower(type) = 'working' AND (${derivedTaskConditions})`,
      userId,
      ...allAssignmentKeys.flatMap((key) => [key, `${key}-working-%`, `${key}-sub-%`]),
    );
  }

  if (sourcedTaskIds.length > 0) {
    const idPh = sourcedTaskIds.map(() => '?').join(', ');
    await db.run(`DELETE FROM tasks WHERE user_id = ? AND id IN (${idPh})`, userId, ...sourcedTaskIds);
  }

  await db.run(
    'DELETE FROM tasks WHERE user_id = ? AND (source_url = ? OR planner_source_url = ?)',
    userId,
    sourceUrl,
    sourceUrl,
  );
  await db.run('DELETE FROM calendar_imports WHERE user_id = ? AND source_url = ?', userId, sourceUrl);
  await db.run('DELETE FROM calendar_sources WHERE user_id = ? AND url = ?', userId, sourceUrl);

  return { deleted: true, report };
}

/**
 * Same cascade as exact URL, but matches tasks/imports/sources with SQL LIKE.
 * Use for patterns e.g. %fake_cs_student% (be careful — test with --dry-run first).
 */
async function cleanupLikePatternForUser(db, userId, pattern, dryRun) {
  const sourcedTasks = await db.all(
    `SELECT id, external_id, type, title, start_time, source_url
     FROM tasks
     WHERE user_id = ?
       AND (source_url LIKE ? OR planner_source_url LIKE ?)`,
    userId,
    pattern,
    pattern,
  );

  const matchedTasks = [...sourcedTasks];
  const assignmentRows = matchedTasks.filter((t) => String(t.type || '').toLowerCase() === 'assignment');
  const allAssignmentKeys = [...new Set(assignmentRows.map((task) => assignmentKeyForRow(task)))];

  const externalKeysForCache = [
    ...new Set(matchedTasks.map((t) => (t.external_id ? String(t.external_id).trim() : '')).filter(Boolean)),
  ];

  const sourcedTaskIds = matchedTasks.map((t) => Number(t.id)).filter(Number.isFinite);

  const report = {
    userId,
    pattern,
    taskIds: sourcedTaskIds,
    assignmentKeys: allAssignmentKeys,
    tasksPreview: matchedTasks.map((t) => ({
      id: t.id,
      type: t.type,
      title: (t.title || '').slice(0, 80),
    })),
  };

  if (dryRun) {
    return { deleted: false, report };
  }

  if (allAssignmentKeys.length > 0) {
    const ph = allAssignmentKeys.map(() => '?').join(', ');
    await db.run(
      `DELETE FROM ai_planning_items WHERE user_id = ? AND assignment_external_id IN (${ph})`,
      userId,
      ...allAssignmentKeys,
    );
    await db.run(
      `DELETE FROM ai_cache_assignment WHERE user_id = ? AND assignment_key IN (${ph})`,
      userId,
      ...allAssignmentKeys,
    );
  }

  if (externalKeysForCache.length > 0) {
    const ph = externalKeysForCache.map(() => '?').join(', ');
    await db.run(`DELETE FROM ai_cache_event_class WHERE user_id = ? AND external_key IN (${ph})`, userId, ...externalKeysForCache);
  }

  if (allAssignmentKeys.length > 0) {
    const derivedTaskConditions = allAssignmentKeys.map(() => '(external_id = ? OR external_id LIKE ? OR external_id LIKE ?)').join(' OR ');
    await db.run(
      `DELETE FROM tasks WHERE user_id = ? AND lower(type) = 'working' AND (${derivedTaskConditions})`,
      userId,
      ...allAssignmentKeys.flatMap((key) => [key, `${key}-working-%`, `${key}-sub-%`]),
    );
  }

  if (sourcedTaskIds.length > 0) {
    const idPh = sourcedTaskIds.map(() => '?').join(', ');
    await db.run(`DELETE FROM tasks WHERE user_id = ? AND id IN (${idPh})`, userId, ...sourcedTaskIds);
  }

  await db.run(
    'DELETE FROM tasks WHERE user_id = ? AND (source_url LIKE ? OR planner_source_url LIKE ?)',
    userId,
    pattern,
    pattern,
  );
  await db.run('DELETE FROM calendar_imports WHERE user_id = ? AND source_url LIKE ?', userId, pattern);
  await db.run('DELETE FROM calendar_sources WHERE user_id = ? AND url LIKE ?', userId, pattern);

  return { deleted: true, report };
}

async function main() {
  const args = parseArgs(process.argv);
  const useLike = Boolean(args.like && args.pattern);
  if (!args.url && !(useLike && args.pattern)) {
    console.error('Provide --url "file://..." or --like --pattern "%..."');
    process.exit(1);
  }
  if (args.like && !args.pattern) {
    console.error('--like requires --pattern');
    process.exit(1);
  }

  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await db.exec('PRAGMA foreign_keys = ON');

  const sourceToken = useLike ? args.pattern : args.url;

  let userIds = [];
  if (args.userId != null && Number.isFinite(args.userId)) {
    userIds = [args.userId];
  } else {
    userIds = await listUsersWithMatchingTasks(db, sourceToken, useLike);
    if (userIds.length === 0) {
      console.log('No users with matching tasks.');
      await db.close();
      return;
    }
    console.log('Users with matching tasks:', userIds.join(', '));
  }

  const summaries = [];
  for (const uid of userIds) {
    const result = useLike
      ? await cleanupLikePatternForUser(db, uid, args.pattern, args.dryRun)
      : await cleanupExactSourceForUser(db, uid, args.url, args.dryRun);
    summaries.push(result);
    console.log(JSON.stringify(result.report, null, 2));
  }

  if (args.dryRun) {
    console.log('Dry run: no rows deleted.');
  } else {
    console.log('Cleanup finished for', summaries.length, 'user(s).');
  }

  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
