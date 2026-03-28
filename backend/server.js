import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dbPromise } from './src/db.js';
import * as AI from './src/ai.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

app.use(cors());
app.use(bodyParser.json());

// Serve static files from the React app's build directory
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Helper to get DB
const getDB = () => dbPromise;

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

// --- User Profile Endpoints ---
app.get('/api/user', async (req, res) => {
  res.json(req.localUser);
});

app.post('/api/user/setup', async (req, res) => {
  const { wake_time, sleep_time, side_goal, google_calendar_url } = req.body;
  const db = await getDB();
  await db.run(
    'UPDATE users SET wake_time = ?, sleep_time = ?, side_goal = ?, google_calendar_url = ? WHERE id = ?',
    wake_time,
    sleep_time,
    side_goal,
    google_calendar_url,
    req.localUser.id
  );
  res.json({ success: true });
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
    start: t.start_time,
    end: t.end_time,
    type: t.type ? t.type.toLowerCase() : 'working',
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
              'UPDATE tasks SET title = ?, start_time = ?, end_time = ?, type = ?, status = ?, external_id = ? WHERE id = ?',
              event.title, event.start, event.end, event.type, event.completed ? 'Completed' : 'Accepted', event.id, existing.id
          );
      } else {
          await db.run(
              'INSERT INTO tasks (user_id, external_id, title, start_time, end_time, type, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
              req.localUser.id, event.id, event.title, event.start, event.end, event.type, event.completed ? 'Completed' : 'Accepted'
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

app.delete('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const db = await getDB();
    await db.run('DELETE FROM tasks WHERE user_id = ? AND (id = ? OR external_id = ?)', req.localUser.id, id, id);
    res.json({ success: true });
});

// Fallback for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});