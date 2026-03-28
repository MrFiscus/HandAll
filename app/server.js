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

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('Missing SUPABASE_URL or SUPABASE_ANON_KEY. API auth will fail until these are configured.');
}

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to get DB
const getDB = () => dbPromise;

async function getOrCreateLocalUser(authUser) {
  const db = await getDB();
  let user = await db.get('SELECT * FROM users WHERE auth_user_id = ?', authUser.id);

  if (!user) {
    const username = authUser.email || authUser.user_metadata?.full_name || 'Student';
    const result = await db.run(
      'INSERT INTO users (auth_user_id, username) VALUES (?, ?)',
      authUser.id,
      username
    );
    user = await db.get('SELECT * FROM users WHERE id = ?', result.lastID);
  }

  return user;
}

async function requireAuth(req, res, next) {
  if (!supabase) {
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
    'SELECT * FROM tasks WHERE user_id = ? AND status != "Rejected" ORDER BY start_time ASC',
    req.localUser.id
  );
  res.json(tasks);
});

app.post('/api/tasks/weekly-sync', async (req, res) => {
  const db = await getDB();
  const user = req.localUser;
  // Simulated assignment fetching
  const mockAssignments = [
    { title: 'Math Problem Set', hours: 3 },
    { title: 'History Essay', hours: 2 }
  ];

  const pendingTasks = [];
  mockAssignments.forEach(a => {
    const decomposed = AI.decomposeTask(a.title, a.hours);
    pendingTasks.push(...decomposed);
  });

  for(let i=0; i<2; i++) {
    pendingTasks.push(AI.suggestGoalTask(user.side_goal));
    pendingTasks.push(AI.suggestFreeTimeTask());
  }

  // Insert into DB as 'Pending'
  for (const t of pendingTasks) {
    await db.run(
      'INSERT INTO tasks (user_id, title, type, status) VALUES (?, ?, ?, "Pending")',
      req.localUser.id,
      t.title,
      t.type
    );
  }

  res.json({ success: true, count: pendingTasks.length });
});

app.post('/api/tasks/respond', async (req, res) => {
  const { taskId, action } = req.body;
  const db = await getDB();
  await db.run('UPDATE tasks SET status = ? WHERE id = ? AND user_id = ?', action, taskId, req.localUser.id);
  res.json({ success: true });
});

app.post('/api/tasks/complete', async (req, res) => {
  const { taskId } = req.body;
  const db = await getDB();
  const task = await db.get('SELECT type FROM tasks WHERE id = ? AND user_id = ?', taskId, req.localUser.id);

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  await db.run('UPDATE tasks SET status = "Completed" WHERE id = ? AND user_id = ?', taskId, req.localUser.id);
  
  let xpGained = 10;
  if(task.type === 'Working') xpGained = 50;
  if(task.type === 'Goal') xpGained = 30;

  const user = await db.get('SELECT * FROM users WHERE id = ?', req.localUser.id);
  const newXp = user.xp + xpGained;
  const newLevel = Math.floor(newXp / 100);

  await db.run('UPDATE users SET xp = ?, level = ? WHERE id = ?', newXp, newLevel, req.localUser.id);
  
  res.json({ success: true, xpGained, newLevel, newXp });
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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});