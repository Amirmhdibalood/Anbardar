import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { can, ROLE_PERMISSIONS, ROLES } from '../src/models/permissions'
import { createCatalogService } from '../src/services/catalogService'
import { createChequeService } from '../src/services/chequeService'
import { createExpenseService } from '../src/services/expenseService'
import { createStockService } from '../src/services/inventoryService'
import { createMoneyService } from '../src/services/moneyService'
import { hashPin, verifyPin } from '../src/services/pin'
import { createPurchaseService } from '../src/services/purchaseService'
import { createReportService } from '../src/services/reportService'
import { createReturnService, createTransferService } from '../src/services/returnService'
import { createSaleService } from '../src/services/saleService'
import * as S from '../src/services/secured'
import { setActor } from '../src/services/session'
import { createUserService } from '../src/services/userService'
import { dumpDatabase, validateDump } from '../src/database/snapshot'
import { expectAppError, Q, rowCount, setup } from './helpers'

const fast = { pinIterations: 1000 }

async function world() {
  const f = await setup()
  const users = createUserService(f.db, fast)
  const p = await f.catalog.products.create({ name: 'کالا', groupId: f.groupId })
  await createPurchaseService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(20), unitPrice: 1000 }] })
  return { f, users, p, sales: S.securedSales(f.db), money: S.securedMoney(f.db) }
}
const audits = (f: Awaited<ReturnType<typeof setup>>) => f.db.all<{ action: string; user_name: string; user_id: string | null; summary: string }>('SELECT action, user_name, user_id, summary FROM audit_log ORDER BY at, rowid')

beforeEach(() => setActor(null))

describe('stage 4: permission matrix', () => {
  it('owner has everything; manager no users/restore/settings; seller and storekeeper limited', () => {
    assert.equal(ROLE_PERMISSIONS.owner.size, 21)
    assert.ok(!can('manager', 'users.manage') && !can('manager', 'backup.restore') && can('manager', 'sales.cancel'))
    assert.ok(can('seller', 'sales.create') && !can('seller', 'sales.cancel') && !can('seller', 'costs.view') && !can('seller', 'purchases.create'))
    assert.ok(can('storekeeper', 'stock.adjust') && can('storekeeper', 'purchases.create') && !can('storekeeper', 'sales.create') && !can('storekeeper', 'money.create'))
    assert.ok(ROLES.every((r) => can(r, 'backup.create')))
    assert.equal(can(null, 'sales.create'), false)
  })
})

describe('stage 4: PIN hashing', () => {
  it('hash/verify with salt; never stores the PIN', async () => {
    const a = await hashPin('1234', 1000)
    const b = await hashPin('1234', 1000)
    assert.notEqual(a.hash, b.hash, 'random salt')
    assert.ok(!a.hash.includes('1234'))
    assert.equal(await verifyPin('1234', a), true)
    assert.equal(await verifyPin('1235', a), false)
  })
})

