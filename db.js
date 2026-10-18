// Capa de datos: usa PostgreSQL si existe DATABASE_URL (Render),
// y SQLite embebido (node:sqlite) en desarrollo local.
// Las consultas se escriben con "?" y se adaptan a "$1, $2..." para Postgres.

const path = require('path');
const fs = require('fs');

const usePg = Boolean(process.env.DATABASE_URL);
let pgPool = null;
let sqlite = null;

const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  year INTEGER,
  publisher TEXT NOT NULL DEFAULT '',
  isbn TEXT NOT NULL DEFAULT '',
  pages INTEGER,
  format TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  synopsis TEXT NOT NULL DEFAULT '',
  cover_image TEXT NOT NULL DEFAULT '',
  cover_color TEXT NOT NULL DEFAULT '#2B3A55',
  published INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  items TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  shipping_cost INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente',
  shipping TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS content (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

// Postgres: mismo esquema, con SERIAL en lugar de AUTOINCREMENT.
const SCHEMA_PG = SCHEMA_SQLITE.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function init() {
  if (usePg) {
    const { Pool } = require('pg');
    const ssl = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false };
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });
    await pgPool.query(SCHEMA_PG);
  } else {
    const { DatabaseSync } = require('node:sqlite');
    const file = process.env.SQLITE_FILE || path.join(__dirname, 'data', 'sitio.db');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    sqlite = new DatabaseSync(file);
    sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    sqlite.exec(SCHEMA_SQLITE);
  }
}

// Devuelve filas (SELECT o sentencias con RETURNING).
async function all(sql, params = []) {
  if (usePg) {
    const r = await pgPool.query(toPg(sql), params);
    return r.rows;
  }
  return sqlite.prepare(sql).all(...params);
}

async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0] || null;
}

// Ejecuta INSERT/UPDATE/DELETE y devuelve la cantidad de filas afectadas.
async function run(sql, params = []) {
  if (usePg) {
    const r = await pgPool.query(toPg(sql), params);
    return r.rowCount;
  }
  const r = sqlite.prepare(sql).run(...params);
  return Number(r.changes);
}

module.exports = { init, all, get, run, dialect: usePg ? 'postgres' : 'sqlite' };
