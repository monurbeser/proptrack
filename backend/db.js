// db.js — SQLite database setup
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Railway: use /tmp for writable persistent-ish storage
// Local: use the backend folder
const DB_DIR = process.env.RAILWAY_ENVIRONMENT ? '/tmp' : __dirname;
const DB_PATH = path.join(DB_DIR, 'proptrack.db');

console.log(`[db] Using database: ${DB_PATH}`);

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS listings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      url           TEXT    NOT NULL UNIQUE,
      title         TEXT,
      address       TEXT,
      image_url     TEXT,
      site          TEXT,
      currency      TEXT    DEFAULT 'AED',
      current_price REAL,
      last_checked  TEXT,
      created_at    TEXT    DEFAULT (datetime('now')),
      active        INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      price      REAL    NOT NULL,
      checked_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    INSERT OR IGNORE INTO settings VALUES ('telegram_bot_token', '');
    INSERT OR IGNORE INTO settings VALUES ('telegram_chat_id', '');
    INSERT OR IGNORE INTO settings VALUES ('check_interval_hours', '6');
    INSERT OR IGNORE INTO settings VALUES ('notify_on_increase', '1');
    INSERT OR IGNORE INTO settings VALUES ('notify_on_decrease', '1');
  `);
}
