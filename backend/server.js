import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dbPromise } from './src/db.js';
import * as AI from './src/ai.js';
import { fetchGoogleCalendarEvents } from './src/googleCalendar.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvFile = path.join(__dirname, '../.env');
const frontendEnvFile = path.join(__dirname, '../frontend/.env');
const frontendDistDir = path.join(__dirname, '../frontend/dist');
const frontendIndexFile = path.join(frontendDistDir, 'index.html');
const hasFrontendBuild = fs.existsSync(frontendIndexFile);
const calendarImportsDir = path.join(__dirname, 'imports', 'generated');

// Load env: repo root first (shared), then optional frontend/.env (Vite-style names).
dotenv.config({ path: rootEnvFile });
dotenv.config({ path: frontendEnvFile });
dotenv.config(); // cwd fallback (e.g. backend/.env)

const app = express();
const PORT = 3001;

// Supabase JS auth.validateUserToken expects the project URL + anon (publishable) key.
// Support common .env spellings: SUPABASE_ANON_KEY, SUPABASE_KEY, VITE_SUPABASE_*.
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  '';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  '';

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

app.use(cors());
app.use(bodyParser.json());

if (hasFrontendBuild) {
  app.use(express.static(frontendDistDir));
}

fs.mkdirSync(calendarImportsDir, { recursive: true });

const PLANNER_URL = (process.env.HANDALL_PLANNER_URL || 'http://127.0.0.1:8011').replace(/\/$/, '');

// Helper to get DB
const getDB = () => dbPromise;

function parseSideGoalsJson(raw) {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((g) => typeof g === 'string' && g.trim());
  } catch {
    return [];
  }
}

function shapeUserForApi(user, calendarUrls) {
  if (!user) return user;
  let sideGoals = parseSideGoalsJson(user.side_goals_json);
  if (sideGoals.length === 0 && user.side_goal && String(user.side_goal).trim()) {
    sideGoals = [String(user.side_goal).trim()];
  }
  const motivation = Number.isFinite(Number(user.motivation))
    ? Math.max(0, Math.min(100, Number(user.motivation)))
    : 50;
  return {
    ...user,
    calendar_urls: calendarUrls,
    side_goals: sideGoals,
    side_goal: sideGoals[0] ?? '',
    motivation,
  };
}

async function getUserWithCalendarSources(localUserId) {
  const db = await getDB();
  const user = await db.get('SELECT * FROM users WHERE id = ?', localUserId);
  const calendarSources = await db.all(
    'SELECT url FROM calendar_sources WHERE user_id = ? ORDER BY id ASC',
    localUserId
  );
  const urls = calendarSources.map((source) => source.url);
  return shapeUserForApi(user, urls);
}

function sideGoalsListFromUserRow(user) {
  if (!user) return [];
  const fromJson = parseSideGoalsJson(user.side_goals_json);
  if (fromJson.length) return fromJson;
  if (user.side_goal && String(user.side_goal).trim()) return [String(user.side_goal).trim()];
  return [];
}

async function getOrCreateLocalUser(authUser) {
  const db = await getDB();
  console.log('Fetching/Creating user for auth_id:', authUser.id);

  let user = await db.get('SELECT * FROM users WHERE auth_user_id = ?', authUser.id);

  if (!user) {
    const username = authUser.email || authUser.user_metadata?.full_name || 'Student';
    console.log('Creating new user:', username);
    const result = await db.run(
      'INSERT INTO users (auth_user_id, username, xp, level) VALUES (?, ?, 0, 0)',
      authUser.id,
      username
    );
    // sqlite/sqlite3 promise wrappers sometimes omit lastID; never trust it alone.
    const lastId = result?.lastID ?? result?.lastInsertRowid;
    if (lastId != null && Number.isFinite(Number(lastId))) {
      user = await db.get('SELECT * FROM users WHERE id = ?', Number(lastId));
    }
    if (!user) {
      user = await db.get('SELECT * FROM users WHERE auth_user_id = ?', authUser.id);
    }
  }

  return user;
}

