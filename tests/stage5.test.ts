import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import type { SqlExecutor } from '../src/database/types'
import { MIGRATIONS } from '../src/database/migrations'
import { runMigrations } from '../src/database/migrations/runner'
import { seedIfNeeded } from '../src/database/seed'
import { dumpDatabase, MemorySnapshotStore, validateDump } from '../src/database/snapshot'
import { currentActor } from '../src/services/authz'
import { createFiscalService, jalaliYearRange } from '../src/services/fiscalService'
import { createPurchaseService } from '../src/services/purchaseService'
import * as S from '../src/services/secured'
import { getSessionSnapshot, setActor, setLoginOn } from '../src/services/session'
import { createUserService } from '../src/services/userService'
import { normalizeAnswer } from '../src/utils/answer'
import { fromJalali } from '../src/utils/jalali'
import { expectAppError, freshDb, Q, rowCount, setup } from './helpers'

const fast = { pinIterations: 1000 }
const at = (jy: number, jm: number, jd: number) => fromJalali({ jy, jm, jd }).toISOString()
const audits = async (f: { db: SqlExecutor }) => (await f.db.all<{ action: string; user_name: string }>('SELECT action, user_name FROM audit_log ORDER BY at, rowid')).map((r) => r.action)

beforeEach(() => {
  setActor(null)
  setLoginOn(true)
})

describe('stage 5: answer normalization', () => {
  it('trim, spaces, ZWNJ, Arabic letters, diacritics, digits, case', () => {
    assert.equal(normalizeAnswer('  علي  كريمي '), 'علی کریمی')
    assert.equal(normalizeAnswer('مي\u200Cخواهم'), normalizeAnswer('می خواهم'))
    assert.equal(normalizeAnswer('۱۴۰۵'), '1405')
    assert.equal(normalizeAnswer('١٢٣'), '123')
    assert.equal(normalizeAnswer('مُحَمَّد'), 'محمد')
    assert.equal(normalizeAnswer('TeHRan'), 'tehran')
    assert.equal(normalizeAnswer('خانۀ'), normalizeAnswer('خانه'))
  })
})

async function usersWorld() {
  const f = await setup()
  const users = createUserService(f.db, fast)
  const owner = await users.create({ name: 'امیر', role: 'owner', pin: '1234' })
  const seller = await users.create({ name: 'سارا', role: 'seller', pin: '5555' })
  return { f, users, owner, seller }
}

describe('stage 5: security questions & recovery', () => {
  it('stores only salted hashes; needs the current PIN; recovers with normalized answers', async () => {
    const { f, users, seller } = await usersWorld()
    await expectAppError(users.setRecovery(seller.id, '0000', { q1: 'نام اولین مدرسه؟', a1: 'فردوسی', q2: 'شهر تولد؟', a2: 'كرج' }), 'validation', 'رمز اشتباه')
    await users.setRecovery(seller.id, '5555', { q1: 'نام اولین مدرسه؟', a1: 'فردوسی', q2: 'شهر تولد؟', a2: 'كرج' })
    const row = await f.db.get<Record<string, string>>('SELECT * FROM user_recovery WHERE user_id = ?', [seller.id])
    assert.ok(row && !JSON.stringify(row).includes('فردوسی') && !JSON.stringify(row).includes('کرج') && row.a1_salt !== row.a2_salt)
    assert.deepEqual(await users.recoveryQuestions(seller.id), { q1: 'نام اولین مدرسه؟', q2: 'شهر تولد؟' })
    await expectAppError(users.recover(seller.id, { a1: 'فردوسی', a2: 'تهران' }, '9999'), 'validation', 'پاسخ‌ها درست نیست')
    setActor(null)
    const a = await users.recover(seller.id, { a1: '  فردوسي ', a2: 'کرج' }, '9999')
    assert.equal(a.userId, seller.id)
    setActor(null)
    await users.login(seller.id, '9999')
    const log = await audits(f)
    assert.ok(log.includes('user.recovery') && log.includes('auth.recover_fail') && log.includes('auth.recover'))
  })

  it('wrong answers are rate-limited like PINs', async () => {
    let t = Date.parse('2026-10-13T10:00:00Z')
    const f = await setup()
    const users = createUserService(f.db, { ...fast, now: () => t })
    const o = await users.create({ name: 'امیر', role: 'owner', pin: '1234' })
    await users.setRecovery(o.id, '1234', { q1: 'سؤال یک', a1: 'الف', q2: 'سؤال دو', a2: 'ب ب' })
    for (let i = 0; i < 4; i++) await expectAppError(users.recover(o.id, { a1: 'x', a2: 'y' }, '1111'), 'validation')
    await expectAppError(users.recover(o.id, { a1: 'x', a2: 'y' }, '1111'), 'validation', 'قفل')
    await expectAppError(users.recover(o.id, { a1: 'الف', a2: 'ب ب' }, '1111'), 'forbidden', 'ثانیه')
    t += 31_000
    await users.recover(o.id, { a1: 'الف', a2: 'ب ب' }, '1111')
  })

  it('no questions → clear Persian message', async () => {
    const { users, seller } = await usersWorld()
    assert.equal(await users.recoveryQuestions(seller.id), null)
    await expectAppError(users.recover(seller.id, { a1: 'a', a2: 'b' }, '1111'), 'not_found', 'سؤال بازیابی')
  })
})

