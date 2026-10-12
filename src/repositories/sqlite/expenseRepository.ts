import type { SqlExecutor, SqlRow, SqlValue } from '../../database/types'
import type { IsoDateTime } from '../../models/common'
import type { Expense, ExpenseCategory, ExpenseFilter, ExpenseInput, ExpenseStatus } from '../../models/expense'
import { newId } from '../../utils/id'
import { nowIso } from '../../utils/time'
import type { ExpenseRepository } from '../types'
import { baseFromRow, insertSql, notFound, num, str, strOrNull } from './helpers'

function fromRow(r: SqlRow): Expense {
  return {
    ...baseFromRow(r),
    category: str(r, 'category') as ExpenseCategory,
    amount: num(r, 'amount'),
    expenseDate: str(r, 'expense_date'),
    note: strOrNull(r, 'note'),
    status: str(r, 'status') as ExpenseStatus,
    cancelledAt: strOrNull(r, 'cancelled_at'),
    cancelReason: strOrNull(r, 'cancel_reason'),
  }
}

export class SqliteExpenseRepository implements ExpenseRepository {
  constructor(private readonly db: SqlExecutor) {}

  async create(input: ExpenseInput & { expenseDate: IsoDateTime }): Promise<Expense> {
    const id = newId()
    const now = nowIso()
    const { sql, params } = insertSql('expenses', {
      id,
      category: input.category,
      amount: input.amount,
      expense_date: input.expenseDate,
      note: input.note ?? null,
      status: 'active',
      created_at: now,
      updated_at: now,
      is_active: 1,
      created_by: null,
    })
    await this.db.run(sql, params)
    return (await this.getById(id)) as Expense
  }

  async getById(id: string): Promise<Expense | null> {
    const row = await this.db.get('SELECT * FROM expenses WHERE id = ?', [id])
    return row ? fromRow(row) : null
  }

  async list(filter: ExpenseFilter = {}): Promise<Expense[]> {
    const where: string[] = []
    const params: SqlValue[] = []
    if (filter.from) {
      where.push('expense_date >= ?')
      params.push(filter.from)
    }
    if (filter.to) {
      where.push('expense_date < ?')
      params.push(filter.to)
    }
    if (filter.status) {
      where.push('status = ?')
      params.push(filter.status)
    }
    if (filter.category) {
      where.push('category = ?')
      params.push(filter.category)
    }
    let sql = `SELECT * FROM expenses ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY expense_date DESC, created_at DESC, id DESC`
    if (filter.limit !== undefined) {
      sql += ' LIMIT ? OFFSET ?'
      params.push(filter.limit, filter.offset ?? 0)
    }
    return (await this.db.all(sql, params)).map(fromRow)
  }

  async markCancelled(id: string, reason: string | null, at: IsoDateTime): Promise<void> {
    const result = await this.db.run("UPDATE expenses SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ? AND status = 'active'", [
      at,
      reason,
      at,
      id,
    ])
    if (result.changes === 0) throw notFound('هزینه')
  }
}
