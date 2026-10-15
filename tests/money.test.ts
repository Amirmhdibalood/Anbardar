import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { MIGRATIONS } from '../src/database/migrations'
import { runMigrations } from '../src/database/migrations/runner'
import { MemorySnapshotStore, dumpDatabase, restoreDump, validateDump } from '../src/database/snapshot'
import { MISC_SUPPLIER_ID } from '../src/models/party'
import { createRepositories } from '../src/repositories'
import { createMoneyService, suggestOldestFirst } from '../src/services/moneyService'
import { createPurchaseService } from '../src/services/purchaseService'
import { createReturnService } from '../src/services/returnService'
import { createSaleService } from '../src/services/saleService'
import { Q, expectAppError, freshDb, rowCount, setup, type Fixture } from './helpers'

async function stocked(fx: Fixture, qty = 100) {
  const p = await fx.catalog.products.create({ name: 'برنج', groupId: fx.groupId })
  await createPurchaseService(fx.db).create({ warehouseId: fx.warehouseId, items: [{ productId: p.id, quantity: Q(qty), unitPrice: 100 }] })
  return p
}

const sell = (fx: Fixture, customerId: string | null, productId: string, qty: number, price: number, paidAmount?: number, invoiceDate?: string) =>
  createSaleService(fx.db).create({ customerId, warehouseId: fx.warehouseId, invoiceDate, paidAmount, items: [{ productId, quantity: Q(qty), unitPrice: price }] })

describe('migration 006: parties + money documents from a real v5 database', () => {
  it('moves customers/suppliers into parties without data loss and leaves every balance at zero', async () => {
    const db = await freshDb()
    const dump = JSON.parse(readFileSync(new URL('./fixtures/v5-dump.json', import.meta.url), 'utf8'))
    await restoreDump(db, dump)
    const snapshots = new MemorySnapshotStore()
    const report = await runMigrations(db, MIGRATIONS, snapshots)
    assert.deepEqual(report.applied, [6, 7, 8, 9, 10])
    assert.ok(report.snapshot, 'pre-migration snapshot taken')
    assert.deepEqual(await db.all('PRAGMA foreign_key_check'), [])
    assert.equal((await db.get<{ integrity_check: string }>('PRAGMA integrity_check'))?.integrity_check, 'ok')

    const old = dump.tables as Record<string, { id: string; name: string; phone: string | null; is_system: number }[]>
    const r = createRepositories(db)
    const parties = await r.parties.list({ includeInactive: true })
    assert.equal(parties.length, old['customers']!.length + old['suppliers']!.length)
    for (const c of old['customers']!) {
      const p = parties.find((x) => x.id === c.id)!
      assert.deepEqual([p.name, p.phone, p.isCustomer, p.isSupplier, p.isSystem], [c.name, c.phone, true, false, c.is_system === 1])
    }
    const misc = parties.find((p) => p.id === MISC_SUPPLIER_ID)!
    assert.deepEqual([misc.name, misc.isSupplier, misc.isSystem], ['متفرقه', true, true])
    assert.ok(parties.some((p) => p.name === 'مشتری نقدی' && p.isSystem && p.isCustomer))
    assert.equal(await rowCount(db, 'sales_invoices'), old['sales_invoices']!.length)
    assert.equal(await rowCount(db, 'purchase_invoices'), old['purchase_invoices']!.length)

    // نسخه ۱ همه نقدی بود: هیچ طرفی مانده ندارد، فاکتورها تسویه‌اند، و برگشت‌ها استرداد گرفته‌اند
    assert.deepEqual(await r.money.balances(), [])
    const sales = await r.salesInvoices.list({ status: 'active' })
    for (const [, s] of await r.money.invoiceSettlements('sales', sales.map((i) => i.id))) assert.equal(s.status, 'paid')
    const refunds = await r.money.listDocuments({ status: 'active' })
    assert.ok(refunds.some((d) => d.source === 'sale_return' && d.kind === 'payment'))
    assert.ok(refunds.some((d) => d.source === 'purchase_return' && d.kind === 'receipt'))
    assert.ok((await r.money.listDocuments({ status: 'cancelled' })).some((d) => d.source === 'sale'), 'payment of the cancelled invoice is cancelled')

    // سرویس‌ها روی داده منتقل‌شده کار می‌کنند و شمارنده‌ها ادامه پیدا می‌کنند
    const money = createMoneyService(db)
    const cust = parties.find((p) => p.name === 'علی رضایی')!
    await money.createOpening({ partyId: cust.id, amount: 1000, side: 'debit' })
    const rec = await money.create({ kind: 'receipt', partyId: cust.id, amount: 1000 })
    assert.equal(rec.docNumber, (await r.money.listDocuments({ kinds: ['receipt'] })).length, 'receipt numbering continues after migrated documents')
    assert.equal(await money.balanceOf(cust.id), 0)
  })

  it('backup of a v6 database restores every new table and the same balances; validator requires them', async () => {
    const fx = await setup()
    const p = await stocked(fx)
    const c = await fx.catalog.parties.create({ name: 'حسن', isCustomer: true, isSupplier: false })
    await sell(fx, c.id, p.id, 2, 500, 300)
    const money = createMoneyService(fx.db)
    await money.create({ kind: 'receipt', partyId: c.id, amount: 200 })
    const dump = await dumpDatabase(fx.db, 6, 'test')
    for (const t of ['parties', 'money_documents', 'settlements']) assert.ok(dump.tables[t]!.length > 0, t)
    assert.equal(validateDump(dump, 6).ok, true)
    const broken = { ...dump, tables: { ...dump.tables } }
    delete broken.tables['settlements']
    assert.equal(validateDump(broken, 6).ok, false)

    const db2 = await freshDb()
    await restoreDump(db2, dump)
    assert.equal(await createMoneyService(db2).balanceOf(c.id), 500)
    assert.deepEqual(await db2.all('PRAGMA foreign_key_check'), [])
  })
})