describe('stage 5: login off', () => {
  it('owner PIN required; then the app acts as the owner without a session; audited; back on works', async () => {
    const { f, users, owner } = await usersWorld()
    await expectAppError(users.setLoginRequired(false, '0000'), 'validation', 'رمز اشتباه')
    assert.equal(await users.loginRequired(), true)
    await users.setLoginRequired(false, '1234')
    assert.equal(await users.loginRequired(), false)
    assert.equal(getSessionSnapshot().loginOn, false)
    setActor(null) // مثل اجرای دوباره برنامه
    const a = await currentActor(f.db)
    assert.deepEqual(a, { userId: owner.id, name: 'امیر', role: 'owner' })
    await S.securedExpenses(f.db).create({ amount: 1000, category: 'other' } as never).catch(() => undefined)
    await users.setLoginRequired(true)
    setActor(null)
    assert.equal(await currentActor(f.db), null)
    const log = await audits(f)
    assert.ok(log.includes('auth.login_off') && log.includes('auth.login_on'))
  })

  it('a seller cannot turn login off', async () => {
    const { users, seller } = await usersWorld()
    setActor(null)
    await users.login(seller.id, '5555')
    await expectAppError(users.setLoginRequired(false, '5555'), 'forbidden')
  })
})

async function fiscalWorld() {
  const f = await setup()
  const fiscal = createFiscalService(f.db)
  const p = await f.catalog.products.create({ name: 'کالا', groupId: f.groupId })
  const c = await f.catalog.customers.create({ name: 'علی' })
  f.customerId = c.id
  const purchases = S.securedPurchases(f.db)
  const sales = S.securedSales(f.db)
  const money = S.securedMoney(f.db)
  const expenses = S.securedExpenses(f.db)
  const pur = await purchases.create({ warehouseId: f.warehouseId, invoiceDate: at(1404, 3, 1), items: [{ productId: p.id, quantity: Q(10), unitPrice: 1000 }] })
  const sale = await sales.create({ warehouseId: f.warehouseId, customerId: f.customerId, invoiceDate: at(1404, 5, 1), items: [{ productId: p.id, quantity: Q(4), unitPrice: 3000 }] })
  await money.create({ kind: 'receipt', partyId: f.customerId, amount: 5000, method: 'cash', docDate: at(1404, 6, 1) })
  // سند سال بعد (بعد از پایان دوره) نباید در مانده انتقالی بیاید
  await sales.create({ warehouseId: f.warehouseId, customerId: f.customerId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 3000 }] })
  return { f, fiscal, p, pur, sale, purchases, sales, money, expenses }
}

