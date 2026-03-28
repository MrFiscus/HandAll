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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvFile = path.join(__dirname, '../.env');
const frontendDistDir = path.join(__dirname, '../frontend/dist');
const frontendIndexFile = path.join(frontendDistDir, 'index.html');
const hasFrontendBuild = fs.existsSync(frontendIndexFile);

dotenv.config({ path: rootEnvFile });

const app = express();
const PORT = 3001;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

app.use(cors());
app.use(bodyParser.json());

if (hasFrontendBuild) {
  app.use(express.static(frontendDistDir));
}

// Helper to get DB
const getDB = () => dbPromise;

async function getUserWithCalendarSources(localUserId) {
  const db = await getDB();
  const user = await db.get('SELECT * FROM users WHERE id = ?', localUserId);
  const calendarSources = await db.all(
    'SELECT url FROM calendar_sources WHERE user_id = ? ORDER BY id ASC',
    localUserId
  );

  return {
    ...user,
    calendar_urls: calendarSources.map((source) => source.url),
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
    user = await db.get('SELECT * FROM users WHERE id = ?', result.lastID);
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

// --- User Profile Endpoints ---
app.get('/api/user', async (req, res) => {
  const user = await getUserWithCalendarSources(req.localUser.id);
  res.json(user || req.localUser);
});

app.post('/api/user/setup', async (req, res) => {
  const { username, wake_time, sleep_time, side_goal, google_calendar_url, calendar_urls } = req.body;
  const db = await getDB();
  const calendarUrls = Array.isArray(calendar_urls)
    ? [...new Set(calendar_urls.filter((url) => typeof url === 'string' && url.trim()).map((url) => url.trim()))]
    : null;
  const primaryCalendarUrl = calendarUrls
    ? (calendarUrls[0] ?? '')
    : (typeof google_calendar_url === 'string' ? google_calendar_url : null);

  await db.run(
    `UPDATE users
     SET username = COALESCE(?, username),
         wake_time = COALESCE(?, wake_time),
         sleep_time = COALESCE(?, sleep_time),
         side_goal = COALESCE(?, side_goal),
         google_calendar_url = CASE WHEN ? IS NULL THEN google_calendar_url ELSE ? END
     WHERE id = ?`,
    username,
    wake_time,
    sleep_time,
    side_goal,
    primaryCalendarUrl,
    primaryCalendarUrl,
    req.localUser.id
  );

  if (calendarUrls) {
    await db.run('DELETE FROM calendar_sources WHERE user_id = ?', req.localUser.id);
    for (const url of calendarUrls) {
      await db.run(
        'INSERT OR IGNORE INTO calendar_sources (user_id, url) VALUES (?, ?)',
        req.localUser.id,
        url
      );
    }
  }

  const user = await getUserWithCalendarSources(req.localUser.id);
  res.json({ success: true, user });
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
  const { title, start, end, type } = req.body;
  console.log('Adding task:', title, 'for user:', req.localUser.id);
  const db = await getDB();
  try {
    const result = await db.run(
      'INSERT INTO tasks (user_id, title, start_time, end_time, type, status) VALUES (?, ?, ?, ?, ?, "Accepted")',
      req.localUser.id, title, start, end, type
    );
    console.log('Task added with ID:', result.lastID);
    res.json({ success: true, id: result.lastID });
  } catch (err) {
    console.error('Add task error:', err);
    res.status(500).json({ error: 'Failed to add task' });
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