describe('receipts, payments and invoice payment status', () => {
  it('credit sale → partial → paid; allocations are capped and checked against party and remaining', async () => {
    const fx = await setup()
    const p = await stocked(fx)
    const money = createMoneyService(fx.db)
    const ali = await fx.catalog.parties.create({ name: 'علی', isCustomer: true })
    const reza = await fx.catalog.parties.create({ name: 'رضا', isCustomer: true })
    const inv1 = await sell(fx, ali.id, p.id, 1, 1000, 0, '2026-10-01T08:00:00.000Z')
    const inv2 = await sell(fx, ali.id, p.id, 1, 500, 100, '2026-10-02T08:00:00.000Z')
    assert.equal(await money.balanceOf(ali.id), 1400)
    assert.equal((await money.invoiceSettlement('sales', inv1.invoice.id))?.status, 'unpaid')
    assert.equal((await money.invoiceSettlement('sales', inv2.invoice.id))?.status, 'partial')

    const open = await money.openInvoices('sales', ali.id)
    assert.deepEqual(open.map((o) => [o.number, o.settlement.remaining]), [[inv1.invoice.invoiceNumber, 1000], [inv2.invoice.invoiceNumber, 400]])
    // پیشنهاد قدیمی‌ترین اول
    assert.deepEqual(suggestOldestFirst(open, 1200), [{ invoiceId: inv1.invoice.id, amount: 1000 }, { invoiceId: inv2.invoice.id, amount: 200 }])

    await expectAppError(money.create({ kind: 'receipt', partyId: ali.id, amount: 2000, allocations: [{ invoiceId: inv1.invoice.id, amount: 1001 }] }), 'validation', 'حداکثر')
    await expectAppError(money.create({ kind: 'receipt', partyId: ali.id, amount: 100, allocations: [{ invoiceId: inv1.invoice.id, amount: 200 }] }), 'validation', 'بیشتر')
    await expectAppError(money.create({ kind: 'receipt', partyId: reza.id, amount: 100, allocations: [{ invoiceId: inv1.invoice.id, amount: 100 }] }), 'validation')
    await expectAppError(money.create({ kind: 'payment', partyId: ali.id, amount: 100, allocations: [{ invoiceId: inv1.invoice.id, amount: 100 }] }), 'validation')
    await expectAppError(money.create({ kind: 'receipt', partyId: ali.id, amount: 0 }), 'validation')
    await expectAppError(money.create({ kind: 'receipt', partyId: ali.id, amount: 10.5 }), 'validation')

    await money.create({ kind: 'receipt', partyId: ali.id, amount: 1200, method: 'card', allocations: suggestOldestFirst(open, 1200) })
    assert.equal((await money.invoiceSettlement('sales', inv1.invoice.id))?.status, 'paid')
    assert.equal((await money.invoiceSettlement('sales', inv2.invoice.id))?.remaining, 200)
    assert.equal(await money.balanceOf(ali.id), 200)
    // باقیمانده تخصیص‌نیافته = علی‌الحساب
    await money.create({ kind: 'receipt', partyId: ali.id, amount: 500 })
    assert.equal(await money.balanceOf(ali.id), -300)
    const report = await money.balancesReport()
    assert.deepEqual(report.creditors.map((x) => [x.party.name, x.balance]), [['علی', -300]])
    assert.equal(report.totalPayable, 300)
  })

  it('cash customer and «متفرقه» cannot carry debt; paid amount is validated', async () => {
    const fx = await setup()
    const p = await stocked(fx)
    await expectAppError(sell(fx, null, p.id, 1, 1000, 500), 'validation', 'نسیه')
    await expectAppError(sell(fx, null, p.id, 1, 1000, 2000), 'validation', 'بیشتر')
    await expectAppError(sell(fx, null, p.id, 1, 1000, -1), 'validation')
    await expectAppError(
      createPurchaseService(fx.db).create({ warehouseId: fx.warehouseId, paidAmount: 0, items: [{ productId: p.id, quantity: Q(1), unitPrice: 100 }] }),
      'validation',
      'نسیه',
    )
    await expectAppError(createMoneyService(fx.db).create({ kind: 'receipt', partyId: fx.customerId, amount: 10 }), 'validation')
    const ok = await sell(fx, null, p.id, 1, 1000)
    assert.equal((await createMoneyService(fx.db).invoiceSettlement('sales', ok.invoice.id))?.status, 'paid')
    assert.deepEqual(await createRepositories(fx.db).money.balances(), [])
  })

  it('double submit with the same requestId creates exactly one document', async () => {
    const fx = await setup()
    const money = createMoneyService(fx.db)
    const c = await fx.catalog.parties.create({ name: 'مینا', isCustomer: true })
    const requestId = '0190f000-0000-7000-8000-000000000001'
    const [a, b] = await Promise.all([
      money.create({ kind: 'receipt', partyId: c.id, amount: 700, requestId }),
      money.create({ kind: 'receipt', partyId: c.id, amount: 700, requestId }),
    ])
    const again = await money.create({ kind: 'receipt', partyId: c.id, amount: 700, requestId })
    assert.equal(a.id, b.id)
    assert.equal(a.id, again.id)
    assert.equal(await rowCount(fx.db, 'money_documents'), 1)
  })

  it('opening balance is a real document; cancelling it restores the balance; documents cannot be edited or deleted', async () => {
    const fx = await setup()
    const money = createMoneyService(fx.db)
    const s = await fx.catalog.parties.create({ name: 'پخش', isSupplier: true })
    const op = await money.createOpening({ partyId: s.id, amount: 5000, side: 'credit' })
    assert.equal(await money.balanceOf(s.id), -5000)
    await expectAppError(fx.db.run('UPDATE money_documents SET amount = 1 WHERE id = ?', [op.id]), 'immutable')
    await expectAppError(fx.db.run('DELETE FROM money_documents WHERE id = ?', [op.id]), 'immutable')
    await money.cancel(op.id, 'اشتباه')
    assert.equal(await money.balanceOf(s.id), 0)
    await expectAppError(money.cancel(op.id), 'immutable')
  })

  it('cancelling an invoice cancels its automatic receipt; a manual receipt becomes on-account credit; auto docs cannot be cancelled alone', async () => {
    const fx = await setup()
    const p = await stocked(fx)
    const money = createMoneyService(fx.db)
    const c = await fx.catalog.parties.create({ name: 'سارا', isCustomer: true })
    const inv = await sell(fx, c.id, p.id, 1, 1000, 400)
    const auto = (await createRepositories(fx.db).money.listBySource('sale', inv.invoice.id))[0]!
    await expectAppError(money.cancel(auto.id), 'protected')
    await money.create({ kind: 'receipt', partyId: c.id, amount: 600, allocations: [{ invoiceId: inv.invoice.id, amount: 600 }] })
    assert.equal(await money.balanceOf(c.id), 0)
    await createSaleService(fx.db).cancel(inv.invoice.id, 'اشتباه')
    assert.equal((await money.get(auto.id))?.status, 'cancelled')
    assert.equal(await money.balanceOf(c.id), -600, 'customer has 600 credit')
    // اعتبار را می‌شود به فاکتور جدید داد
    const inv2 = await sell(fx, c.id, p.id, 1, 600, 0)
    assert.equal(await money.balanceOf(c.id), 0)
    assert.equal((await money.invoiceSettlement('sales', inv2.invoice.id))?.status, 'unpaid')
  })

  it('sale return on a cash invoice refunds automatically; on a credit invoice it only reduces the debt; cancel undoes the refund', async () => {
    const fx = await setup()
    const p = await stocked(fx)
    const money = createMoneyService(fx.db)
    const returns = createReturnService(fx.db)
    const c = await fx.catalog.parties.create({ name: 'نادر', isCustomer: true })

    const cash = await sell(fx, c.id, p.id, 4, 100)
    const ret = await returns.createSaleReturn({ salesInvoiceId: cash.invoice.id, lines: [{ sourceItemId: cash.items[0]!.id, quantity: Q(1) }] })
    const refund = (await createRepositories(fx.db).money.listBySource('sale_return', ret.id))[0]
    assert.equal(refund?.amount, 100)
    assert.equal(refund?.kind, 'payment')
    assert.equal(await money.balanceOf(c.id), 0)
    assert.equal((await money.invoiceSettlement('sales', cash.invoice.id))?.status, 'paid')
    await expectAppError(createSaleService(fx.db).cancel(cash.invoice.id), 'protected')
    await returns.cancelSaleReturn(ret.id, 'اشتباه')
    assert.equal((await money.get(refund!.id))?.status, 'cancelled')
    assert.equal(await money.balanceOf(c.id), 0)

    const credit = await sell(fx, c.id, p.id, 4, 100, 100) // ۳۰۰ بدهی
    await returns.createSaleReturn({ salesInvoiceId: credit.invoice.id, lines: [{ sourceItemId: credit.items[0]!.id, quantity: Q(2) }] })
    assert.equal(await money.balanceOf(c.id), 100)
    assert.equal((await money.invoiceSettlement('sales', credit.invoice.id))?.remaining, 100)
    assert.equal((await createRepositories(fx.db).money.listDocuments({ kinds: ['payment'], status: 'active' })).filter((d) => d.partyId === c.id).length, 0)
  })

  it('a party can be both customer and supplier; ledger shows a running balance; role with documents cannot be removed', async () => {
    const fx = await setup()
    const p = await stocked(fx)
    const money = createMoneyService(fx.db)
    const both = await fx.catalog.parties.create({ name: 'بازرگانی نور', isCustomer: true, isSupplier: true })
    await createPurchaseService(fx.db).create({ supplierId: both.id, warehouseId: fx.warehouseId, paidAmount: 0, invoiceDate: '2026-10-01T08:00:00.000Z', items: [{ productId: p.id, quantity: Q(1), unitPrice: 3000 }] })
    await sell(fx, both.id, p.id, 1, 1000, 0, '2026-10-02T08:00:00.000Z')
    await money.create({ kind: 'payment', partyId: both.id, amount: 500, docDate: '2026-10-03T08:00:00.000Z' })
    assert.equal(await money.balanceOf(both.id), -1500)
    const ledger = await money.ledger(both.id)
    assert.deepEqual(ledger.map((e) => [e.type, e.delta, e.balance]), [['purchase', -3000, -3000], ['sale', 1000, -2000], ['payment', 500, -1500]])
    await expectAppError(fx.catalog.parties.update(both.id, { name: 'بازرگانی نور', isCustomer: false, isSupplier: true }), 'in_use')
    await expectAppError(fx.catalog.parties.update(both.id, { name: 'x', isCustomer: false, isSupplier: false }), 'validation')
    await expectAppError(fx.catalog.parties.remove(both.id), 'in_use')
    // سیستمی‌ها نقش و فعال بودنشان را از دست نمی‌دهند
    await expectAppError(fx.catalog.parties.update(fx.customerId, { name: 'مشتری نقدی', isCustomer: true, isSupplier: true }), 'protected')
    await expectAppError(fx.catalog.parties.setActive(MISC_SUPPLIER_ID, false), 'protected')
    // فاکتور فروش برای طرفی که مشتری نیست ثبت نمی‌شود
    const onlySupplier = await fx.catalog.parties.create({ name: 'فقط تأمین', isSupplier: true })
    await expectAppError(sell(fx, onlySupplier.id, p.id, 1, 10), 'validation')
  })
})

