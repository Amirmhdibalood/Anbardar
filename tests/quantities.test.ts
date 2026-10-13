import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MIGRATIONS } from '../src/database/migrations'
import { runMigrations } from '../src/database/migrations/runner'
import { seedIfNeeded, SETTING_KEYS } from '../src/database/seed'
import { MemorySnapshotStore } from '../src/database/snapshot'
import { createRepositories } from '../src/repositories'
import { DEFAULT_UNIT_ID, SYSTEM_UNITS } from '../src/models/units'
import { ValidationError } from '../src/utils/errors'
import { newId } from '../src/utils/id'
import { formatQuantity, isWholeQuantity, lineGross, parseQuantityInput, quantityToInputText } from '../src/utils/quantity'
import { validateInvoice } from '../src/validation/entities'
import { expectAppError, freshDb, Q, rowCount, setup, LOT0 } from './helpers'

const NOW = '2026-10-04T10:00:00.000Z'
const unitId = (name: string) => SYSTEM_UNITS.find((u) => u.name === name)!.id

describe('quantity helpers (integer thousandths)', () => {
  it('formats with Persian digits, grouping and no needless zeros', () => {
    assert.equal(formatQuantity(1500), '۱٫۵')
    assert.equal(formatQuantity(3000), '۳')
    assert.equal(formatQuantity(1_234_500), '۱,۲۳۴٫۵')
    assert.equal(formatQuantity(250), '۰٫۲۵')
    assert.equal(formatQuantity(1), '۰٫۰۰۱')
    assert.equal(formatQuantity(-2500), '-۲٫۵')
    assert.equal(formatQuantity(0), '۰')
    assert.equal(quantityToInputText(1_234_500), '۱۲۳۴٫۵')
  })

  it('parses user input (Persian digits, decimal separators) exactly, without floats', () => {
    const ok = (t: string, fraction = true) => {
      const r = parseQuantityInput(t, fraction)
      return r.ok ? r.value : r.reason
    }
    assert.equal(ok('۱٫۵'), 1500)
    assert.equal(ok('1.5'), 1500)
    assert.equal(ok('1/5'), 1500)
    assert.equal(ok('۰٫۱۲۳'), 123)
    assert.equal(ok('0.1'), 100) // در float برابر ۰٫۱۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۱ می‌شد
    assert.equal(ok('1,250.5'), 1_250_500)
    assert.equal(ok(''), 0)
    assert.equal(ok('3', false), 3000)
    assert.equal(ok('3.0', false), 3000)
    assert.equal(ok('3.5', false), 'fraction_not_allowed')
    assert.equal(ok('1.2345'), 'too_many_decimals')
    assert.equal(ok('abc'), 'invalid')
    assert.equal(ok('1.2.3'), 'invalid')
    assert.equal(ok('-1'), 'negative')
    assert.equal(ok('2000000'), 'too_large')
    assert.equal(ok('1000000'), 1_000_000_000)
    assert.equal(isWholeQuantity(2000), true)
    assert.equal(isWholeQuantity(2001), false)
  })

  it('computes line amounts with exact integer rounding (half up), even beyond 2^53', () => {
    assert.equal(lineGross(Q(2), 500), 1000)
    assert.equal(lineGross(Q(0.25), 1000), 250)
    assert.equal(lineGross(333, 1001), 333) // ۳۳۳٫۳۳۳ ← ۳۳۳
    assert.equal(lineGross(500, 1001), 501) // ۵۰۰٫۵ ← ۵۰۱
    assert.equal(lineGross(1, 499), 0)
    assert.equal(lineGross(1, 500), 1)
    assert.equal(lineGross(1_000_000_000, 1_000_000_000), 1_000_000_000_000_000)
    assert.equal(lineGross(1_000_000_000, 1_000_000_000_000), null, 'over the amount limit')
    // ۰٫۱ ده بار با هم = دقیقاً ۱
    let sum = 0
    for (let i = 0; i < 10; i++) sum += 100
    assert.equal(sum, 1000)
  })
})