describe('stage 4: enforcement in the service layer', () => {
  it('single-user mode: everything allowed and audited as «مالک»', async () => {
    const { f, sales, p } = await world()
    await sales.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 5000 }] })
    const log = await audits(f)
    assert.equal(log.length, 1)
    assert.equal(log[0]!.action, 'sale.create')
    assert.equal(log[0]!.user_name, 'مالک')
    assert.equal(log[0]!.user_id, null)
  })
  it('once users exist, no session = auth_required; seller cannot cancel, nothing changes and nothing is logged', async () => {
    const { f, users, sales, p } = await world()
    const owner = await users.create({ name: 'علی', role: 'owner', pin: '1111' })
    const seller = await users.create({ name: 'سارا', role: 'seller', pin: '2222' })
    setActor(null)
    await expectAppError(sales.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 5000 }] }), 'auth_required')
    await users.login(seller.id, '2222')
    const inv = await sales.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 5000 }] })
    const before = (await audits(f)).length
    const err = await expectAppError(sales.cancel(inv.invoice.id), 'forbidden')
    assert.match(err.userMessage, /ابطال فاکتور فروش/)
    assert.equal((await createSaleService(f.db).detail(inv.invoice.id))!.invoice.status, 'active')
    assert.equal((await audits(f)).length, before, 'forbidden call writes no audit row')
    await expectAppError(S.securedPurchases(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 1 }] }), 'forbidden')
    await expectAppError(S.securedReports(f.db).profitLoss({} as never, 'fifo'), 'forbidden')
    // فروشنده فقط دریافت
    const cust = await createCatalogService(f.db).customers.create({ name: 'م' })
    await expectAppError(S.securedMoney(f.db).create({ kind: 'payment', partyId: cust.id, amount: 1000, method: 'cash' }), 'forbidden')
    // جزئیات فاکتور بدون بها برای فروشنده
    const d = (await sales.detail(inv.invoice.id)) as unknown as { costsHidden?: boolean; items: { costs: { fifo: number } }[] }
    assert.equal(d.costsHidden, true)
    assert.equal(d.items[0]!.costs.fifo, 0)
    await users.logout()
    await users.login(owner.id, '1111')
    await sales.cancel(inv.invoice.id)
    const log = await audits(f)
    const actions = log.map((l) => l.action)
    for (const a of ['users.enable', 'user.create', 'auth.login', 'sale.create', 'auth.logout', 'sale.cancel']) assert.ok(actions.includes(a), a)
    assert.equal(log.find((l) => l.action === 'sale.create')!.user_name, 'سارا')
    assert.equal(log.find((l) => l.action === 'sale.cancel')!.user_name, 'علی')
  })
  it('a deactivated user is blocked immediately, even mid-session', async () => {
    const { f, users, sales, p } = await world()
    await users.create({ name: 'علی', role: 'owner', pin: '1111' })
    const seller = await users.create({ name: 'سارا', role: 'seller', pin: '2222' })
    await users.setActive(seller.id, false)
    setActor({ userId: seller.id, name: 'سارا', role: 'seller' })
    await expectAppError(sales.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 5000 }] }), 'auth_required')
  })
  it('audit row and change commit or roll back together', async () => {
    const { f, sales, p } = await world()
    const before = await rowCount(f.db, 'sales_invoices')
    await expectAppError(sales.create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(999), unitPrice: 5000 }] }), 'insufficient_stock')
    assert.equal(await rowCount(f.db, 'sales_invoices'), before)
    assert.equal(await rowCount(f.db, 'audit_log'), 0)
  })
  it('every service method is either guarded or an explicit read (secure by default)', async () => {
    const f = await setup()
    const pairs: [object, Record<string, S.Rule>, readonly string[]][] = [
      [createSaleService(f.db), S.SALE_RULES, S.SALE_READS],
      [createPurchaseService(f.db), S.PURCHASE_RULES, S.PURCHASE_READS],
      [createReturnService(f.db), S.RETURN_RULES, S.RETURN_READS],
      [createTransferService(f.db), S.TRANSFER_RULES, S.TRANSFER_READS],
      [createMoneyService(f.db), S.MONEY_RULES, S.MONEY_READS],
      [createChequeService(f.db), S.CHEQUE_RULES, S.CHEQUE_READS],
      [createExpenseService(f.db), S.EXPENSE_RULES, S.EXPENSE_READS],
      [createReportService(f.db), S.REPORT_RULES, S.REPORT_READS],
      [createStockService(f.db), S.STOCK_RULES, S.STOCK_READS],
      [createCatalogService(f.db), S.CATALOG_RULES, S.CATALOG_READS],
    ]
    const walk = (o: object, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'function' ? [p + k] : v && typeof v === 'object' ? walk(v as object, `${p}${k}.`) : []))
    for (const [svc, rules, reads] of pairs) {
      for (const m of walk(svc)) assert.ok(m in rules || reads.includes(m), `unclassified method: ${m}`)
      for (const r of reads) assert.ok(!/create|cancel|update|remove|adjust|setActive|clear|bounce|spend|^settle(Balance)?$/.test(r.split('.').pop()!), `write-like read: ${r}`)
    }
  })
})

