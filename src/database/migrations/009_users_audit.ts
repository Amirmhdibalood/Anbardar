import type { Migration } from './types'

/**
 * Migration 009 — کاربران، نقش‌ها و گزارش فعالیت (Audit). طراحی: docs/stage4-users-roles-audit.md
 * - users: PIN فقط به‌صورت هش PBKDF2 با نمک ذخیره می‌شود.
 * - آخرین مالک فعال قابل غیرفعال‌شدن/تغییر نقش نیست (last_owner).
 * - audit_log فقط افزودنی است (بدون UPDATE/DELETE).
 */
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

const LAST_OWNER = `(SELECT COUNT(*) FROM users WHERE role = 'owner' AND is_active = 1 AND id <> OLD.id) = 0`

export const migration009: Migration = {
  version: 9,
  name: 'users_audit',
  statements: [
    `CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'seller', 'storekeeper')),
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  pin_iter INTEGER NOT NULL CHECK (pin_iter > 0),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT
)`,
    `CREATE UNIQUE INDEX ux_users_name ON users (lower(trim(name))) WHERE is_active = 1`,
    `CREATE TRIGGER trg_users_last_owner_update BEFORE UPDATE OF role, is_active ON users
WHEN OLD.role = 'owner' AND OLD.is_active = 1 AND (NEW.role <> 'owner' OR NEW.is_active = 0) AND ${LAST_OWNER}
  AND (SELECT COUNT(*) FROM users WHERE is_active = 1 AND id <> OLD.id) > 0
BEGIN SELECT RAISE(ABORT, 'last_owner'); END`,
    `CREATE TRIGGER trg_users_no_delete BEFORE DELETE ON users
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (${NOW}),
  user_id TEXT REFERENCES users (id),
  user_name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 60),
  entity_type TEXT,
  entity_id TEXT,
  summary TEXT NOT NULL
)`,
    `CREATE INDEX ix_audit_at ON audit_log (at)`,
    `CREATE INDEX ix_audit_user ON audit_log (user_id, at)`,
    `CREATE INDEX ix_audit_action ON audit_log (action, at)`,
    `CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_immutable'); END`,
    `CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_immutable'); END`,
  ],
}