describe('stage 1 follow-ups: auto allocation and settle balance', () => {
  it('unallocated receipt is applied oldest-invoice-first on save; manual allocation is respected', async () => {
    const fx = await setup()
    const p = await stocked(fx)
    const money = createMoneyService(fx.db)
    const c = await fx.catalog.parties.create({ name: 'کریم', isCustomer: true })
    const a = await sell(fx, c.id, p.id, 1, 1000, 0, '2026-10-01T08:00:00.000Z')
    const b = await sell(fx, c.id, p.id, 1, 1000, 0, '2026-10-02T08:00:00.000Z')
    const doc = await money.create({ kind: 'receipt', partyId: c.id, amount: 1500 })
    const s = await money.settlementsOf(doc.id)
    assert.deepEqual(s.map((x) => [x.salesInvoiceId, x.amount]), [[a.invoice.id, 1000], [b.invoice.id, 500]])
    // تخصیص دستی به فاکتور جدیدتر دست نمی‌خورد
    const c2 = await fx.catalog.parties.create({ name: 'کاوه', isCustomer: true })
    const x = await sell(fx, c2.id, p.id, 1, 1000, 0, '2026-10-01T08:00:00.000Z')
    const y = await sell(fx, c2.id, p.id, 1, 1000, 0, '2026-10-02T08:00:00.000Z')
    const d2 = await money.create({ kind: 'receipt', partyId: c2.id, amount: 1500, allocations: [{ invoiceId: y.invoice.id, amount: 1000 }] })
    assert.deepEqual((await money.settlementsOf(d2.id)).map((z) => z.salesInvoiceId), [y.invoice.id])
    assert.equal((await money.invoiceSettlement('sales', x.invoice.id))?.status, 'unpaid')
    // بیش از فاکتورهای باز ← بقیه علی‌الحساب
    const d3 = await money.create({ kind: 'receipt', partyId: c.id, amount: 900 })
    assert.equal((await money.settlementsOf(d3.id)).reduce((t, z) => t + z.amount, 0), 500)
    assert.equal(await money.balanceOf(c.id), -400)
  })

  it('settleBalance pays back a credit balance once (idempotent) and refuses when nothing to settle', async () => {
    const fx = await setup()
    const money = createMoneyService(fx.db)
    const c = await fx.catalog.parties.create({ name: 'نادر', isCustomer: true })
    await expectAppError(money.settleBalance(c.id), 'validation', 'مانده‌ای')
    await money.create({ kind: 'receipt', partyId: c.id, amount: 700 })
    assert.deepEqual(await money.settlePlan(c.id), { kind: 'payment', amount: 700 })
    const d1 = await money.settleBalance(c.id, { requestId: 'r-1' })
    const d2 = await money.settleBalance(c.id, { requestId: 'r-1' })
    assert.equal(d1.id, d2.id)
    assert.equal(d1.kind, 'payment')
    assert.equal(await money.balanceOf(c.id), 0)
    assert.equal(await money.settlePlan(c.id), null)
    // اضافه پرداخت ما به تأمین‌کننده (بدهکار بدون فاکتور فروش باز) ← دریافت
    const s = await fx.catalog.parties.create({ name: 'پخش', isSupplier: true })
    await money.create({ kind: 'payment', partyId: s.id, amount: 300 })
    const d3 = await money.settleBalance(s.id)
    assert.equal(d3.kind, 'receipt')
    assert.equal(await money.balanceOf(s.id), 0)
  })
})