describe('stage 5: fiscal periods', () => {
  it('default range is a full Jalali year (leap aware)', () => {
    assert.deepEqual(jalaliYearRange(1404), { startDay: '1404-01-01', endDay: '1404-12-29', name: 'سال مالی ۱۴۰۴' })
    assert.equal(jalaliYearRange(1403).endDay, '1403-12-30')
  })

  it('no overlap; close only after it ended; close snapshots balances as of the end', async () => {
    const { f, fiscal, p } = await fiscalWorld()
    const y = await fiscal.create(jalaliYearRange(1404))
    await expectAppError(fiscal.create({ name: 'هم‌پوشان', startDay: '1404-06-01', endDay: '1405-05-31' }), 'validation', 'هم‌پوشانی')
    const cur = await fiscal.create(jalaliYearRange(1405))
    await expectAppError(fiscal.close(cur.id), 'validation', 'تمام نشده')
    const closed = await fiscal.close(y.id)
    assert.equal(closed.status, 'closed')
    const b = await fiscal.balances(y.id)
    // فاکتورها به‌طور پیش‌فرض نقد تسویه می‌شوند: −۱۰۰۰۰ + ۱۲۰۰۰ + ۵۰۰۰ (دریافت اضافه = بستانکاری مشتری)
    assert.equal(b.cash, 7000)
    assert.deepEqual(b.parties.map((x) => x.balance), [-5000])
    assert.equal(b.payable, 5000)
    assert.equal(b.stock.length, 1)
    assert.equal(b.stock[0]!.quantity, Q(6))
    assert.equal(b.stock[0]!.value, 6000)
    assert.equal(b.layers, 1)
    assert.equal(b.stock[0]!.productId, p.id)
    assert.ok((await audits(f)).includes('fiscal.close'))
  })

  it('closed period locks create, back-date and void in the service layer', async () => {
    const { f, fiscal, p, pur, sale, purchases, sales, money, expenses } = await fiscalWorld()
    const y = await fiscal.create(jalaliYearRange(1404))
    await fiscal.close(y.id)
    const msg = 'بسته است'
    await expectAppError(sales.create({ warehouseId: f.warehouseId, customerId: f.customerId, invoiceDate: at(1404, 8, 1), items: [{ productId: p.id, quantity: Q(1), unitPrice: 3000 }] }), 'immutable', msg)
    await expectAppError(purchases.cancel(pur.invoice.id), 'immutable', msg)
    await expectAppError(sales.cancel(sale.invoice.id), 'immutable', msg)
    await expectAppError(money.create({ kind: 'payment', partyId: f.customerId, amount: 100, method: 'cash', docDate: at(1404, 12, 29) }), 'immutable', msg)
    await expectAppError(expenses.create({ amount: 100, expenseDate: at(1404, 1, 1), category: 'other' } as never), 'immutable', msg)
    await expectAppError(S.securedStock(f.db).adjust({ productId: p.id, warehouseId: f.warehouseId, kind: 'waste', quantity: Q(1), occurredAt: at(1404, 2, 1) } as never), 'immutable', msg)
    // اسناد امروز آزادند
    await sales.create({ warehouseId: f.warehouseId, customerId: f.customerId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 3000 }] })
    // بازگشایی (فقط مالک) ← دوباره مجاز
    await fiscal.reopen(y.id)
    assert.equal(await rowCount(f.db, 'fiscal_balances'), 0)
    await purchases.cancel(pur.invoice.id).catch((e) => assert.notEqual(e.code, 'immutable'))
    assert.ok((await audits(f)).includes('fiscal.reopen'))
  })

  it('order: earlier open period blocks close; later closed period blocks reopen; only the owner manages', async () => {
    const { f, fiscal } = await fiscalWorld()
    const a = await fiscal.create(jalaliYearRange(1402))
    const b = await fiscal.create(jalaliYearRange(1403))
    await expectAppError(fiscal.close(b.id), 'validation', 'دوره قبلی')
    await fiscal.close(a.id)
    await fiscal.close(b.id)
    await expectAppError(fiscal.reopen(a.id), 'validation', 'دوره بعدی')
    await expectAppError(fiscal.remove(b.id), 'immutable')
    const users = createUserService(f.db, fast)
    await users.create({ name: 'امیر', role: 'owner', pin: '1234' })
    const m = await users.create({ name: 'مدیر', role: 'manager', pin: '2222' })
    setActor(null)
    await users.login(m.id, '2222')
    await expectAppError(fiscal.reopen(b.id), 'forbidden', 'مالک')
  })

  it('backup dump includes fiscal tables and validates', async () => {
    const { f, fiscal } = await fiscalWorld()
    const y = await fiscal.create(jalaliYearRange(1404))
    await fiscal.close(y.id)
    const dump = await dumpDatabase(f.db, 10, 'test')
    assert.equal(dump.schemaVersion, 10)
    assert.ok(dump.tables.fiscal_periods && dump.tables.fiscal_balances && dump.tables.user_recovery)
    assert.equal(validateDump(JSON.parse(JSON.stringify(dump)), 10).ok, true)
  })
})

describe('stage 5: migration 010 upgrade from v1.4.0 data', () => {
  it('migrates a populated v9 database, keeps data, and is idempotent', async () => {
    const db = await freshDb()
    const snaps = new MemorySnapshotStore()
    await runMigrations(db, MIGRATIONS.slice(0, 9), snaps)
    await seedIfNeeded(db)
    const wh = (await db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'default_warehouse_id'"))!.value
    const grp = (await db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'default_product_group_id'"))!.value
    const { createCatalogService } = await import('../src/services/catalogService')
    const p = await createCatalogService(db).products.create({ name: 'قدیمی', groupId: grp })
    await createPurchaseService(db).create({ warehouseId: wh, items: [{ productId: p.id, quantity: Q(3), unitPrice: 700 }] })
    await createUserService(db, fast).create({ name: 'امیر', role: 'owner', pin: '1234' })
    const before = await rowCount(db, 'purchase_invoices')
    const report = await runMigrations(db, MIGRATIONS, snaps)
    assert.deepEqual(report.applied, [10])
    assert.equal(await rowCount(db, 'purchase_invoices'), before)
    assert.equal(await rowCount(db, 'users'), 1)
    assert.equal(await rowCount(db, 'fiscal_periods'), 0)
    const again = await runMigrations(db, MIGRATIONS, snaps)
    assert.deepEqual(again.applied, [])
    for (const s of MIGRATIONS[9]!.statements) await db.run(s) // دستورها به‌تنهایی هم دوباره‌اجراپذیرند
  })
})
