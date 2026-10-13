import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createExpenseService } from '../src/services/expenseService'
import { createReportService } from '../src/services/reportService'
import { EXPENSE_CATEGORIES } from '../src/models/expense'
import { expectAppError, setup } from './helpers'
import { fromJalali, toJalali } from '../src/utils/jalali'
import { resolvePeriod } from '../src/utils/period'

describe('expenses (phase 8)', () => {
  it('exposes fixed expense categories', () => {
    assert.deepEqual([...EXPENSE_CATEGORIES], ['rent', 'salary', 'bills', 'transport', 'other'])
  })

  it('creates and lists an expense; cancel removes it from P&L', async () => {
    const fx = await setup()
    const svc = createExpenseService(fx.db)
    const today = toJalali(new Date())
    const expenseDate = fromJalali(today, 12, 0).toISOString()
    const e = await svc.create({
      category: 'rent',
      expenseDate,
      amount: 5_000_000,
      note: 'اجاره مهر',
    })
    assert.equal(e.amount, 5_000_000)
    assert.equal(e.status, 'active')
    assert.equal(e.category, 'rent')

    const list = await svc.list({ status: 'active' })
    assert.equal(list.length, 1)

    const period = resolvePeriod({ key: 'today' })
    const reports = createReportService(fx.db)
    const pl = await reports.profitLoss({ from: period.from, to: period.to }, 'fifo')
    assert.equal(pl.expenseTotal, 5_000_000)
    assert.equal(pl.revenue, 0)
    assert.equal(pl.cogs, 0)
    assert.equal(pl.netProfit, -5_000_000)
    assert.equal(pl.expenses[0]?.category, 'rent')

    await svc.cancel(e.id, 'اشتباه')
    const pl2 = await reports.profitLoss({ from: period.from, to: period.to }, 'fifo')
    assert.equal(pl2.expenseTotal, 0)
    await expectAppError(svc.cancel(e.id, null), 'immutable')
  })

  it('rejects invalid amount and category', async () => {
    const fx = await setup()
    const svc = createExpenseService(fx.db)
    await expectAppError(svc.create({ category: 'rent', amount: 0 }), 'validation')
    await expectAppError(svc.create({ category: 'nope' as 'rent', amount: 100 }), 'validation')
  })

  it('migration 004 creates expenses table', async () => {
    const fx = await setup()
    const tables = await fx.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name = 'expenses'")
    assert.equal(tables.length, 1)
    const version = await fx.db.get<{ version: number }>('SELECT MAX(version) AS version FROM schema_migrations')
    assert.equal(Number(version?.version), 8)
  })
})