async function requireAuth(req, res, next) {
  if (!supabase) {
    console.error('Supabase not configured');
    return res.status(500).json({ error: 'Supabase is not configured on the server' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      console.error('Auth error:', error);
      return res.status(401).json({ error: 'Invalid or expired auth token' });
    }

    req.authUser = data.user;
    req.localUser = await getOrCreateLocalUser(data.user);
    if (!req.localUser?.id) {
      console.error('No local user row after getOrCreate for auth id:', data.user.id);
      return res.status(500).json({ error: 'Failed to load or create your profile' });
    }
    next();
  } catch (err) {
    console.error('Server auth error:', err);
    res.status(500).json({ error: 'Internal server error during auth' });
  }
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/public/config', (req, res) => {
  res.json({
    supabaseUrl: SUPABASE_URL || '',
    supabaseAnonKey: SUPABASE_ANON_KEY || ''
  });
});

app.use('/api', requireAuth);

app.get('/api/google-calendar/events', async (req, res) => {
  const start = typeof req.query.start === 'string' ? req.query.start : null;
  const end = typeof req.query.end === 'string' ? req.query.end : null;
  const calendarId = typeof req.query.calendarId === 'string' ? req.query.calendarId : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const maxResults = typeof req.query.maxResults === 'string' ? Number.parseInt(req.query.maxResults, 10) : undefined;

  if (!start || !end) {
    return res.status(400).json({ error: 'Missing required start or end query parameter' });
  }

  const startDate = new Date(start);
  const endDate = new Date(end);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return res.status(400).json({ error: 'Invalid start or end date' });
  }

  if (endDate <= startDate) {
    return res.status(400).json({ error: 'The end date must be after the start date' });
  }

  try {
    const result = await fetchGoogleCalendarEvents({
      calendarId,
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      maxResults: Number.isFinite(maxResults) ? Math.min(maxResults, 1000) : 250,
      q,
    });

    res.json({
      success: true,
      ...result,
      range: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    });
  } catch (error) {
    console.error('Google Calendar import error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch Google Calendar events',
    });
  }
});