describe('units', () => {
  it('system units in the database match models/units.ts', async () => {
    const f = await setup()
    const rows = await f.repos.units.list()
    assert.deepEqual(
      rows.filter((u) => u.isSystem).map((u) => [u.id, u.name, u.allowsFraction]),
      SYSTEM_UNITS.map((u) => [u.id, u.name, u.allowsFraction]),
    )
    assert.equal(DEFAULT_UNIT_ID, unitId('عدد'))
    for (const name of ['عدد', 'کیلو', 'گرم', 'لیتر', 'متر', 'بسته', 'کارتن', 'جفت']) assert.ok(rows.some((u) => u.name === name), name)
  })

  it('creates custom units, rejects duplicates and protects system units', async () => {
    const f = await setup()
    const u = await f.catalog.units.create({ name: '  تخته ', allowsFraction: false })
    assert.equal(u.name, 'تخته')
    assert.equal(u.isSystem, false)
    const dup = await f.catalog.units.create({ name: 'تخته', allowsFraction: true }).catch((e: unknown) => e)
    assert.ok(dup instanceof ValidationError && dup.code === 'duplicate' && dup.fieldErrors['name'])
    await assert.rejects(f.catalog.units.create({ name: 'کیلو', allowsFraction: true }))
    await assert.rejects(f.catalog.units.create({ name: '  ', allowsFraction: false }), ValidationError)
    await expectAppError(f.repos.units.setActive(unitId('کیلو'), false), 'protected')
    await expectAppError(f.repos.units.remove(unitId('کیلو')), 'protected')
    await expectAppError(f.db.run("UPDATE units SET allows_fraction = 0 WHERE name = 'کیلو'"), 'protected')
    // استفاده‌شده: حذف نمی‌شود؛ استفاده‌نشده: حذف می‌شود
    await f.catalog.products.create({ name: 'الف', groupId: f.groupId, unitId: u.id })
    await expectAppError(f.catalog.units.remove(u.id), 'in_use')
    await expectAppError(f.db.run('UPDATE units SET allows_fraction = 1 WHERE id = ?', [u.id]), 'protected', 'تغییر نیست')
    const u2 = await f.catalog.units.create({ name: 'رول', allowsFraction: true })
    await f.catalog.units.remove(u2.id)
    assert.equal(await f.catalog.units.getById(u2.id), null)
  })
})

describe('fractional quantities', () => {
  it('stores 1.5 kg exactly, tracks several fractional movements without drift and keeps the cache consistent', async () => {
    const f = await setup()
    const rice = await f.catalog.products.create({ name: 'برنج', groupId: f.groupId, unitId: unitId('کیلو'), reorderPoint: Q(2.5) })
    assert.equal(rice.unitName, 'کیلو')
    assert.equal(rice.unitAllowsFraction, true)
    assert.equal(rice.reorderPoint, 2500)
    const move = (d: number, t: 'purchase' | 'sale') =>
      f.inventory.applyMovement({ productId: rice.id, warehouseId: f.warehouseId, quantityDelta: d, movementType: t }, t === 'purchase' ? LOT0 : undefined)
    await move(Q(1.5), 'purchase')
    for (let i = 0; i < 10; i++) await move(Q(0.1), 'purchase') // ده بار ۰٫۱ = دقیقاً ۱
    await move(-Q(0.333), 'sale')
    assert.equal(await f.inventory.getQuantity(f.warehouseId, rice.id), 1500 + 1000 - 333)
    assert.deepEqual(await f.inventory.verifyConsistency(), [])
    await expectAppError(move(-Q(5), 'sale'), 'insufficient_stock', 'موجودی فعلی: ۲٫۱۶۷ کیلو')
  })

  it('whole-number units reject fractions in the service AND in the database', async () => {
    const f = await setup()
    const pen = await f.catalog.products.create({ name: 'خودکار', groupId: f.groupId }) // پیش‌فرض: عدد
    assert.equal(pen.unitName, 'عدد')
    await expectAppError(
      f.inventory.applyMovement({ productId: pen.id, warehouseId: f.warehouseId, quantityDelta: Q(1.5), movementType: 'purchase' }, LOT0),
      'validation',
      'عدد صحیح باشد',
    )
    // سد دفاعی دیتابیس (دور زدن سرویس)
    await expectAppError(
      f.repos.stock.insertMovement({ productId: pen.id, warehouseId: f.warehouseId, quantityDelta: 1500, movementType: 'purchase', occurredAt: NOW }),
      'validation',
      'تعداد صحیح',
    )
    await expectAppError(
      f.repos.salesInvoices.create({ partyId: f.customerId, warehouseId: f.warehouseId, items: [{ productId: pen.id, quantity: 1500, unitPrice: 1000 }] }),
      'validation',
      'تعداد صحیح',
    )
    assert.equal(await rowCount(f.db, 'sales_invoices'), 0, 'failed invoice leaves nothing behind')
    await expectAppError(
      f.catalog.products.create({ name: 'دفتر', groupId: f.groupId, reorderPoint: Q(2.5) }),
      'validation',
      'اعشار ندارد',
    )
    // ولی برای واحد اعشاری، فاکتور کسری درست ثبت می‌شود
    const kg = await f.catalog.products.create({ name: 'گوشت', groupId: f.groupId, unitId: unitId('کیلو') })
    const { invoice, items } = await f.repos.salesInvoices.create({
      partyId: f.customerId, warehouseId: f.warehouseId, items: [{ productId: kg.id, quantity: Q(0.25), unitPrice: 1_000_001 }],
    })
    assert.equal(items[0]?.quantity, 250)
    assert.equal(items[0]?.lineTotal, 250_000) // ۲۵۰۰۰۰٫۲۵ ← ۲۵۰۰۰۰
    assert.equal(invoice.totalAmount, 250_000)
  })

  it('product unit can change only until the first transaction', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'پارچه', groupId: f.groupId })
    const upd = await f.catalog.products.update(p.id, { name: 'پارچه', groupId: f.groupId, unitId: unitId('متر') })
    assert.equal(upd.unitName, 'متر')
    await f.inventory.applyMovement({ productId: p.id, warehouseId: f.warehouseId, quantityDelta: Q(2.5), movementType: 'purchase' }, LOT0)
    const e = await f.catalog.products.update(p.id, { name: 'پارچه', groupId: f.groupId, unitId: unitId('عدد') }).catch((x: unknown) => x)
    assert.ok(e instanceof ValidationError && e.fieldErrors['unitId']?.includes('قابل تغییر نیست'))
    await expectAppError(f.db.run('UPDATE products SET unit_id = ? WHERE id = ?', [unitId('عدد'), p.id]), 'protected', 'قابل تغییر نیست')
    // تغییر سایر فیلدها آزاد است
    assert.equal((await f.catalog.products.update(p.id, { name: 'پارچه نخی', groupId: f.groupId, unitId: unitId('متر') })).name, 'پارچه نخی')
    assert.equal(await f.catalog.products.isUsed(p.id), true)
    await expectAppError(f.catalog.products.remove(p.id), 'in_use', 'غیرفعال')
  })
})

