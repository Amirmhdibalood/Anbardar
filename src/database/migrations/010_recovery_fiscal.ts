import type { Migration } from './types'

/**
 * Migration 010 — سؤال‌های بازیابی رمز و دوره‌های مالی. طراحی: docs/stage5-fiscal-periods.md
 * همه دستورها IF NOT EXISTS هستند (اجرای دوباره بی‌خطر است).
 */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

export const migration010: Migration = {
  version: 10,
  name: 'recovery_fiscal',
  statements: [
    `CREATE TABLE IF NOT EXISTS user_recovery (
  user_id TEXT PRIMARY KEY REFERENCES users (id),
  q1 TEXT NOT NULL CHECK (length(trim(q1)) BETWEEN 3 AND 120),
  a1_hash TEXT NOT NULL,
  a1_salt TEXT NOT NULL,
  q2 TEXT NOT NULL CHECK (length(trim(q2)) BETWEEN 3 AND 120),
  a2_hash TEXT NOT NULL,
  a2_salt TEXT NOT NULL,
  iter INTEGER NOT NULL CHECK (iter > 0),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (${NOW})
)`,
    `CREATE TABLE IF NOT EXISTS fiscal_periods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  start_day TEXT NOT NULL CHECK (start_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  end_day TEXT NOT NULL CHECK (end_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at TEXT,
  closed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}),
  CHECK (start_day <= end_day AND start_at < end_at),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_fiscal_start ON fiscal_periods (start_day)`,
    `CREATE INDEX IF NOT EXISTS ix_fiscal_range ON fiscal_periods (start_at, end_at)`,
    `CREATE TRIGGER IF NOT EXISTS trg_fiscal_no_overlap BEFORE INSERT ON fiscal_periods
WHEN EXISTS (SELECT 1 FROM fiscal_periods p WHERE p.start_day <= NEW.end_day AND NEW.start_day <= p.end_day)
BEGIN SELECT RAISE(ABORT, 'fiscal_overlap'); END`,
    `CREATE TRIGGER IF NOT EXISTS trg_fiscal_no_delete_closed BEFORE DELETE ON fiscal_periods
WHEN OLD.status = 'closed'
BEGIN SELECT RAISE(ABORT, 'fiscal_closed'); END`,
    `CREATE TABLE IF NOT EXISTS fiscal_balances (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES fiscal_periods (id),
  kind TEXT NOT NULL CHECK (kind IN ('party', 'stock', 'layer', 'cash')),
  party_id TEXT REFERENCES parties (id),
  product_id TEXT REFERENCES products (id),
  warehouse_id TEXT REFERENCES warehouses (id),
  lot_id TEXT REFERENCES cost_lots (id),
  quantity INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0
)`,
    `CREATE INDEX IF NOT EXISTS ix_fiscal_balances ON fiscal_balances (period_id, kind)`,
  ],
}