describe('stage 4: users', () => {
  it('first user must be owner; duplicate names rejected; last owner protected', async () => {
    const f = await setup()
    const users = createUserService(f.db, fast)
    await expectAppError(users.create({ name: 'س', role: 'seller', pin: '1234' }), 'validation')
    await expectAppError(users.create({ name: 'ع', role: 'owner', pin: '12' }), 'validation')
    const owner = await users.create({ name: 'علی', role: 'owner', pin: '1111' })
    await expectAppError(users.create({ name: ' علی ', role: 'seller', pin: '2222' }), 'duplicate')
    const m = await users.create({ name: 'مدیر', role: 'manager', pin: '3333' })
    await expectAppError(users.update(owner.id, { role: 'manager' }), 'protected')
    await expectAppError(users.setActive(owner.id, false), 'protected')
    await expectAppError(f.db.run("UPDATE users SET role = 'manager' WHERE id = ?", [owner.id]), 'protected')
    await expectAppError(f.db.run('DELETE FROM users WHERE id = ?', [m.id]), 'immutable')
    await users.logout()
    await users.login(m.id, '3333')
    await expectAppError(users.create({ name: 'x', role: 'seller', pin: '4444' }), 'forbidden')
  })
  it('wrong PIN lockout after 5 attempts (doubling), reset on success', async () => {
    const f = await setup()
    let t = Date.parse('2026-10-13T08:00:00Z')
    const users = createUserService(f.db, { ...fast, now: () => t })
    const o = await users.create({ name: 'علی', role: 'owner', pin: '1111' })
    await users.logout()
    for (let i = 0; i < 4; i++) await expectAppError(users.login(o.id, '0000'), 'validation')
    const e = await expectAppError(users.login(o.id, '0000'), 'validation')
    assert.match(e.userMessage, /قفل/)
    await expectAppError(users.login(o.id, '1111'), 'forbidden', 'ثانیه')
    t += 31_000
    await expectAppError(users.login(o.id, '0000'), 'validation', '۶۰')
    t += 61_000
    await users.login(o.id, '1111')
    const row = await f.db.get<{ failed_attempts: number }>('SELECT failed_attempts FROM users WHERE id = ?', [o.id])
    assert.equal(row!.failed_attempts, 0)
    assert.equal((await audits(f)).filter((a) => a.action === 'auth.fail').length, 6)
  })
  it('audit log is append-only; dumps include users and audit', async () => {
    const f = await setup()
    const users = createUserService(f.db, fast)
    await users.create({ name: 'علی', role: 'owner', pin: '1111' })
    await expectAppError(f.db.run("UPDATE audit_log SET summary = 'x'"), 'immutable')
    await expectAppError(f.db.run('DELETE FROM audit_log'), 'immutable')
    const dump = await dumpDatabase(f.db, 9, 'test')
    assert.equal(dump.tables.users!.length, 1)
    assert.ok(dump.tables.audit_log!.length >= 1)
    assert.ok(validateDump(JSON.parse(JSON.stringify(dump)), 9).ok)
    const broken = JSON.parse(JSON.stringify(dump))
    delete broken.tables.audit_log
    assert.equal(validateDump(broken, 9).ok, false)
  })
  it('disabling users returns to single-user mode', async () => {
    const f = await setup()
    const users = createUserService(f.db, fast)
    await users.create({ name: 'علی', role: 'owner', pin: '1111' })
    await users.create({ name: 'سارا', role: 'seller', pin: '2222' })
    await users.disableUsers()
    assert.equal(await users.enabled(), false)
    const p = await f.catalog.products.create({ name: 'ک', groupId: f.groupId })
    await S.securedStock(f.db).adjust({ productId: p.id, warehouseId: f.warehouseId, kind: 'count', quantity: Q(2) } as never)
  })
})
