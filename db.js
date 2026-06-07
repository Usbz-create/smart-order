const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Wrapper to mimic sqlite3 API so server.js needs zero changes
const db = {
  get(query, params, callback) {
    const pgQuery = toPostgres(query);
    pool.query(pgQuery, params).then(result => {
      callback(null, result.rows[0] || null);
    }).catch(err => callback(err));
  },

  all(query, params, callback) {
    const pgQuery = toPostgres(query);
    pool.query(pgQuery, params).then(result => {
      callback(null, result.rows);
    }).catch(err => callback(err));
  },

  run(query, params, callback) {
    if (typeof params === "function") { callback = params; params = []; }
    const pgQuery = toPostgres(query);
    pool.query(pgQuery, params).then(result => {
      const ctx = {
        lastID:  result.rows[0]?.id || null,
        changes: result.rowCount    || 0
      };
      if (callback) callback.call(ctx, null);
    }).catch(err => {
      if (callback) callback.call({}, err);
    });
  },

  serialize(fn) { fn(); }
};

// Convert SQLite ? placeholders → PostgreSQL $1 $2 ...
function toPostgres(query) {
  let i = 0;
  return query.replace(/\?/g, () => `$${++i}`);
}

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id          SERIAL PRIMARY KEY,
      table_number TEXT   NOT NULL,
      items        TEXT   NOT NULL,
      total_price  REAL   NOT NULL DEFAULT 0,
      status       TEXT   NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_pins (
      role TEXT PRIMARY KEY,
      pin  TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id        SERIAL PRIMARY KEY,
      name      TEXT NOT NULL UNIQUE,
      price     REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `);

  await pool.query(`
    INSERT INTO role_pins (role, pin) VALUES
      ('admin',   '9999'),
      ('cook',    '1234'),
      ('waiter',  '5678'),
      ('counter', '4321')
    ON CONFLICT (role) DO NOTHING
  `);

  await pool.query(`
    INSERT INTO menu_items (name, price, is_active) VALUES
      ('Momo',     120, 1),
      ('Chowmein', 100, 1),
      ('Coke',      60, 1)
    ON CONFLICT (name) DO NOTHING
  `);

  // Recreate session table with correct schema on every deploy.
  // Safe — no FK references point here.
  await pool.query(`DROP TABLE IF EXISTS table_sessions CASCADE`);
  await pool.query(`
    CREATE TABLE table_sessions (
      session_id     TEXT PRIMARY KEY,
      table_number   TEXT NOT NULL,
      device_id      TEXT NOT NULL DEFAULT 'legacy',
      bill_requested INTEGER NOT NULL DEFAULT 0,
      locked_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ts_table_device ON table_sessions (table_number, device_id)
  `);

  await pool.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS session_id TEXT
  `);

  console.log("Database ready.");
}

initDB().catch(err => console.error("DB init failed:", err.message));

module.exports = db;
