import type { BaseEntity, IsoDateTime, Money } from './common'

/**
 * دسته‌های ثابت هزینه جاری (با CHECK دیتابیس در Migration 004 یکی است).
 * برای هزینه‌ای که در هیچ دسته نیست «سایر» + توضیح.
 */
export const EXPENSE_CATEGORIES = ['rent', 'salary', 'bills', 'transport', 'other'] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

const LABELS: Record<ExpenseCategory, string> = {
  rent: 'اجاره',
  salary: 'حقوق و دستمزد',
  bills: 'قبوض (آب، برق، گاز، تلفن)',
  transport: 'حمل‌ونقل',
  other: 'سایر',
}

/** برچسب کوتاه برای فهرست‌ها و نمودار */
const SHORT_LABELS: Record<ExpenseCategory, string> = { ...LABELS, bills: 'قبوض' }

export function expenseCategoryLabel(category: ExpenseCategory, short = false): string {
  return (short ? SHORT_LABELS : LABELS)[category]
}

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === 'string' && (EXPENSE_CATEGORIES as readonly string[]).includes(value)
}

export type ExpenseStatus = 'active' | 'cancelled'

/** یک هزینه جاری ثبت‌شده؛ تغییرناپذیر (فقط ابطال) */
export interface Expense extends BaseEntity {
  category: ExpenseCategory
  /** تومان، عدد صحیح و بیشتر از صفر */
  amount: Money
  expenseDate: IsoDateTime
  note: string | null
  status: ExpenseStatus
  cancelledAt: IsoDateTime | null
  cancelReason: string | null
}

export interface ExpenseInput {
  category: ExpenseCategory
  amount: Money
  /** پیش‌فرض: اکنون */
  expenseDate?: IsoDateTime
  note?: string | null
}

export interface ExpenseFilter {
  from?: IsoDateTime
  /** انحصاری (تا قبل از این لحظه) */
  to?: IsoDateTime
  status?: ExpenseStatus
  category?: ExpenseCategory
  limit?: number
  offset?: number
}