describe('invoice discount and arithmetic', () => {
  it('stores subtotal, discount and total; header CHECK enforces total = subtotal - discount', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'کالا', groupId: f.groupId })
    const noDiscount = await f.repos.salesInvoices.create({ partyId: f.customerId, warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(3), unitPrice: 100 }] })
    assert.deepEqual([noDiscount.invoice.subtotalAmount, noDiscount.invoice.discount, noDiscount.invoice.totalAmount], [300, 0, 300])
    const { invoice } = await f.repos.purchaseInvoices.create({
      partyId: (await f.catalog.suppliers.create({ name: 'تأمین' })).id, warehouseId: f.warehouseId, discount: 40,
      items: [{ productId: p.id, quantity: Q(3), unitPrice: 100, discount: 50 }, { productId: p.id, quantity: Q(1), unitPrice: 90 }],
    })
    assert.deepEqual([invoice.subtotalAmount, invoice.discount, invoice.totalAmount], [340, 40, 300])
    assert.deepEqual(await f.repos.purchaseInvoices.findTotalMismatches(), [])
    assert.deepEqual(await f.repos.salesInvoices.findTotalMismatches(), [])

    const raw = (sub: number, disc: number, total: number) =>
      f.db.run(
        'INSERT INTO sales_invoices (id, invoice_number, invoice_date, warehouse_id, subtotal_amount, discount, total_amount, customer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [newId(), 900 + Math.floor(Math.random() * 1e6), NOW, f.warehouseId, sub, disc, total, f.customerId],
      )
    await expectAppError(raw(100, 10, 100), 'constraint') // جمع کل نادرست
    await expectAppError(raw(100, 200, -100), 'constraint') // تخفیف بیشتر از جمع
    await expectAppError(raw(100, -5, 105), 'constraint')
    await raw(100, 10, 90) // درست
    // تخفیف سند ثبت‌شده تغییرناپذیر است
    await expectAppError(f.db.run('UPDATE purchase_invoices SET discount = 0, total_amount = 340 WHERE id = ?', [invoice.id]), 'immutable')
  })

  it('detects a header that does not match its lines', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'کالا', groupId: f.groupId })
    const id = newId()
    await f.db.run(
      'INSERT INTO sales_invoices (id, invoice_number, invoice_date, warehouse_id, subtotal_amount, discount, total_amount, customer_id) VALUES (?, 77, ?, ?, 999, 0, 999, ?)',
      [id, NOW, f.warehouseId, f.customerId],
    )
    await f.db.run('INSERT INTO sales_items (id, invoice_id, product_id, quantity, unit_quantity, unit_price, gross_amount, discount, line_total) VALUES (?, ?, ?, 1000, 1000, 5, 5, 0, 5)', [newId(), id, p.id])
    assert.deepEqual(await f.repos.salesInvoices.findTotalMismatches(), [id])
  })

  it('validation: invoice discount limits and rounding rules in the item CHECK', async () => {
    const f = await setup()
    const item = { productId: 'p', quantity: Q(1), unitPrice: 100 }
    const msg = (discount: number) => {
      try {
        validateInvoice({ partyId: 'c', warehouseId: 'w', discount, items: [item] }, 'مشتری')
        return null
      } catch (e) {
        return (e as ValidationError).fieldErrors['discount'] ?? 'other'
      }
    }
    assert.equal(msg(0), null)
    assert.equal(msg(100), null)
    assert.ok(msg(101)?.includes('بیشتر'))
    assert.ok(msg(-1)?.includes('منفی'))
    assert.ok(msg(1.5)?.includes('عدد صحیح'))
    // ردیف با تعداد کسری: مبلغ باید با فرمول دیتابیس بخواند
    const p = await f.catalog.products.create({ name: 'کیلویی', groupId: f.groupId, unitId: unitId('کیلو') })
    await expectAppError(
      f.db.run('INSERT INTO sales_items (id, invoice_id, product_id, quantity, unit_price, discount, line_total) VALUES (?, ?, ?, 500, 1001, 0, 500)', [newId(), newId(), p.id]),
      'constraint',
    )
  })
})

