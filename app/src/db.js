import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, '../handall.db');

export async function initDB() {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT DEFAULT 'Student',
      sleep_time TEXT DEFAULT '23:00',
      wake_time TEXT DEFAULT '07:00',
      side_goal TEXT DEFAULT '',
      google_calendar_url TEXT DEFAULT '',
      level INTEGER DEFAULT 0,
      xp INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      title TEXT,
      type TEXT, -- 'Working', 'Goal', 'Free'
      start_time DATETIME,
      end_time DATETIME,
      status TEXT DEFAULT 'Pending', -- 'Pending', 'Accepted', 'Completed', 'Rejected'
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS calendar_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      url TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  // Seed initial user if not exists
  const user = await db.get('SELECT * FROM users LIMIT 1');
  if (!user) {
    await db.run('INSERT INTO users (username) VALUES (?)', 'Student');
  }

  console.log('Database initialized at:', dbPath);
  return db;
}

// In ES modules, we can use top-level await if supported or export the promise
export const dbPromise = initDB();