app.post('/api/calendar-imports', async (req, res) => {
  const { sourceUrl, importType, events, tasks } = req.body;

  if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) {
    return res.status(400).json({ error: 'sourceUrl is required' });
  }

  if (!Array.isArray(events) || !Array.isArray(tasks)) {
    return res.status(400).json({ error: 'events and tasks arrays are required' });
  }

  try {
    const db = await getDB();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeSource = sourceUrl
      .replace(/^file:\/\//, '')
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'calendar-import';
    const fileName = `${timestamp}-${safeSource}.json`;
    const relativePath = path.join('backend', 'imports', 'generated', fileName);
    const absolutePath = path.join(calendarImportsDir, fileName);

    const payload = {
      sourceUrl,
      importType: typeof importType === 'string' ? importType : 'ical',
      importedAt: new Date().toISOString(),
      eventCount: events.length,
      events,
      tasks,
    };

    fs.writeFileSync(absolutePath, JSON.stringify(payload, null, 2), 'utf8');

    const result = await db.run(
      `INSERT INTO calendar_imports (user_id, source_url, import_type, event_count, file_path, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      req.localUser.id,
      sourceUrl,
      payload.importType,
      events.length,
      relativePath,
      JSON.stringify(payload)
    );

    res.json({
      success: true,
      importId: result.lastID,
      filePath: relativePath,
    });
  } catch (error) {
    console.error('Calendar import persistence error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to persist calendar import',
    });
  }
});

// --- User Profile Endpoints ---
app.get('/api/user', async (req, res) => {
  const user = await getUserWithCalendarSources(req.localUser.id);
  res.json(user || req.localUser);
});

app.post('/api/user/setup', async (req, res) => {
  const { username, wake_time, sleep_time, side_goal, side_goals, motivation, google_calendar_url, calendar_urls } =
    req.body;
  const db = await getDB();
  const uid = req.localUser.id;
  const current = await db.get('SELECT * FROM users WHERE id = ?', uid);
  if (!current) {
    return res.status(404).json({ error: 'User not found' });
  }

  let nextUsername = current.username || 'Student';
  if (typeof username === 'string' && username.trim()) nextUsername = username.trim();

  let nextWake = current.wake_time || '07:00';
  if (typeof wake_time === 'string' && wake_time.trim()) nextWake = wake_time.trim();

  let nextSleep = current.sleep_time || '23:00';
  if (typeof sleep_time === 'string' && sleep_time.trim()) nextSleep = sleep_time.trim();

  let sideGoalsJson = current.side_goals_json || '[]';
  let legacySideGoal = current.side_goal || '';
  if (Array.isArray(side_goals)) {
    const cleaned = side_goals.map((s) => String(s).trim()).filter(Boolean);
    sideGoalsJson = JSON.stringify(cleaned);
    legacySideGoal = cleaned[0] || '';
  } else if (typeof side_goal === 'string') {
    const t = side_goal.trim();
    if (t) {
      sideGoalsJson = JSON.stringify([t]);
      legacySideGoal = t;
    }
  }

  let nextMotivation = Number.isFinite(Number(current.motivation)) ? Number(current.motivation) : 50;
  if (motivation !== undefined && motivation !== null && String(motivation).length > 0) {
    const n = Number(motivation);
    if (Number.isFinite(n)) nextMotivation = Math.max(0, Math.min(100, Math.round(n)));
  }

  const calendarUrls = Array.isArray(calendar_urls)
    ? [...new Set(calendar_urls.filter((url) => typeof url === 'string' && url.trim()).map((url) => url.trim()))]
    : null;
  let nextGcal = current.google_calendar_url || '';
  if (calendarUrls) {
    nextGcal = calendarUrls[0] ?? '';
  } else if (typeof google_calendar_url === 'string') {
    nextGcal = google_calendar_url;
  }

  await db.run(
    `UPDATE users
     SET username = ?, wake_time = ?, sleep_time = ?, side_goal = ?, side_goals_json = ?, motivation = ?, google_calendar_url = ?
     WHERE id = ?`,
    nextUsername,
    nextWake,
    nextSleep,
    legacySideGoal,
    sideGoalsJson,
    nextMotivation,
    nextGcal,
    uid
  );

  if (calendarUrls) {
    await db.run('DELETE FROM calendar_sources WHERE user_id = ?', uid);
    for (const url of calendarUrls) {
      await db.run('INSERT OR IGNORE INTO calendar_sources (user_id, url) VALUES (?, ?)', uid, url);
    }
  }

  const user = await getUserWithCalendarSources(uid);
  res.json({ success: true, user });
});

app.patch('/api/user/motivation', async (req, res) => {
  try {
    const n = Number(req.body?.motivation);
    if (!Number.isFinite(n)) {
      return res.status(400).json({ error: 'motivation must be a number' });
    }
    const m = Math.max(0, Math.min(100, Math.round(n)));
    const db = await getDB();
    await db.run('UPDATE users SET motivation = ? WHERE id = ?', m, req.localUser.id);
    const user = await getUserWithCalendarSources(req.localUser.id);
    res.json({ success: true, user });
  } catch (err) {
    console.error('motivation patch:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update motivation' });
  }
});

function normalizePlannerTaskType(t) {
  const x = String(t || 'working').toLowerCase();
  if (x === 'free') return 'freetime';
  return x;
}

app.post('/api/schedule/rebalance', async (req, res) => {
  try {
    const db = await getDB();
    const uid = req.localUser.id;
    const user = await db.get('SELECT * FROM users WHERE id = ?', uid);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let motivation = Number.isFinite(Number(user.motivation)) ? Number(user.motivation) : 50;
    if (req.body?.motivation !== undefined && req.body?.motivation !== null) {
      const n = Number(req.body.motivation);
      if (Number.isFinite(n)) motivation = Math.max(0, Math.min(100, Math.round(n)));
    }
    await db.run('UPDATE users SET motivation = ? WHERE id = ?', motivation, uid);

    const horizonDays = Math.max(3, Math.min(14, parseInt(String(req.body?.horizon_days), 10) || 7));
    const timezone =
      typeof req.body?.timezone === 'string' && req.body.timezone.trim() ? req.body.timezone.trim() : 'UTC';

    const now = new Date();
    const horizon = new Date(now.getTime() + horizonDays * 86400000);
    const nowIso = now.toISOString();
    const horizonIso = horizon.toISOString();

    const allRows = await db.all(
      `SELECT * FROM tasks WHERE user_id = ? AND end_time >= ? AND start_time <= ? ORDER BY start_time ASC`,
      uid,
      nowIso,
      horizonIso
    );

    const currentEvents = [];
    for (const row of allRows) {
      const rowType = (row.type || 'working').toLowerCase();
      const rowStatus = (row.status || '').toLowerCase();
      if (['working', 'goal', 'freetime', 'free'].includes(rowType) && rowStatus !== 'completed') {
        continue;
      }
      currentEvents.push({
        id: row.external_id || String(row.id),
        title: row.title,
        description: row.description || '',
        start: row.start_time,
        end: row.end_time,
        type: rowType,
        completed: rowStatus === 'completed',
        sourceUrl: row.source_url,
      });
    }

    const sideGoals = sideGoalsListFromUserRow(user);

    const planPayload = {
      user_id: String(uid),
      name: user.username || 'Student',
      timezone,
      wake_time: user.wake_time || '07:00',
      sleep_time: user.sleep_time || '23:00',
      side_goals: sideGoals,
      motivation,
      horizon_days: horizonDays,
      events: currentEvents,
      assignments: [],
    };

    let planRes;
    try {
      planRes = await fetch(`${PLANNER_URL}/plan-week`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(planPayload),
      });
    } catch (netErr) {
      console.error('Planner fetch failed:', netErr);
      const fresh = await getUserWithCalendarSources(uid);
      return res.status(503).json({
        error: 'Planner service unavailable',
        detail: 'Start the Python AI backend on port 8011. Motivation was saved.',
        user: fresh,
      });
    }

    const planData = await planRes.json().catch(() => ({}));
    if (!planRes.ok || !planData.success) {
      const fresh = await getUserWithCalendarSources(uid);
      return res.status(503).json({
        error: planData.error || `Planner returned ${planRes.status}`,
        user: fresh,
      });
    }

    await db.run(
      `DELETE FROM tasks
       WHERE user_id = ?
         AND start_time >= ?
         AND start_time <= ?
         AND lower(type) IN ('working', 'goal', 'freetime', 'free')
         AND lower(COALESCE(status, '')) != 'completed'`,
      uid,
      nowIso,
      horizonIso
    );

    const suggested = planData.suggested_tasks || [];
    for (const task of suggested) {
      const ttype = normalizePlannerTaskType(task.type);
      await db.run(
        `INSERT INTO tasks (user_id, external_id, title, description, start_time, end_time, type, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Accepted')`,
        uid,
        task.id || null,
        task.title,
        task.description || null,
        task.start,
        task.end,
        ttype
      );
    }

    const tasks = await db.all('SELECT * FROM tasks WHERE user_id = ? ORDER BY start_time ASC', uid);
    res.json({
      success: true,
      motivation,
      inserted: suggested.length,
      assignments: planData.assignments || [],
      meta: planData.meta || {},
      tasks: tasks.map((t) => ({
        id: t.external_id || t.id.toString(),
        db_id: t.id,
        title: t.title,
        description: t.description,
        start: t.start_time,
        end: t.end_time,
        type: t.type ? t.type.toLowerCase() : 'working',
        sourceUrl: t.source_url || undefined,
        completed: t.status === 'Completed',
        xpValue: t.type?.toLowerCase() === 'working' ? 50 : t.type?.toLowerCase() === 'goal' ? 30 : 10,
      })),
    });
  } catch (err) {
    console.error('schedule rebalance:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Rebalance failed' });
  }
});

