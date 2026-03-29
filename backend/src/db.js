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

  await db.exec('PRAGMA busy_timeout = 5000');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auth_user_id TEXT UNIQUE,
      username TEXT DEFAULT 'Student',
      sleep_time TEXT DEFAULT '23:00',
      wake_time TEXT DEFAULT '07:00',
      side_goal TEXT DEFAULT '',
      google_calendar_url TEXT DEFAULT '',
      google_calendar_connected INTEGER DEFAULT 0,
      google_calendar_calendar_id TEXT DEFAULT '',
      google_calendar_access_token TEXT DEFAULT '',
      google_calendar_refresh_token TEXT DEFAULT '',
      google_calendar_token_expiry TEXT DEFAULT '',
      setup_completed INTEGER DEFAULT 0,
      level INTEGER DEFAULT 0,
      xp INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      external_id TEXT,
      title TEXT,
      description TEXT,
      type TEXT, -- 'Working', 'Goal', 'Free'
      start_time DATETIME,
      end_time DATETIME,
      source_url TEXT,
      planner_source_url TEXT,
      status TEXT DEFAULT 'Pending', -- 'Pending', 'Accepted', 'Completed', 'Rejected'
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS calendar_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      url TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS calendar_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      source_url TEXT NOT NULL,
      import_type TEXT DEFAULT 'ical',
      event_count INTEGER DEFAULT 0,
      file_path TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  // Migration for existing databases created before auth_user_id existed.
  await db.exec('ALTER TABLE users ADD COLUMN auth_user_id TEXT').catch(() => {});
  await db.exec('ALTER TABLE users ADD COLUMN google_calendar_connected INTEGER DEFAULT 0').catch(() => {});
  await db.exec("ALTER TABLE users ADD COLUMN google_calendar_calendar_id TEXT DEFAULT ''").catch(() => {});
  await db.exec("ALTER TABLE users ADD COLUMN google_calendar_access_token TEXT DEFAULT ''").catch(() => {});
  await db.exec("ALTER TABLE users ADD COLUMN google_calendar_refresh_token TEXT DEFAULT ''").catch(() => {});
  await db.exec("ALTER TABLE users ADD COLUMN google_calendar_token_expiry TEXT DEFAULT ''").catch(() => {});
  await db.exec('ALTER TABLE users ADD COLUMN setup_completed INTEGER DEFAULT 0').catch(() => {});
  
  // Migration for external_id on tasks
  await db.exec('ALTER TABLE tasks ADD COLUMN external_id TEXT').catch(() => {});
  await db.exec('ALTER TABLE tasks ADD COLUMN description TEXT').catch(() => {});
  await db.exec('ALTER TABLE tasks ADD COLUMN source_url TEXT').catch(() => {});
  await db.exec('ALTER TABLE tasks ADD COLUMN planner_source_url TEXT').catch(() => {});
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_sources_user_url ON calendar_sources(user_id, url)').catch(() => {});

  // Ensure only one legacy local user keeps NULL auth_user_id.
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id ON users(auth_user_id)');

  await db.exec('ALTER TABLE users ADD COLUMN side_goals_json TEXT').catch(() => {});
  await db.exec('ALTER TABLE users ADD COLUMN motivation INTEGER DEFAULT 50').catch(() => {});
  await db.exec(
    "ALTER TABLE users ADD COLUMN active_calendar_source_url TEXT DEFAULT ''",
  ).catch(() => {});

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ai_planning_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      assignment_external_id TEXT,
      assignment_title TEXT,
      side_goal TEXT,
      title TEXT NOT NULL,
      description TEXT,
      estimated_minutes INTEGER NOT NULL DEFAULT 45,
      sort_order INTEGER NOT NULL DEFAULT 0,
      due_iso TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ai_planning_user ON ai_planning_items(user_id)',
  ).catch(() => {});
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ai_planning_assignment ON ai_planning_items(assignment_external_id)',
  ).catch(() => {});

  await db.exec('ALTER TABLE tasks ADD COLUMN ai_meta TEXT').catch(() => {});

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ai_cache_event_class (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      external_key TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      classification TEXT NOT NULL,
      confidence REAL,
      subtype TEXT,
      reason TEXT,
      raw_json TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, external_key),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ai_cache_event_user_hash ON ai_cache_event_class(user_id, content_hash)',
  ).catch(() => {});

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ai_cache_assignment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      assignment_key TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      subtasks_json TEXT NOT NULL,
      meta_json TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, assignment_key),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ai_cache_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      goals_hash TEXT NOT NULL,
      tasks_json TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  await db.exec('ALTER TABLE ai_planning_items ADD COLUMN rationale TEXT').catch(() => {});

  await db.exec(
    "ALTER TABLE users ADD COLUMN scheduling_prefs_json TEXT DEFAULT '{}'",
  ).catch(() => {});

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
