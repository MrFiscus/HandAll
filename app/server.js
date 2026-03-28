import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbPromise } from './src/db.js';
import * as AI from './src/ai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to get DB
const getDB = () => dbPromise;

// --- User Profile Endpoints ---
app.get('/api/user', async (req, res) => {
  const db = await getDB();
  const user = await db.get('SELECT * FROM users LIMIT 1');
  res.json(user);
});

app.post('/api/user/setup', async (req, res) => {
  const { wake_time, sleep_time, side_goal, google_calendar_url } = req.body;
  const db = await getDB();
  await db.run('UPDATE users SET wake_time = ?, sleep_time = ?, side_goal = ?, google_calendar_url = ? WHERE id = 1',
    wake_time, sleep_time, side_goal, google_calendar_url);
  res.json({ success: true });
});

// --- Task Management Endpoints ---
app.get('/api/tasks', async (req, res) => {
  const db = await getDB();
  const tasks = await db.all('SELECT * FROM tasks WHERE user_id = 1 AND status != "Rejected" ORDER BY start_time ASC');
  res.json(tasks);
});

app.post('/api/tasks/weekly-sync', async (req, res) => {
  const db = await getDB();
  const user = await db.get('SELECT * FROM users LIMIT 1');
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
    await db.run('INSERT INTO tasks (user_id, title, type, status) VALUES (1, ?, ?, "Pending")', t.title, t.type);
  }

  res.json({ success: true, count: pendingTasks.length });
});

app.post('/api/tasks/respond', async (req, res) => {
  const { taskId, action } = req.body;
  const db = await getDB();
  await db.run('UPDATE tasks SET status = ? WHERE id = ?', action, taskId);
  res.json({ success: true });
});

app.post('/api/tasks/complete', async (req, res) => {
  const { taskId } = req.body;
  const db = await getDB();
  const task = await db.get('SELECT type FROM tasks WHERE id = ?', taskId);
  
  await db.run('UPDATE tasks SET status = "Completed" WHERE id = ?', taskId);
  
  let xpGained = 10;
  if(task.type === 'Working') xpGained = 50;
  if(task.type === 'Goal') xpGained = 30;

  const user = await db.get('SELECT * FROM users LIMIT 1');
  const newXp = user.xp + xpGained;
  const newLevel = Math.floor(newXp / 100);

  await db.run('UPDATE users SET xp = ?, level = ? WHERE id = 1', newXp, newLevel);
  
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