// --- Task Management Endpoints ---
app.get('/api/tasks', async (req, res) => {
  const db = await getDB();
  const tasks = await db.all(
    'SELECT * FROM tasks WHERE user_id = ? ORDER BY start_time ASC',
    req.localUser.id
  );
  
  res.json(tasks.map(t => ({
    id: t.external_id || t.id.toString(),
    db_id: t.id, // Keep the real DB ID too
    title: t.title,
    description: t.description,
    start: t.start_time,
    end: t.end_time,
    type: t.type ? t.type.toLowerCase() : 'working',
    sourceUrl: t.source_url || undefined,
    completed: t.status === 'Completed',
    xpValue: t.type?.toLowerCase() === 'working' ? 50 : (t.type?.toLowerCase() === 'goal' ? 30 : 10)
  })));
});

app.post('/api/tasks/bulk', async (req, res) => {
  const { events } = req.body;
  const db = await getDB();
  console.log(`Bulk upserting ${events.length} events for user ${req.localUser.id}`);
  
  try {
    for (const event of events) {
      // Try matching by external_id first, then fallback to title+start time uniqueness
      const existing = await db.get(
        'SELECT id FROM tasks WHERE user_id = ? AND (external_id = ? OR (external_id IS NULL AND title = ? AND start_time = ?))', 
        req.localUser.id, event.id, event.title, event.start
      );
      
      if (existing) {
          await db.run(
              'UPDATE tasks SET title = ?, description = ?, start_time = ?, end_time = ?, type = ?, status = ?, external_id = ?, source_url = ? WHERE id = ?',
              event.title, event.description || null, event.start, event.end, event.type, event.completed ? 'Completed' : 'Accepted', event.id, event.source_url || null, existing.id
          );
      } else {
          await db.run(
              'INSERT INTO tasks (user_id, external_id, title, description, start_time, end_time, type, source_url, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              req.localUser.id, event.id, event.title, event.description || null, event.start, event.end, event.type, event.source_url || null, event.completed ? 'Completed' : 'Accepted'
          );
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Bulk upsert error:', err);
    res.status(500).json({ error: 'Failed to bulk sync' });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const rawId = req.localUser?.id;
    const localUserId =
      rawId == null ? NaN : typeof rawId === 'bigint' ? Number(rawId) : Number(rawId);
    if (!Number.isFinite(localUserId)) {
      return res.status(500).json({ error: 'User session not bound to a local profile' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const title = body.title != null ? String(body.title).trim() : '';
    const description =
      body.description != null && String(body.description).trim() !== ''
        ? String(body.description).trim()
        : null;
    const start = body.start != null ? String(body.start) : '';
    const end = body.end != null ? String(body.end) : '';
    const type = body.type != null ? String(body.type) : 'assignment';

    if (!title || !start || !end) {
      return res.status(400).json({ error: 'title, start, and end are required' });
    }

    const db = await getDB();
    console.log('Adding task:', title, 'for user:', localUserId);
    const result = await db.run(
      'INSERT INTO tasks (user_id, title, description, start_time, end_time, type, status) VALUES (?, ?, ?, ?, ?, ?, "Accepted")',
      localUserId,
      title,
      description,
      start,
      end,
      type
    );
    const newId = result?.lastID ?? result?.lastInsertRowid;
    console.log('Task added with ID:', newId);
    res.json({ success: true, id: newId });
  } catch (err) {
    console.error('Add task error:', err);
    const message = err instanceof Error ? err.message : 'Failed to add task';
    res.status(500).json({ error: message });
  }
});

app.patch('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const { completed, status } = req.body;
    const db = await getDB();
    
    // id might be external_id or internal_id
    const task = await db.get('SELECT * FROM tasks WHERE user_id = ? AND (id = ? OR external_id = ?)', req.localUser.id, id, id);
    
    if (!task) {
        return res.status(404).json({ error: 'Task not found' });
    }

    if (completed !== undefined) {
        const newStatus = completed ? 'Completed' : 'Accepted';
        await db.run('UPDATE tasks SET status = ? WHERE id = ?', newStatus, task.id);
        
        if (completed) {
            let xpGained = 10;
            if(task.type?.toLowerCase() === 'working') xpGained = 50;
            if(task.type?.toLowerCase() === 'goal') xpGained = 30;

            const user = await db.get('SELECT * FROM users WHERE id = ?', req.localUser.id);
            const newXp = (user.xp || 0) + xpGained;
            const newLevel = Math.floor(newXp / 100);

            await db.run('UPDATE users SET xp = ?, level = ? WHERE id = ?', newXp, newLevel, req.localUser.id);
            return res.json({ success: true, xpGained, newLevel, newXp });
        }
    } else if (status) {
        await db.run('UPDATE tasks SET status = ? WHERE id = ?', status, task.id);
    }
    
    res.json({ success: true });
});

app.delete('/api/tasks/source', async (req, res) => {
  const sourceUrl = typeof req.query.url === 'string' ? req.query.url : null;

  if (!sourceUrl) {
    return res.status(400).json({ error: 'Missing source url' });
  }

  const db = await getDB();
  await db.run(
    'DELETE FROM tasks WHERE user_id = ? AND source_url = ?',
    req.localUser.id,
    sourceUrl
  );
  res.json({ success: true });
});

app.delete('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const db = await getDB();
    await db.run('DELETE FROM tasks WHERE user_id = ? AND (id = ? OR external_id = ?)', req.localUser.id, id, id);
    res.json({ success: true });
});

app.get('*', (req, res) => {
  if (hasFrontendBuild) {
    return res.sendFile(frontendIndexFile);
  }

  res.status(404).json({
    error: 'Frontend build not found',
    message: 'Run `npm --prefix frontend run build` for production, or use the Vite dev server at http://localhost:3000.'
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
