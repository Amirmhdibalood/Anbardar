import type { Migration } from './types'

/**
 * Migration 004 — ثبت هزینه‌های جاری (اجاره، حقوق، قبوض، حمل‌ونقل، سایر).
 *
 * - مبلغ عدد صحیح تومان و بیشتر از صفر است؛ تاریخ ISO (روز شمسی انتخاب‌شده کاربر).
 * - هزینه مثل فاکتور «تغییرناپذیر» است: حذف و ویرایش مبلغ/تاریخ/دسته ممنوع؛ فقط ابطال با دلیل (و ویرایش یادداشت).
 * - دسته‌ها ثابت‌اند و با CHECK محدود شده‌اند (برچسب فارسی در src/models/expense.ts). افزودن دسته = Migration جدید.
 * - هزینه‌ها در گزارش سود و زیان و نمودار درآمد/هزینه جدا از «بهای کالای فروش‌رفته» و «خرید کالا» نمایش داده می‌شوند.
 */

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

export const EXPENSE_CATEGORY_SQL = "'rent', 'salary', 'bills', 'transport', 'other'"

export const migration004: Migration = {
  version: 4,
  name: 'operating expenses',
  statements: [
    `CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN (${EXPENSE_CATEGORY_SQL})),
  amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 1000000000000000),
  expense_date TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at TEXT,
  cancel_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT,
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
)`,
    `CREATE INDEX ix_expenses_date ON expenses (expense_date)`,
    `CREATE INDEX ix_expenses_category ON expenses (category)`,
    `CREATE TRIGGER trg_expenses_immutable BEFORE UPDATE ON expenses
WHEN OLD.status = 'cancelled'
  OR NEW.category IS NOT OLD.category
  OR NEW.amount IS NOT OLD.amount
  OR NEW.expense_date IS NOT OLD.expense_date
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
    `CREATE TRIGGER trg_expenses_no_delete BEFORE DELETE ON expenses
BEGIN SELECT RAISE(ABORT, 'document_immutable'); END`,
  ],
}
