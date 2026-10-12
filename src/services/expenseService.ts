import type { SqlExecutor } from '../database/types'
import { EXPENSE_CATEGORIES, isExpenseCategory, type Expense, type ExpenseFilter, type ExpenseInput } from '../models/expense'
import { MAX_AMOUNT } from '../models/limits'
import { createRepositories } from '../repositories'
import { AppError, ValidationError } from '../utils/errors'
import { nowIso } from '../utils/time'
import { cleanText, Fields, optionalIsoDate } from '../validation/fields'

const MAX_NOTE = 200

/** اعتبارسنجی ورودی ثبت هزینه (دسته، مبلغ صحیح تومان، تاریخ، توضیح) */
export function validateExpense(input: ExpenseInput): ExpenseInput {
  const f = new Fields()
  if (!isExpenseCategory(input.category)) f.fail('category', 'دسته هزینه را انتخاب کنید.')
  if (typeof input.amount !== 'number' || !Number.isSafeInteger(input.amount)) f.fail('amount', 'مبلغ باید عدد صحیح (تومان) باشد.')
  else if (input.amount <= 0) f.fail('amount', 'مبلغ هزینه را بیشتر از صفر وارد کنید.')
  else if (input.amount > MAX_AMOUNT) f.fail('amount', 'مبلغ بیش از حد مجاز است.')
  const expenseDate = optionalIsoDate(f, 'expenseDate', 'تاریخ', input.expenseDate)
  const note = cleanText(input.note)
  if (note.length > MAX_NOTE) f.fail('note', `توضیح نباید بیشتر از ${MAX_NOTE} نویسه باشد.`)
  f.done()
  return { category: input.category, amount: input.amount, expenseDate, note: note || null }
}

/** هزینه‌های جاری (اجاره، حقوق، قبوض، ...): ثبت، فهرست و ابطال (حذف/ویرایش ممنوع) */
export function createExpenseService(db: SqlExecutor) {
  return {
    categories: EXPENSE_CATEGORIES,

    async create(input: ExpenseInput): Promise<Expense> {
      const clean = validateExpense(input)
      return createRepositories(db).expenses.create({ ...clean, expenseDate: clean.expenseDate ?? nowIso() })
    },

    async cancel(id: string, reason?: string | null): Promise<void> {
      const why = cleanText(reason) || null
      if (why && why.length > MAX_NOTE) throw new ValidationError({ reason: `دلیل ابطال نباید بیشتر از ${MAX_NOTE} نویسه باشد.` })
      await db.transaction(async (tx) => {
        const r = createRepositories(tx)
        const expense = await r.expenses.getById(id)
        if (!expense) throw new AppError('not_found', 'هزینه پیدا نشد.')
        if (expense.status === 'cancelled') throw new AppError('immutable', 'این هزینه قبلاً ابطال شده است.')
        await r.expenses.markCancelled(id, why, nowIso())
      })
    },

    list: (filter?: ExpenseFilter) => createRepositories(db).expenses.list(filter),
    getById: (id: string) => createRepositories(db).expenses.getById(id),
  }
}
