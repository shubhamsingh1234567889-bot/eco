'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
// Built into Node 22.5+, so there is no native module to compile on the host.
const { DatabaseSync } = require('node:sqlite');

// Use the preferred folder if it is writable, otherwise fall back to the OS temp dir
// (some hosts, e.g. serverless platforms, mount the app directory read-only).
function resolveDbFile(file) {
  if (file) return file;
  const preferred = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'ecotrack.db');
  try {
    fs.mkdirSync(path.dirname(preferred), { recursive: true });
    fs.accessSync(path.dirname(preferred), fs.constants.W_OK);
    return preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), 'ecotrack.db');
    console.warn(`Cannot write to ${preferred}; using ${fallback} (data may not survive restarts).`);
    return fallback;
  }
}

function openDb(file) {
  const dbFile = resolveDbFile(file);

  const db = new DatabaseSync(dbFile);
  if (dbFile !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      daily_goal  REAL NOT NULL DEFAULT 8.0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activities (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category    TEXT NOT NULL,
      type        TEXT NOT NULL,
      quantity    REAL NOT NULL,
      emission    REAL NOT NULL,
      date        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_activities_user_date ON activities(user_id, date);
  `);

  return db;
}

module.exports = { openDb };
