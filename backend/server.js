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
const PORT = 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

app.use(cors());
app.use(bodyParser.json());

// Serve static files from the React app's build directory
// Note: You'll need to run `npm run build` in the frontend folder first.
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Helper to get DB
const getDB = () => dbPromise;

async function getOrCreateLocalUser(authUser) {
  const db = await getDB();
  let user = await db.get('SELECT * FROM users WHERE auth_user_id = ?', authUser.id);

  if (!user) {
    const username = authUser.email || authUser.user_metadata?.full_name || 'Student';
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
    // If Supabase is not configured, we might be in a local-only dev mode or misconfigured
    return res.status(500).json({ error: 'Supabase is not configured on the server' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: 'Invalid or expired auth token' });
  }

  req.authUser = data.user;
  req.localUser = await getOrCreateLocalUser(data.user);
  next();
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
  // Transform DB rows to frontend format if necessary
  res.json(tasks.map(t => ({
    id: t.id.toString(),
    title: t.title,
    start: t.start_time,
    end: t.end_time,
    type: t.type.toLowerCase(),
    completed: t.status === 'Completed',
    xpValue: t.type === 'Working' ? 50 : (t.type === 'Goal' ? 30 : 10)
  })));
});

app.post('/api/tasks', async (req, res) => {
  const { title, start, end, type } = req.body;
  const db = await getDB();
  const result = await db.run(
    'INSERT INTO tasks (user_id, title, start_time, end_time, type, status) VALUES (?, ?, ?, ?, ?, "Accepted")',
    req.localUser.id, title, start, end, type,
  );
  res.json({ success: true, id: result.lastID });
});

app.patch('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const { completed, status } = req.body;
    const db = await getDB();
    
    if (completed !== undefined) {
        const newStatus = completed ? 'Completed' : 'Accepted';
        await db.run('UPDATE tasks SET status = ? WHERE id = ? AND user_id = ?', newStatus, id, req.localUser.id);
        
        if (completed) {
            const task = await db.get('SELECT type FROM tasks WHERE id = ?', id);
            let xpGained = 10;
            if(task.type.toLowerCase() === 'working') xpGained = 50;
            if(task.type.toLowerCase() === 'goal') xpGained = 30;

            const user = await db.get('SELECT * FROM users WHERE id = ?', req.localUser.id);
            const newXp = user.xp + xpGained;
            const newLevel = Math.floor(newXp / 100);

            await db.run('UPDATE users SET xp = ?, level = ? WHERE id = ?', newXp, newLevel, req.localUser.id);
            return res.json({ success: true, xpGained, newLevel, newXp });
        }
    } else if (status) {
        await db.run('UPDATE tasks SET status = ? WHERE id = ? AND user_id = ?', status, id, req.localUser.id);
    }
    
    res.json({ success: true });
});

app.delete('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const db = await getDB();
    await db.run('DELETE FROM tasks WHERE id = ? AND user_id = ?', id, req.localUser.id);
    res.json({ success: true });
});

app.post('/api/tasks/weekly-sync', async (req, res) => {
  const { assignments } = req.body; // Array of { title, hours }
  const db = await getDB();
  const user = req.localUser;

  const pendingTasks = [];
  if (assignments && assignments.length > 0) {
      assignments.forEach(a => {
        const decomposed = AI.decomposeTask(a.title, a.hours || 2);
        pendingTasks.push(...decomposed);
      });
  } else {
      // Default mock if none provided
      const mockAssignments = [
        { title: 'Math Problem Set', hours: 3 },
        { title: 'History Essay', hours: 2 }
      ];
      mockAssignments.forEach(a => {
        const decomposed = AI.decomposeTask(a.title, a.hours);
        pendingTasks.push(...decomposed);
      });
  }

  for(let i=0; i<2; i++) {
    pendingTasks.push(AI.suggestGoalTask(user.side_goal));
    pendingTasks.push(AI.suggestFreeTimeTask());
  }

  // Return suggested tasks for user review (frontend will then POST back to /api/tasks to confirm)
  res.json(pendingTasks.map((t, idx) => ({
      id: `suggested-${Date.now()}-${idx}`,
      title: t.title,
      type: t.type.toLowerCase(),
      xpValue: t.type === 'Working' ? 50 : (t.type === 'Goal' ? 30 : 10)
  })));
});

// --- Chat Endpoint ---
app.post('/api/chat', (req, res) => {
  const { message } = req.body;
  let reply = "I'm not sure how to help with that yet. Try asking me to add a task!";
  if(message.toLowerCase().includes('add')) {
    reply = "I've added that to your list for review!";
  }
  res.json({ reply });
});

// Fallback for SPA (React Router)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});