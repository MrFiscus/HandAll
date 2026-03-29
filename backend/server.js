import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dbPromise } from './src/db.js';
import * as AI from './src/ai.js';
import {
  fetchGoogleCalendarEvents,
  fetchGoogleCalendarEventsWithAccessToken,
  fetchGoogleCalendarEventsWithRefreshToken,
} from './src/googleCalendar.js';

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
app.use(bodyParser.json({ limit: '10mb' }));

if (hasFrontendBuild) {
  app.use(express.static(frontendDistDir));
}

fs.mkdirSync(calendarImportsDir, { recursive: true });

const PLANNER_URL = (process.env.HANDALL_PLANNER_URL || 'http://127.0.0.1:8011').replace(/\/$/, '');

async function postPlanner(subPath, body) {
  const res = await fetch(`${PLANNER_URL}${subPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function assignmentExternalKeyForRow(task) {
  if (task?.external_id && String(task.external_id).trim()) return String(task.external_id).trim();
  return `handall-db-${task.id}`;
}

async function loadPlanningItemsForPlanner(db, uid) {
  const rows = await db.all(
    `SELECT * FROM ai_planning_items WHERE user_id = ? ORDER BY item_type, assignment_external_id, sort_order, id`,
    uid,
  );
  const assignment_work_units = [];
  const goal_work_units = [];
  for (const row of rows) {
    if (row.item_type === 'assignment_subtask') {
      assignment_work_units.push({
        id: String(row.id),
        assignment_id: row.assignment_external_id || '',
        assignment_title: row.assignment_title || '',
        title: row.title,
        description: row.description || '',
        estimated_minutes: row.estimated_minutes,
        sort_order: row.sort_order,
        due_iso: row.due_iso,
      });
    } else if (row.item_type === 'goal_task') {
      goal_work_units.push({
        id: String(row.id),
        title: row.title,
        description: row.description || '',
        estimated_minutes: row.estimated_minutes,
        side_goal: row.side_goal || '',
        sort_order: row.sort_order,
      });
    }
  }
  return { assignment_work_units, goal_work_units };
}

// Helper to get DB
const getDB = () => dbPromise;

function mapTaskRowToApi(t) {
  return {
    id: t.external_id || t.id.toString(),
    db_id: t.id,
    title: t.title,
    description: t.description,
    start: t.start_time,
    end: t.end_time,
    type: t.type ? t.type.toLowerCase() : 'working',
    sourceUrl: t.source_url || undefined,
    completed: t.status === 'Completed',
    xpValue:
      t.type?.toLowerCase() === 'working' ? 50 : t.type?.toLowerCase() === 'goal' ? 30 : 10,
  };
}

/** Replace ai_planning_items subtasks for one assignment; avoids duplicates. */
async function replaceAssignmentSubtasks(db, uid, taskRow, rawSubtasks) {
  const key = assignmentExternalKeyForRow(taskRow);
  await db.run(
    'DELETE FROM ai_planning_items WHERE user_id = ? AND item_type = ? AND assignment_external_id = ?',
    uid,
    'assignment_subtask',
    key,
  );
  const inserted = [];
  for (const st of Array.isArray(rawSubtasks) ? rawSubtasks : []) {
    const title = st.title != null ? String(st.title).trim() : '';
    if (!title) continue;
    const em = Number.isFinite(Number(st.estimated_minutes)) ? Math.round(Number(st.estimated_minutes)) : 45;
    const sortOrder = Number.isFinite(Number(st.sort_order)) ? Math.round(Number(st.sort_order)) : inserted.length;
    const desc = st.description != null ? String(st.description) : '';
    const r = await db.run(
      `INSERT INTO ai_planning_items (user_id, item_type, assignment_external_id, assignment_title, side_goal, title, description, estimated_minutes, sort_order, due_iso)
       VALUES (?, 'assignment_subtask', ?, ?, NULL, ?, ?, ?, ?, ?)`,
      uid,
      key,
      taskRow.title,
      title,
      desc || null,
      Math.max(15, Math.min(240, em)),
      sortOrder,
      taskRow.start_time,
    );
    inserted.push({
      id: r.lastID,
      title,
      description: desc,
      estimated_minutes: Math.max(15, Math.min(240, em)),
      sort_order: sortOrder,
      assignment_external_id: key,
    });
  }
  return { assignment_external_id: key, inserted };
}

const BATCH_ASSIGNMENT_BREAKDOWN_SIZE = 10;

async function runBatchAssignmentBreakdown(db, uid, taskRows, motivation) {
  const assignment_keys = [];
  let subtasks_inserted = 0;
  let batches = 0;

  for (let i = 0; i < taskRows.length; i += BATCH_ASSIGNMENT_BREAKDOWN_SIZE) {
    const chunk = taskRows.slice(i, i + BATCH_ASSIGNMENT_BREAKDOWN_SIZE);
    const payload = {
      assignments: chunk.map((row) => ({
        assignment_key: assignmentExternalKeyForRow(row),
        title: row.title,
        description: row.description || '',
        due_date_iso: row.start_time,
      })),
      motivation,
    };

    let plannerRes;
    try {
      plannerRes = await postPlanner('/ai/assignment-subtasks-batch', payload);
    } catch (netErr) {
      console.error('Planner unreachable (batch subtasks):', netErr);
      throw new Error('Planner service unreachable for batch assignment breakdown');
    }
    const { ok, data } = plannerRes;
    if (!ok || !data || data.success === false) {
      throw new Error(
        (data && data.error) || 'Batch assignment breakdown failed',
      );
    }

    const results = Array.isArray(data.results) ? data.results : [];
    batches += 1;
    const byKey = new Map();
    for (const entry of results) {
      if (!entry || entry.assignment_key == null) continue;
      const k = String(entry.assignment_key);
      byKey.set(k, entry.subtasks);
    }

    for (const row of chunk) {
      const key = assignmentExternalKeyForRow(row);
      const raw = byKey.get(key) || [];
      const { inserted } = await replaceAssignmentSubtasks(db, uid, row, raw);
      subtasks_inserted += inserted.length;
      assignment_keys.push(key);
    }
  }

  return { assignment_keys, subtasks_inserted, batches };
}

/**
 * Shared planner rebalance (writes suggested tasks to SQLite).
 * @returns {Promise<{ok:true, data:object}|{ok:false, status:number, error:string, user?:object}>}
 */
async function runScheduleRebalanceCore(db, uid, options = {}) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', uid);
  if (!user) {
    return { ok: false, status: 404, error: 'User not found' };
  }

  let motivation = Number.isFinite(Number(user.motivation)) ? Number(user.motivation) : 50;
  if (options.motivation !== undefined && options.motivation !== null) {
    const n = Number(options.motivation);
    if (Number.isFinite(n)) motivation = Math.max(0, Math.min(100, Math.round(n)));
  }
  await db.run('UPDATE users SET motivation = ? WHERE id = ?', motivation, uid);

  const horizonDays = Math.max(3, Math.min(14, parseInt(String(options.horizon_days), 10) || 7));
  const timezone =
    typeof options.timezone === 'string' && options.timezone.trim()
      ? options.timezone.trim()
      : 'UTC';

  const now = new Date();
  const horizon = new Date(now.getTime() + horizonDays * 86400000);
  const nowIso = now.toISOString();
  const horizonIso = horizon.toISOString();

  const allRows = await db.all(
    `SELECT * FROM tasks WHERE user_id = ? AND end_time >= ? AND start_time <= ? ORDER BY start_time ASC`,
    uid,
    nowIso,
    horizonIso,
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
  const { assignment_work_units, goal_work_units } = await loadPlanningItemsForPlanner(db, uid);

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
    assignment_work_units,
    goal_work_units,
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
    return {
      ok: false,
      status: 503,
      error: 'Planner service unavailable',
      user: fresh,
      detail: 'Start the Python AI backend on port 8011. Motivation was saved.',
    };
  }

  const planData = await planRes.json().catch(() => ({}));
  if (!planRes.ok || !planData.success) {
    const fresh = await getUserWithCalendarSources(uid);
    return {
      ok: false,
      status: 503,
      error: planData.error || `Planner returned ${planRes.status}`,
      user: fresh,
    };
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
    horizonIso,
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
      ttype,
    );
  }

  const tasks = await db.all('SELECT * FROM tasks WHERE user_id = ? ORDER BY start_time ASC', uid);
  return {
    ok: true,
    data: {
      success: true,
      motivation,
      inserted: suggested.length,
      assignments: planData.assignments || [],
      meta: planData.meta || {},
      tasks: tasks.map(mapTaskRowToApi),
    },
  };
}

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
  const shapedUser = shapeUserForApi(user, calendarSources.map((source) => source.url));
  return shapedUser
    ? {
        ...shapedUser,
        google_calendar_connected: !!user?.google_calendar_connected,
      }
    : shapedUser;
}

function sideGoalsListFromUserRow(user) {
  if (!user) return [];
  const fromJson = parseSideGoalsJson(user.side_goals_json);
  if (fromJson.length) return fromJson;
  if (user.side_goal && String(user.side_goal).trim()) return [String(user.side_goal).trim()];
  return [];
}

function buildCalendarSyncRange(start, end) {
  const startDate = start ? new Date(start) : new Date();
  const endDate = end ? new Date(end) : new Date();

  if (!start) {
    startDate.setDate(startDate.getDate() - 7);
  }
  if (!end) {
    endDate.setDate(endDate.getDate() + 90);
  }

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('Invalid start or end date');
  }

  if (endDate <= startDate) {
    throw new Error('The end date must be after the start date');
  }

  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };
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
    const localUser = await getOrCreateLocalUser(data.user);
    if (!localUser?.id) {
      console.error('No local user row after getOrCreate for auth id:', data.user.id);
      return res.status(500).json({ error: 'Failed to load or create your profile' });
    }
    
    // Ensure the ID is a Number (SQLite can return BigInt)
    req.localUser = {
      ...localUser,
      id: typeof localUser.id === 'bigint' ? Number(localUser.id) : Number(localUser.id)
    };
    next();
  } catch (err) {
    console.error('Server auth error:', err);
    res.status(500).json({ error: 'Internal server error during auth' });
  }
}

/**
 * Browser → FastAPI (chat, plan-week, profile/sync, etc.).
 * Dev: Vite proxies /agent-api → 8011. Production (static from Express): this route is required
 * unless the client sets VITE_AGENT_API_URL to an absolute URL.
 */
app.use('/agent-api', async (req, res) => {
  try {
    const rest = (req.originalUrl || '').slice('/agent-api'.length) || '/';
    const pathPart = rest.startsWith('/') ? rest : `/${rest}`;
    const targetUrl = `${PLANNER_URL}${pathPart}`;
    const headers = { Accept: req.headers.accept || 'application/json' };
    if (req.headers['content-type']) {
      headers['Content-Type'] = req.headers['content-type'];
    }
    const init = { method: req.method, headers };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.body !== undefined && req.body !== null) {
        init.body =
          typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        if (!headers['Content-Type']) {
          headers['Content-Type'] = 'application/json';
        }
      }
    }
    const fr = await fetch(targetUrl, init);
    const text = await fr.text();
    res.status(fr.status);
    const ct = fr.headers.get('content-type');
    if (ct) {
      res.setHeader('Content-Type', ct);
    }
    res.send(text);
  } catch (err) {
    console.error('agent-api proxy:', err);
    res.status(502).json({
      response:
        'Could not reach the AI service. Start the Python app on port 8011 (see npm run dev:ai / install-all).',
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, node: process.version, hasFetch: typeof fetch === 'function' });
});

app.get('/api/public/config', (req, res) => {
  res.json({
    supabaseUrl: SUPABASE_URL || '',
    supabaseAnonKey: SUPABASE_ANON_KEY || ''
  });
});

app.use('/api', requireAuth);

app.get('/api/proxy/ical', async (req, res) => {
  const { url } = req.query;
  if (typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'url parameter is required' });
  }

  try {
    const fetchOptions = {};
    if (typeof AbortController === 'function') {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
        fetchOptions.signal = controller.signal;
        res.on('finish', () => clearTimeout(timeoutId));
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      console.warn(`Failed to fetch calendar from ${url}: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({ 
        error: `The calendar source returned an error: ${response.status} ${response.statusText}`,
        details: 'Ensure your private iCal link is correctly copied and accessible.'
      });
    }

    const data = await response.text();
    if (!data || !data.includes('BEGIN:VCALENDAR')) {
      return res.status(422).json({ 
        error: 'The source did not return a valid iCal file.',
        details: 'Check that the URL is a direct link to an .ics file.'
      });
    }

    res.type('text/calendar').send(data);
  } catch (error) {
    console.error('iCal proxy error:', error);
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    res.status(500).json({ 
      error: isTimeout ? 'Request timed out' : 'Failed to proxy iCal request',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

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

app.post('/api/google-calendar/oauth-events', async (req, res) => {
  const {
    providerToken,
    start,
    end,
    calendarId,
    q,
    maxResults,
  } = req.body || {};

  if (typeof providerToken !== 'string' || !providerToken.trim()) {
    return res.status(400).json({ error: 'providerToken is required' });
  }

  if (typeof start !== 'string' || typeof end !== 'string') {
    return res.status(400).json({ error: 'start and end are required' });
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
    const result = await fetchGoogleCalendarEventsWithAccessToken({
      accessToken: providerToken.trim(),
      calendarId: typeof calendarId === 'string' ? calendarId : undefined,
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      maxResults: Number.isFinite(Number(maxResults)) ? Math.min(Number(maxResults), 1000) : 250,
      q: typeof q === 'string' ? q : undefined,
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
    console.error('Google OAuth calendar import error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch Google Calendar events with Google login',
    });
  }
});

app.get('/api/google-calendar/connection', async (req, res) => {
  const db = await getDB();
  const user = await db.get(
    `SELECT google_calendar_connected, google_calendar_calendar_id
     FROM users
     WHERE id = ?`,
    req.localUser.id,
  );

  res.json({
    success: true,
    connected: !!user?.google_calendar_connected,
    calendarId: user?.google_calendar_calendar_id || 'primary',
  });
});

app.post('/api/google-calendar/connect', async (req, res) => {
  const {
    providerToken,
    providerRefreshToken,
    providerTokenExpiry,
    calendarId,
    start,
    end,
    q,
    maxResults,
  } = req.body || {};

  if (typeof providerToken !== 'string' || !providerToken.trim()) {
    return res.status(400).json({ error: 'providerToken is required' });
  }

  let syncRange;
  try {
    syncRange = buildCalendarSyncRange(start, end);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Invalid calendar sync range',
    });
  }

  try {
    const result = await fetchGoogleCalendarEventsWithAccessToken({
      accessToken: providerToken.trim(),
      calendarId: typeof calendarId === 'string' ? calendarId : undefined,
      timeMin: syncRange.start,
      timeMax: syncRange.end,
      maxResults: Number.isFinite(Number(maxResults)) ? Math.min(Number(maxResults), 1000) : 250,
      q: typeof q === 'string' ? q : undefined,
    });

    const db = await getDB();
    await db.run(
      `UPDATE users
       SET google_calendar_connected = 1,
           google_calendar_calendar_id = ?,
           google_calendar_access_token = ?,
           google_calendar_refresh_token = CASE
             WHEN ? IS NULL OR ? = '' THEN google_calendar_refresh_token
             ELSE ?
           END,
           google_calendar_token_expiry = CASE
             WHEN ? IS NULL OR ? = '' THEN google_calendar_token_expiry
             ELSE ?
           END
       WHERE id = ?`,
      result.calendarId || 'primary',
      providerToken.trim(),
      providerRefreshToken ?? null,
      providerRefreshToken ?? null,
      providerRefreshToken ?? null,
      providerTokenExpiry ?? null,
      providerTokenExpiry ?? null,
      providerTokenExpiry ?? null,
      req.localUser.id,
    );

    const sourceUrl = `google-oauth:${result.calendarId || 'primary'}`;
    await db.run(
      'INSERT OR IGNORE INTO calendar_sources (user_id, url) VALUES (?, ?)',
      req.localUser.id,
      sourceUrl,
    );

    res.json({
      success: true,
      connected: true,
      sourceUrl,
      ...result,
      range: syncRange,
    });
  } catch (error) {
    console.error('Google Calendar connect error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to connect Google Calendar',
    });
  }
});

app.post('/api/google-calendar/sync-connected', async (req, res) => {
  const { start, end, q, maxResults } = req.body || {};

  let syncRange;
  try {
    syncRange = buildCalendarSyncRange(start, end);
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Invalid calendar sync range',
    });
  }

  try {
    const db = await getDB();
    const user = await db.get(
      `SELECT google_calendar_connected, google_calendar_calendar_id, google_calendar_refresh_token
       FROM users
       WHERE id = ?`,
      req.localUser.id,
    );

    if (!user?.google_calendar_connected) {
      return res.status(400).json({ error: 'Google Calendar is not connected for this user.' });
    }

    if (!user.google_calendar_refresh_token) {
      return res.status(400).json({
        error: 'No Google refresh token is stored. Reconnect Google Calendar and approve access again.',
      });
    }

    const result = await fetchGoogleCalendarEventsWithRefreshToken({
      refreshToken: user.google_calendar_refresh_token,
      calendarId: user.google_calendar_calendar_id || 'primary',
      timeMin: syncRange.start,
      timeMax: syncRange.end,
      maxResults: Number.isFinite(Number(maxResults)) ? Math.min(Number(maxResults), 1000) : 250,
      q: typeof q === 'string' ? q : undefined,
    });

    await db.run(
      `UPDATE users
       SET google_calendar_access_token = ?,
           google_calendar_token_expiry = ?
       WHERE id = ?`,
      result.refreshedAccessToken,
      result.refreshedAccessTokenExpiry || '',
      req.localUser.id,
    );

    res.json({
      success: true,
      connected: true,
      sourceUrl: `google-oauth:${result.calendarId || 'primary'}`,
      calendarId: result.calendarId,
      events: result.events,
      tasks: result.tasks,
      range: syncRange,
    });
  } catch (error) {
    console.error('Google Calendar sync-connected error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync connected Google Calendar',
    });
  }
});