describe('migration 001 -> 002 on a database with data', () => {
  it('converts quantities, units, invoices and keeps every relation intact', async () => {
    const db = await freshDb()
    const snapshots = new MemorySnapshotStore()
    await runMigrations(db, [MIGRATIONS[0]!], snapshots) // دیتابیس نسخه ۱
    await seedIfNeeded(db)
    const repos = createRepositories(db)
    const wh = (await repos.settings.getValue(SETTING_KEYS.defaultWarehouseId)) as string
    const cust = (await repos.settings.getValue(SETTING_KEYS.defaultCustomerId)) as string
    const grp = (await repos.settings.getValue(SETTING_KEYS.defaultProductGroupId)) as string
    const supplier = newId()
    const [pA, pB, pC] = [newId(), newId(), newId()]
    const cols = 'created_at, updated_at, is_active'
    await db.run(`INSERT INTO suppliers (id, name, ${cols}) VALUES (?, 'تأمین', ?, ?, 1)`, [supplier, NOW, NOW])
    const insertProduct = (id: string, code: string, unit: string, reorder: number) =>
      db.run(
        `INSERT INTO products (id, code, name, group_id, unit, reorder_point, sale_price, ${cols}) VALUES (?, ?, ?, ?, ?, ?, 1000, ?, ?, 1)`,
        [id, code, `کالا ${code}`, grp, unit, reorder, NOW, NOW],
      )
    await insertProduct(pA, 'A', 'عدد', 5)
    await insertProduct(pB, 'B', 'کیلو', 2)
    await insertProduct(pC, 'C', 'تخته', 0) // واحد متنی سفارشی قدیمی
    await db.run(`INSERT INTO stock_movements (id, product_id, warehouse_id, quantity_delta, movement_type, occurred_at, ${cols}) VALUES (?, ?, ?, 12, 'opening', ?, ?, ?, 1)`, [newId(), pA, wh, NOW, NOW, NOW])
    await db.run(`INSERT INTO warehouse_stock (id, warehouse_id, product_id, quantity, ${cols}) VALUES (?, ?, ?, 12, ?, ?, 1)`, [newId(), wh, pA, NOW, NOW])
    const purchase = newId()
    await db.run(`INSERT INTO purchase_invoices (id, invoice_number, invoice_date, warehouse_id, total_amount, supplier_id, ${cols}) VALUES (?, 1, ?, ?, 600, ?, ?, ?, 1)`, [purchase, NOW, wh, supplier, NOW, NOW])
    await db.run(`INSERT INTO purchase_items (id, invoice_id, product_id, quantity, unit_price, discount, line_total, ${cols}) VALUES (?, ?, ?, 3, 250, 150, 600, ?, ?, 1)`, [newId(), purchase, pA, NOW, NOW])
    const sale = newId()
    await db.run(`INSERT INTO sales_invoices (id, invoice_number, invoice_date, warehouse_id, total_amount, customer_id, ${cols}) VALUES (?, 1, ?, ?, 2000, ?, ?, ?, 1)`, [sale, NOW, wh, cust, NOW, NOW])
    await db.run(`INSERT INTO sales_items (id, invoice_id, product_id, quantity, unit_price, discount, line_total, ${cols}) VALUES (?, ?, ?, 2, 1000, 0, 2000, ?, ?, 1)`, [newId(), sale, pA, NOW, NOW])
    await db.run("UPDATE sales_invoices SET status = 'cancelled', cancelled_at = ? WHERE id = ?", [NOW, sale])
    await db.run(`INSERT INTO payments (id, sales_invoice_id, amount, paid_at, ${cols}) VALUES (?, ?, 500, ?, ?, ?, 1)`, [newId(), sale, NOW, NOW, NOW])

    const report = await runMigrations(db, MIGRATIONS, snapshots)
    assert.deepEqual(report.applied, [2, 3, 4, 5, 6, 7])
    assert.ok(report.snapshot, 'a safety snapshot was taken first')
    assert.equal(await db.isForeignKeysEnabled(), true)
    assert.deepEqual(await db.all('PRAGMA foreign_key_check'), [])
    assert.equal((await db.get<{ integrity_check: string }>('PRAGMA integrity_check'))?.['integrity_check'], 'ok')

    const r = createRepositories(db)
    const a = await r.products.getById(pA)
    const b = await r.products.getById(pB)
    const c = await r.products.getById(pC)
    assert.deepEqual([a?.unitName, a?.unitAllowsFraction, a?.reorderPoint], ['عدد', false, 5000])
    assert.deepEqual([b?.unitName, b?.unitAllowsFraction, b?.reorderPoint], ['کیلو', true, 2000])
    assert.deepEqual([c?.unitName, c?.unitAllowsFraction], ['تخته', false])
    assert.equal((await r.units.getByName('تخته'))?.isSystem, false, 'legacy custom unit became a custom unit')
    assert.equal(a?.unitId, DEFAULT_UNIT_ID)
    assert.equal(await r.stock.getQuantity(wh, pA), 12_000)
    assert.deepEqual(await r.stock.findInconsistencies(), [])
    const pi = await r.purchaseInvoices.getById(purchase)
    assert.deepEqual([pi?.subtotalAmount, pi?.discount, pi?.totalAmount], [600, 0, 600])
    const pItems = await r.purchaseInvoices.getItems(purchase)
    assert.deepEqual([pItems[0]?.quantity, pItems[0]?.lineTotal], [3000, 600])
    const si = await r.salesInvoices.getById(sale)
    assert.equal(si?.status, 'cancelled')
    assert.equal((await r.salesInvoices.getItems(sale))[0]?.quantity, 2000)
    assert.equal(await r.payments.totalForSalesInvoice(sale), 500, 'payments still point at the invoice')
    assert.deepEqual(await r.salesInvoices.findTotalMismatches(), [])
    assert.deepEqual(await r.purchaseInvoices.findTotalMismatches(), [])
    assert.equal(Number((await db.get('SELECT MAX(version) AS v FROM schema_migrations'))?.['v']), MIGRATIONS.length)
    // نسخه ۳: موجودی قدیمی یک لایهٔ بها دارد و بها/میانگین با دفتر سازگار است
    const lots = await r.costs.listLots({ productId: pA })
    assert.deepEqual(lots.map((l) => [l.quantity, l.remaining, l.totalCost]), [[12_000, 12_000, 0]])
    assert.deepEqual(await r.costs.findInconsistencies(), [])

    // Triggerها و ایندکس‌ها بعد از بازسازی سالم‌اند
    const triggers = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger'")).map((t) => t.name)
    for (const t of ['trg_stock_no_negative_insert', 'trg_movements_no_update', 'trg_sales_invoices_immutable', 'trg_purchase_items_no_delete', 'trg_sales_items_whole_units', 'trg_products_unit_locked', 'trg_parties_system_update', 'trg_sales_items_only_active']) {
      assert.ok(triggers.includes(t), t)
    }
    await expectAppError(db.run('UPDATE sales_invoices SET total_amount = 5 WHERE id = ?', [sale]), 'immutable')
    await expectAppError(db.run("UPDATE stock_movements SET note = 'x'"), 'immutable')
    await expectAppError(db.run('DELETE FROM sales_items'), 'immutable')
    await expectAppError(createRepositories(db).products.create({ code: 'A', name: 'تکراری', groupId: grp }), 'duplicate', 'کد')
    const indexes = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'")).map((i) => i.name)
    for (const i of ['ux_products_code', 'ux_sales_number', 'ux_purchase_number', 'ux_stock_wh_product', 'ix_movements_product_wh', 'ux_units_name']) assert.ok(indexes.includes(i), i)
    // دوباره اجرا: بدون تغییر
    assert.deepEqual((await runMigrations(db, MIGRATIONS, snapshots)).applied, [])
  })
})