app.delete('/api/google-calendar/connection', async (req, res) => {
  const db = await getDB();
  const user = await db.get(
    'SELECT google_calendar_calendar_id FROM users WHERE id = ?',
    req.localUser.id,
  );
  const sourceUrl = `google-oauth:${user?.google_calendar_calendar_id || 'primary'}`;

  await db.run(
    `UPDATE users
     SET google_calendar_connected = 0,
         google_calendar_calendar_id = '',
         google_calendar_access_token = '',
         google_calendar_refresh_token = '',
         google_calendar_token_expiry = ''
     WHERE id = ?`,
    req.localUser.id,
  );
  await db.run(
    'DELETE FROM calendar_sources WHERE user_id = ? AND url = ?',
    req.localUser.id,
    sourceUrl,
  );

  res.json({ success: true, sourceUrl });
});

app.post('/api/calendar-url-preview', async (req, res) => {
  const { url } = req.body || {};

  if (typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'url is required' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url.trim());
  } catch {
    return res.status(400).json({ error: 'Invalid calendar URL' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'Only http and https calendar URLs are supported' });
  }

  try {
    const response = await fetch(parsedUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'HandAll-Calendar-Importer/1.0',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Failed to fetch calendar URL (${response.status} ${response.statusText})`,
      });
    }

    const icalData = await response.text();
    res.json({
      success: true,
      url: parsedUrl.toString(),
      icalData,
    });
  } catch (error) {
    console.error('Calendar URL preview fetch error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch calendar URL',
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
      error: 'Failed to persist calendar import',
      details: error instanceof Error ? error.message : String(error)
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
    const result = await runScheduleRebalanceCore(db, uid, {
      motivation: req.body?.motivation,
      horizon_days: req.body?.horizon_days,
      timezone: req.body?.timezone,
    });
    if (!result.ok) {
      if (result.status === 404) {
        return res.status(404).json({ error: result.error });
      }
      return res.status(result.status || 503).json({
        error: result.error,
        detail: result.detail,
        user: result.user,
      });
    }
    res.json(result.data);
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
  const timezone =
    typeof req.body?.timezone === 'string' && req.body.timezone.trim()
      ? req.body.timezone.trim()
      : 'UTC';

  if (!Array.isArray(events)) {
    return res.status(400).json({ error: 'events array is required' });
  }

  const db = await getDB();
  const uid = req.localUser.id;
  console.log(`Bulk upserting ${events.length} events for user ${uid}`);

  try {
    await db.run('BEGIN IMMEDIATE TRANSACTION');

    for (const event of events) {
      const existing = await db.get(
        'SELECT id FROM tasks WHERE user_id = ? AND (external_id = ? OR (external_id IS NULL AND title = ? AND start_time = ?))',
        uid,
        event.id,
        event.title,
        event.start,
      );

      if (existing) {
        await db.run(
          'UPDATE tasks SET title = ?, description = ?, start_time = ?, end_time = ?, type = ?, status = ?, external_id = ?, source_url = ? WHERE id = ?',
          event.title,
          event.description || null,
          event.start,
          event.end,
          event.type,
          event.completed ? 'Completed' : 'Accepted',
          event.id,
          event.source_url || null,
          existing.id,
        );
      } else {
        await db.run(
          'INSERT INTO tasks (user_id, external_id, title, description, start_time, end_time, type, source_url, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          uid,
          event.id,
          event.title,
          event.description || null,
          event.start,
          event.end,
          event.type,
          event.source_url || null,
          event.completed ? 'Completed' : 'Accepted',
        );
      }
    }

    await db.run('COMMIT');

    const assignmentEvents = events.filter(
      (e) => String(e.type || '').toLowerCase() === 'assignment' && !e.completed,
    );
    const seenKeys = new Set();
    const taskRows = [];
    for (const ev of assignmentEvents) {
      const row = await db.get(
        'SELECT * FROM tasks WHERE user_id = ? AND external_id = ?',
        uid,
        ev.id,
      );
      if (!row) continue;
      const key = assignmentExternalKeyForRow(row);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      taskRows.push(row);
    }

    const user = await db.get('SELECT * FROM users WHERE id = ?', uid);
    const motivation = Number.isFinite(Number(user?.motivation))
      ? Math.max(0, Math.min(100, Math.round(Number(user.motivation))))
      : 50;

    const breakdown = {
      assignment_count: taskRows.length,
      assignment_keys: [],
      subtasks_inserted: 0,
      batches: 0,
      error: null,
    };

    let rebalance = null;

    if (taskRows.length > 0) {
      try {
        const batchResult = await runBatchAssignmentBreakdown(db, uid, taskRows, motivation);
        breakdown.assignment_keys = batchResult.assignment_keys;
        breakdown.subtasks_inserted = batchResult.subtasks_inserted;
        breakdown.batches = batchResult.batches;
      } catch (be) {
        console.error('Bulk import assignment breakdown:', be);
        breakdown.error = be instanceof Error ? be.message : String(be);
      }

      const rb = await runScheduleRebalanceCore(db, uid, {
        horizon_days: 7,
        timezone,
      });
      if (rb.ok) {
        rebalance = rb.data;
      } else {
        rebalance = {
          success: false,
          soft: true,
          error: rb.error,
          detail: rb.detail,
          user: rb.user,
        };
      }
    }

    res.json({
      success: true,
      breakdown,
      rebalance,
    });
  } catch (err) {
    console.error('Bulk upsert error:', err);
    try {
      await db.run('ROLLBACK');
    } catch (rollbackErr) {
      // ignore
    }
    res.status(500).json({ error: 'Failed to bulk sync', details: err.message });
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
    const externalId = randomUUID();
    console.log('Adding task:', title, 'for user:', localUserId);
    const result = await db.run(
      'INSERT INTO tasks (user_id, external_id, title, description, start_time, end_time, type, status) VALUES (?, ?, ?, ?, ?, ?, ?, "Accepted")',
      localUserId,
      externalId,
      title,
      description,
      start,
      end,
      type
    );
    const newId = result?.lastID ?? result?.lastInsertRowid;
    console.log('Task added with ID:', newId, 'external_id:', externalId);
    res.json({ success: true, id: newId, external_id: externalId });
  } catch (err) {
    console.error('Add task error:', err);
    const message = err instanceof Error ? err.message : 'Failed to add task';
    res.status(500).json({ error: message });
  }
});

app.patch('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const { title, description, start, end, type, completed, status } = req.body;
    const db = await getDB();
    
    const task = await db.get('SELECT * FROM tasks WHERE user_id = ? AND (id = ? OR external_id = ?)', req.localUser.id, id, id);
    
    if (!task) {
        return res.status(404).json({ error: 'Task not found' });
    }

    // Prepare fields for update
    const nextTitle = title !== undefined ? title : task.title;
    const nextDesc = description !== undefined ? description : task.description;
    const nextStart = start !== undefined ? start : task.start_time;
    const nextEnd = end !== undefined ? end : task.end_time;
    const nextType = type !== undefined ? type : task.type;
    
    let nextStatus = task.status;
    if (completed !== undefined) {
        nextStatus = completed ? 'Completed' : 'Accepted';
    } else if (status !== undefined) {
        nextStatus = status;
    }

    try {
        await db.run(
            'UPDATE tasks SET title = ?, description = ?, start_time = ?, end_time = ?, type = ?, status = ? WHERE id = ?',
            nextTitle, nextDesc, nextStart, nextEnd, nextType, nextStatus, task.id
        );

        if (completed === true && task.status !== 'Completed') {
            let xpGained = 10;
            const tlower = String(nextType || '').toLowerCase();
            if (tlower === 'working') xpGained = 50;
            else if (tlower === 'goal') xpGained = 30;

            const user = await db.get('SELECT * FROM users WHERE id = ?', req.localUser.id);
            const newXp = (user.xp || 0) + xpGained;
            const newLevel = Math.floor(newXp / 100);

            await db.run('UPDATE users SET xp = ?, level = ? WHERE id = ?', newXp, newLevel, req.localUser.id);
            return res.json({ success: true, xpGained, newLevel, newXp });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Update task error:', err);
        res.status(500).json({ error: 'Failed to update task' });
    }
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
    const task = await db.get(
      'SELECT * FROM tasks WHERE user_id = ? AND (id = ? OR external_id = ?)',
      req.localUser.id,
      id,
      id,
    );
    if (task) {
      const key = assignmentExternalKeyForRow(task);
      await db.run(
        'DELETE FROM ai_planning_items WHERE user_id = ? AND assignment_external_id = ?',
        req.localUser.id,
        key,
      );
    }
    await db.run('DELETE FROM tasks WHERE user_id = ? AND (id = ? OR external_id = ?)', req.localUser.id, id, id);
    res.json({ success: true });
});

app.get('/api/planning-items', async (req, res) => {
  try {
    const db = await getDB();
    const rows = await db.all(
      `SELECT id, item_type, assignment_external_id, assignment_title, side_goal, title, description,
              estimated_minutes, sort_order, due_iso
       FROM ai_planning_items WHERE user_id = ? ORDER BY item_type, assignment_external_id, sort_order, id`,
      req.localUser.id,
    );
    res.json({ success: true, items: rows });
  } catch (e) {
    console.error('planning-items:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to load planning items' });
  }
});

app.post('/api/ai/assignment-breakdown', async (req, res) => {
  try {
    const taskId = req.body?.taskId != null ? String(req.body.taskId) : '';
    if (!taskId) {
      return res.status(400).json({ error: 'taskId is required' });
    }
    const db = await getDB();
    const uid = req.localUser.id;
    const task = await db.get(
      'SELECT * FROM tasks WHERE user_id = ? AND (id = ? OR external_id = ?)',
      uid,
      taskId,
      taskId,
    );
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const ttype = String(task.type || '').toLowerCase();
    if (ttype !== 'assignment') {
      return res.status(400).json({ error: 'Only assignment tasks can be broken down into subtasks' });
    }
    const user = await db.get('SELECT * FROM users WHERE id = ?', uid);
    const motivation = Number.isFinite(Number(user?.motivation))
      ? Math.max(0, Math.min(100, Math.round(Number(user.motivation))))
      : 50;
    let plannerRes;
    try {
      plannerRes = await postPlanner('/ai/assignment-subtasks', {
        parent_title: task.title,
        parent_description: task.description || '',
        due_date_iso: task.start_time,
        motivation,
      });
    } catch (netErr) {
      console.error('Planner unreachable (assignment subtasks):', netErr);
      return res.status(503).json({
        error: 'Planner service unreachable. Start the Python backend on port 8011.',
        subtasks: [],
      });
    }
    const { ok, data } = plannerRes;
    if (!ok || !data || data.success === false) {
      return res.status(503).json({
        error:
          (data && data.error) ||
          'AI subtask generation failed. Start the planner on port 8011 and set GOOGLE_API_KEY in the root .env.',
        subtasks: [],
      });
    }

    const rawSubtasks = Array.isArray(data.subtasks) ? data.subtasks : [];
    const { assignment_external_id: key, inserted } = await replaceAssignmentSubtasks(db, uid, task, rawSubtasks);

    res.json({ success: true, assignment_external_id: key, subtasks: inserted });
  } catch (e) {
    console.error('assignment-breakdown:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'Breakdown failed' });
  }
});

app.post('/api/ai/goal-tasks/regenerate', async (req, res) => {
  try {
    const db = await getDB();
    const uid = req.localUser.id;
    const user = await db.get('SELECT * FROM users WHERE id = ?', uid);
    const sideGoals = sideGoalsListFromUserRow(user);
    const motivation = Number.isFinite(Number(user?.motivation))
      ? Math.max(0, Math.min(100, Math.round(Number(user.motivation))))
      : 50;

    await db.run(
      'DELETE FROM ai_planning_items WHERE user_id = ? AND item_type = ?',
      uid,
      'goal_task',
    );

    if (sideGoals.length === 0) {
      return res.json({ success: true, tasks: [], message: 'No side goals to generate tasks for' });
    }

    let plannerRes;
    try {
      plannerRes = await postPlanner('/ai/goal-tasks', {
        side_goals: sideGoals,
        motivation,
      });
    } catch (netErr) {
      console.error('Planner unreachable (goal tasks):', netErr);
      return res.status(503).json({
        error: 'Planner service unreachable. Start the Python backend on port 8011.',
        tasks: [],
      });
    }
    const { ok, data } = plannerRes;
    if (!ok || !data || data.success === false) {
      return res.status(503).json({
        error: (data && data.error) || 'AI goal-task generation failed.',
        tasks: [],
      });
    }

    const rawTasks = Array.isArray(data.tasks) ? data.tasks : [];
    const inserted = [];
    for (const st of rawTasks) {
      const title = st.title != null ? String(st.title).trim() : '';
      if (!title) continue;
      const em = Number.isFinite(Number(st.estimated_minutes)) ? Math.round(Number(st.estimated_minutes)) : 40;
      const sortOrder = Number.isFinite(Number(st.sort_order)) ? Math.round(Number(st.sort_order)) : inserted.length;
      const desc = st.description != null ? String(st.description) : '';
      const sg = st.side_goal != null ? String(st.side_goal).trim() : '';
      const r = await db.run(
        `INSERT INTO ai_planning_items (user_id, item_type, assignment_external_id, assignment_title, side_goal, title, description, estimated_minutes, sort_order, due_iso)
         VALUES (?, 'goal_task', NULL, NULL, ?, ?, ?, ?, ?, NULL)`,
        uid,
        sg || null,
        title,
        desc || null,
        Math.max(15, Math.min(120, em)),
        sortOrder,
      );
      inserted.push({
        id: r.lastID,
        title,
        description: desc,
        estimated_minutes: Math.max(15, Math.min(120, em)),
        sort_order: sortOrder,
        side_goal: sg,
      });
    }

    res.json({ success: true, tasks: inserted });
  } catch (e) {
    console.error('goal-tasks regenerate:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'Regenerate failed' });
  }
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
