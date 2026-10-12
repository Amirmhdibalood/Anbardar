import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SqlJsDatabase } from '../src/database/drivers/sqlJsDatabase'
import { MIGRATIONS } from '../src/database/migrations'
import { runMigrations } from '../src/database/migrations/runner'
import type { Migration } from '../src/database/migrations/types'
import { SEED_NAMES, SETTING_KEYS, seedIfNeeded } from '../src/database/seed'
import { MemorySnapshotStore, type DatabaseDump } from '../src/database/snapshot'
import { createRepositories } from '../src/repositories'
import { importLegacySettings, LEGACY_SETTINGS_KEY } from '../src/services/legacySettingsMigration'
import { ValidationError } from '../src/utils/errors'
import { formatMoney } from '../src/utils/money'
import { newId } from '../src/utils/id'
import { DEFAULT_UNIT_ID } from '../src/models/units'
import { Q, LOT0 } from './helpers'
import { expectAppError, freshDb, loadSql, rowCount, setup } from './helpers'

const NOW = '2026-10-04T10:00:00.000Z'

describe('migration', () => {
  it('migrates an empty v0 database to the latest version without a snapshot', async () => {
    const db = await freshDb()
    const store = new MemorySnapshotStore()
    const report = await runMigrations(db, MIGRATIONS, store)
    assert.deepEqual([report.fromVersion, report.toVersion, report.applied, report.snapshot], [0, MIGRATIONS.length, MIGRATIONS.map((m) => m.version), null])
    assert.equal(store.files.size, 0, 'nothing to snapshot for an empty database')
    assert.equal(await db.isForeignKeysEnabled(), true)
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).map((t) => t.name)
    for (const t of [
      'products', 'product_groups', 'units', 'warehouses', 'warehouse_stock', 'stock_movements', 'customers', 'suppliers',
      'purchase_invoices', 'purchase_items', 'sales_invoices', 'sales_items', 'payments', 'settings', 'sequences', 'schema_migrations',
    ]) assert.ok(tables.includes(t), `table ${t}`)
  })

  it('is idempotent', async () => {
    const db = await freshDb()
    const store = new MemorySnapshotStore()
    await runMigrations(db, MIGRATIONS, store)
    const again = await runMigrations(db, MIGRATIONS, store)
    assert.deepEqual(again.applied, [])
    assert.equal(await rowCount(db, 'schema_migrations'), MIGRATIONS.length)
  })

  const vNext: Migration = { version: MIGRATIONS.length + 1, name: 'add test column', statements: ['ALTER TABLE products ADD COLUMN test_col TEXT'] }

  it('takes a pre-migration snapshot of existing data, then upgrades to the next version keeping data', async () => {
    const f = await setup()
    const product = await f.catalog.products.create({ name: 'کالای آزمایشی', groupId: f.groupId })
    const report = await runMigrations(f.db, [...MIGRATIONS, vNext], f.snapshots)
    assert.deepEqual(report.applied, [MIGRATIONS.length + 1])
    assert.ok(report.snapshot, 'snapshot name returned')
    const dump = JSON.parse((await f.snapshots.read(report.snapshot as string)) as string) as DatabaseDump
    assert.equal(dump.schemaVersion, MIGRATIONS.length)
    assert.equal(dump.tables['products']?.length, 1)
    assert.equal(dump.tables['products']?.[0]?.['name'], 'کالای آزمایشی')
    assert.ok(dump.tables['warehouses']?.length, 'snapshot contains seeded data too')
    const row = await f.db.get('SELECT name, test_col FROM products WHERE id = ?', [product.id])
    assert.equal(row?.['name'], 'کالای آزمایشی')
    assert.equal(row?.['test_col'], null)
  })

  it('rolls a failing migration back completely and leaves data intact', async () => {
    const f = await setup()
    await f.catalog.products.create({ name: 'کالا', groupId: f.groupId })
    const bad: Migration = {
      version: MIGRATIONS.length + 1,
      name: 'broken',
      statements: ['ALTER TABLE products ADD COLUMN half_done TEXT', "UPDATE products SET name = 'DAMAGED'", 'THIS IS NOT SQL'],
    }
    const e = await expectAppError(runMigrations(f.db, [...MIGRATIONS, bad], f.snapshots), 'migration')
    assert.ok(e.userMessage.includes('تغییری روی اطلاعات شما اعمال نشد'))
    const cols = (await f.db.all<{ name: string }>('PRAGMA table_info(products)')).map((c) => c.name)
    assert.ok(!cols.includes('half_done'), 'DDL rolled back')
    assert.equal((await f.db.get('SELECT name FROM products'))?.['name'], 'کالا', 'DML rolled back')
    assert.equal(Number((await f.db.get('SELECT MAX(version) AS v FROM schema_migrations'))?.['v']), MIGRATIONS.length)
    assert.equal(f.snapshots.files.size, 1, 'snapshot was taken before the attempt')
    assert.equal(await f.db.isForeignKeysEnabled(), true, 'foreign keys re-enabled after failure')
  })

  it('does not start migrating if the safety snapshot cannot be saved', async () => {
    const f = await setup()
    const broken = new MemorySnapshotStore()
    broken.save = async () => {
      throw new Error('disk full')
    }
    await expectAppError(runMigrations(f.db, [...MIGRATIONS, vNext], broken), 'migration', 'نسخه ایمنی')
    const cols = (await f.db.all<{ name: string }>('PRAGMA table_info(products)')).map((c) => c.name)
    assert.ok(!cols.includes('test_col'))
  })

  it('refuses to touch a database created by a newer app version', async () => {
    const f = await setup()
    await f.db.run("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (9, 'future', 'x', ?)", [NOW])
    await expectAppError(runMigrations(f.db, MIGRATIONS, f.snapshots), 'database_newer')
  })

  it('detects an edited historical migration (checksum)', async () => {
    const f = await setup()
    const tampered: Migration = { ...MIGRATIONS[0]!, statements: [...MIGRATIONS[0]!.statements, 'SELECT 1'] }
    await expectAppError(runMigrations(f.db, [tampered, ...MIGRATIONS.slice(1)], f.snapshots), 'migration')
  })

  it('persists across export/reopen with foreign keys on', async () => {
    const f = await setup()
    await f.catalog.warehouses.create({ name: 'انبار دوم' })
    const bytes = await (f.db as SqlJsDatabase).exportBytes()
    const reopened = await SqlJsDatabase.open(await loadSql(), null, bytes)
    assert.equal(await rowCount(reopened, 'warehouses'), 2)
    assert.equal(await reopened.isForeignKeysEnabled(), true)
    const report = await runMigrations(reopened, MIGRATIONS, new MemorySnapshotStore())
    assert.deepEqual(report.applied, [])
  })
})

describe('schema conventions', () => {
  it('every business table has the standard columns, and no currency column exists', async () => {
    const f = await setup()
    const business = [
      'products', 'product_groups', 'warehouses', 'warehouse_stock', 'stock_movements', 'customers', 'suppliers',
      'purchase_invoices', 'purchase_items', 'sales_invoices', 'sales_items', 'payments', 'cost_lots', 'lot_allocations',
    ]
    for (const t of business) {
      const cols = (await f.db.all<{ name: string; type: string; notnull: number }>(`PRAGMA table_info(${t})`)).map((c) => c.name)
      for (const c of ['id', 'created_at', 'updated_at', 'is_active', 'created_by']) assert.ok(cols.includes(c), `${t}.${c}`)
      assert.ok(!cols.includes('currency'), `${t} must not have a currency column (toman only)`)
    }
    const idInfo = await f.db.all<{ name: string; type: string }>('PRAGMA table_info(products)')
    assert.equal(idInfo.find((c) => c.name === 'id')?.type, 'TEXT')
    assert.ok(!idInfo.some((c) => c.name === 'purchase_price'), 'purchase price lives only on purchase lines')
    assert.equal(idInfo.find((c) => c.name === 'sub_unit')?.type, 'TEXT')
    assert.equal(idInfo.find((c) => c.name === 'unit_id')?.type, 'TEXT')
    assert.ok(!idInfo.some((c) => c.name === 'unit'), 'free-text unit column was replaced by unit_id')
    // هیچ ستون REAL/FLOAT در کل Schema نیست (تعداد و مبلغ همه عدد صحیح‌اند)
    const real = await f.db.all("SELECT m.name AS t, c.name AS c FROM sqlite_master m, pragma_table_info(m.name) c WHERE m.type = 'table' AND (c.type LIKE '%REAL%' OR c.type LIKE '%FLOA%' OR c.type LIKE '%DOUB%' OR c.type LIKE '%NUM%')")
    assert.deepEqual(real, [])
  })

  it('uses UUID v7 ids', () => {
    const id = newId()
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    assert.notEqual(newId(), newId())
  })

  it('rejects non-integer money at the database level', async () => {
    const f = await setup()
    await expectAppError(
      f.db.run(
        "INSERT INTO products (id, code, name, group_id, unit_id, sale_price) VALUES (?, 'X1', 'x', ?, ?, -5)",
        [newId(), f.groupId, DEFAULT_UNIT_ID],
      ),
      'constraint',
    )
    assert.throws(() => formatMoney(10.5), RangeError)
    assert.equal(formatMoney(4520000), '۴,۵۲۰,۰۰۰ تومان')
  })
})

describe('seed', () => {
  it('creates default warehouse, cash customer, product group and settings once', async () => {
    const db = await freshDb()
    await runMigrations(db, MIGRATIONS, new MemorySnapshotStore())
    assert.equal(await seedIfNeeded(db), true)
    assert.equal(await seedIfNeeded(db), false, 'second run is a no-op')
    const repos = createRepositories(db)
    const warehouses = await repos.warehouses.list()
    assert.deepEqual(warehouses.map((w) => w.name), [SEED_NAMES.warehouse])
    const customers = await repos.customers.list()
    assert.equal(customers.length, 1)
    assert.equal(customers[0]?.name, 'مشتری نقدی')
    assert.equal(customers[0]?.isSystem, true)
    assert.deepEqual((await repos.productGroups.list()).map((g) => g.name), [SEED_NAMES.productGroup])
    assert.equal(await repos.settings.getValue(SETTING_KEYS.defaultWarehouseId), warehouses[0]?.id)
    assert.equal(await repos.settings.getValue(SETTING_KEYS.defaultCustomerId), customers[0]?.id)
    const settings = await repos.settings.load()
    assert.deepEqual(settings, { theme: 'dark', costMethod: 'fifo', salePriceMode: 'last_sale', markupBp: 0 })
  })

  it('protects the cash customer from deactivation and deletion', async () => {
    const f = await setup()
    await expectAppError(f.catalog.customers.setActive(f.customerId, false), 'protected')
    await expectAppError(f.catalog.customers.remove(f.customerId), 'protected')
    await f.catalog.customers.update(f.customerId, { name: 'مشتری نقدی', phone: '09121234567' }) // ویرایش مجاز است
  })
})

describe('settings', () => {
  it('stores theme in the database and imports the legacy localStorage value exactly once', async () => {
    const f = await setup()
    const store = new Map<string, string>([[LEGACY_SETTINGS_KEY, JSON.stringify({ theme: 'light', currency: 'rial' })]])
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    assert.equal(await importLegacySettings(f.repos), true)
    assert.equal((await f.repos.settings.load()).theme, 'light')
    assert.equal(store.has(LEGACY_SETTINGS_KEY), false, 'legacy key removed')
    store.set(LEGACY_SETTINGS_KEY, JSON.stringify({ theme: 'system' }))
    assert.equal(await importLegacySettings(f.repos), false, 'only once')
    assert.equal((await f.repos.settings.load()).theme, 'light')
    await f.repos.settings.save({ theme: 'system', costMethod: 'average', salePriceMode: 'markup', markupBp: 2500 })
    assert.deepEqual(await f.repos.settings.load(), { theme: 'system', costMethod: 'average', salePriceMode: 'markup', markupBp: 2500 })
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('falls back to safe defaults for corrupted values', async () => {
    const f = await setup()
    await f.repos.settings.setValue('theme', 'neon')
    assert.equal((await f.repos.settings.load()).theme, 'dark')
  })
})

describe('transactions', () => {
  it('rolls everything back when a step fails', async () => {
    const f = await setup()
    const before = await rowCount(f.db, 'product_groups')
    await expectAppError(
      f.db.transaction(async (tx) => {
        const r = createRepositories(tx)
        await r.productGroups.create({ name: 'گروه موقت' })
        await r.productGroups.create({ name: 'گروه موقت' }) // نام تکراری
      }),
      'duplicate',
      'گروهی با این نام',
    )
    assert.equal(await rowCount(f.db, 'product_groups'), before)
  })

  it('rolls back on non-database errors too and rethrows validation errors untouched', async () => {
    const f = await setup()
    const before = await rowCount(f.db, 'warehouses')
    await assert.rejects(
      f.db.transaction(async (tx) => {
        await createRepositories(tx).warehouses.create({ name: 'انبار موقت' })
        throw new ValidationError({ name: 'نام را وارد کنید.' })
      }),
      (e: unknown) => e instanceof ValidationError,
    )
    assert.equal(await rowCount(f.db, 'warehouses'), before)
  })

  it('supports nested savepoints: inner failure rolls back only the inner part', async () => {
    const f = await setup()
    await f.db.transaction(async (tx) => {
      const r = createRepositories(tx)
      await r.productGroups.create({ name: 'بیرونی' })
      await expectAppError(
        tx.transaction(async (inner) => {
          const ir = createRepositories(inner)
          await ir.productGroups.create({ name: 'درونی' })
          await ir.productGroups.create({ name: 'بیرونی' }) // تکراری → خطا
        }),
        'duplicate',
      )
    })
    const names = (await f.repos.productGroups.list()).map((g) => g.name)
    assert.ok(names.includes('بیرونی'))
    assert.ok(!names.includes('درونی'))
  })

  it('serialises concurrent transactions (no interleaving)', async () => {
    const f = await setup()
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        f.db.transaction(async (tx) => createRepositories(tx).sequences.next('sales_invoice').then((n) => ({ i, n }))),
      ),
    )
    assert.deepEqual(results.map((r) => r.n).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('a failed invoice registration leaves no invoice, items, movements, stock or consumed number', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'کالای الف', groupId: f.groupId, salePrice: 1000 })
    await f.inventory.applyMovement({ productId: p.id, warehouseId: f.warehouseId, quantityDelta: Q(5), movementType: 'opening' }, LOT0)

    const sell = (qty: number, productId = p.id) =>
      f.db.transaction(async (tx) => {
        const r = createRepositories(tx)
        const inv = await r.salesInvoices.create({
          partyId: f.customerId,
          warehouseId: f.warehouseId,
          items: [{ productId, quantity: qty, unitPrice: 1000 }],
        })
        await createInventoryServiceFor(tx).applyMovement({
          productId, warehouseId: f.warehouseId, quantityDelta: -qty, movementType: 'sale', documentType: 'sales_invoice', documentId: inv.invoice.id,
        })
        return inv
      })

    await expectAppError(sell(Q(9)), 'insufficient_stock', 'کالای الف')
    assert.equal(await rowCount(f.db, 'sales_invoices'), 0)
    assert.equal(await rowCount(f.db, 'sales_items'), 0)
    assert.equal(await rowCount(f.db, 'stock_movements'), 1)
    assert.equal(await f.inventory.getQuantity(f.warehouseId, p.id), Q(5))

    const ok = await sell(Q(2))
    assert.equal(ok.invoice.invoiceNumber, 1, 'the failed attempt did not consume invoice number 1')
    assert.equal(ok.invoice.totalAmount, 2000)
    assert.equal(await f.inventory.getQuantity(f.warehouseId, p.id), Q(3))

    await expectAppError(sell(Q(1), newId()), 'constraint') // کالای ناموجود
    assert.equal(await rowCount(f.db, 'sales_invoices'), 1)
    assert.deepEqual(await f.inventory.verifyConsistency(), [])
  })
})

import { createInventoryService } from '../src/services/inventoryService'
const createInventoryServiceFor = createInventoryService

describe('foreign keys and soft-delete rules', () => {
  it('refuses to delete referenced rows with a human message; allows deactivation', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'کالا', groupId: f.groupId })
    await f.inventory.applyMovement({ productId: p.id, warehouseId: f.warehouseId, quantityDelta: Q(3), movementType: 'opening' }, LOT0)
    await expectAppError(f.catalog.groups.remove(f.groupId), 'in_use', 'غیرفعال کنید')
    await expectAppError(f.catalog.warehouses.remove(f.warehouseId), 'in_use')
    await expectAppError(f.catalog.products.remove(p.id), 'in_use')
    await f.catalog.groups.setActive(f.groupId, false)
    await f.catalog.products.setActive(p.id, false)
    assert.equal((await f.catalog.products.getById(p.id))?.isActive, false)
    assert.equal((await f.catalog.products.list()).length, 0)
    assert.equal((await f.catalog.products.list({ includeInactive: true })).length, 1)
  })

  it('allows deleting unused rows', async () => {
    const f = await setup()
    const g = await f.catalog.groups.create({ name: 'بدون کالا' })
    await f.catalog.groups.remove(g.id)
    assert.equal(await f.catalog.groups.getById(g.id), null)
    const s = await f.catalog.suppliers.create({ name: 'تأمین‌کننده' })
    await f.catalog.suppliers.remove(s.id)
  })

  it('rejects inserts pointing to missing parents (FK enforced) with a Persian message', async () => {
    const f = await setup()
    await expectAppError(f.repos.products.create({ code: 'Z1', name: 'x', groupId: newId() }), 'constraint', 'وجود ندارد')
  })

  it('invoices that reference a product/customer block their deletion', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'کالا', groupId: f.groupId })
    const s = await f.catalog.suppliers.create({ name: 'تأمین' })
    await f.repos.purchaseInvoices.create({ partyId: s.id, warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(2), unitPrice: 50 }] })
    await expectAppError(f.catalog.suppliers.remove(s.id), 'in_use')
    await expectAppError(f.catalog.products.remove(p.id), 'in_use')
    await expectAppError(f.catalog.warehouses.remove(f.warehouseId), 'in_use')
  })
})

describe('unique constraints', () => {
  it('product code, group name, warehouse name', async () => {
    const f = await setup()
    await f.catalog.products.create({ name: 'الف', code: 'a-1', groupId: f.groupId })
    await expectAppError(f.catalog.products.create({ name: 'ب', code: 'A-1', groupId: f.groupId }), 'duplicate', 'کد')
    await expectAppError(f.repos.products.create({ code: 'A-1', name: 'ب', groupId: f.groupId }), 'duplicate', 'کد') // لایه دیتابیس
    await expectAppError(f.catalog.groups.create({ name: ' عمومی ' }), 'duplicate', 'گروهی با این نام')
    await expectAppError(f.catalog.warehouses.create({ name: 'انبار مرکزی' }), 'duplicate', 'انباری با این نام')
  })

  it('invoice numbers are sequential and unique per kind; one stock row per (warehouse, product)', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'کالا', groupId: f.groupId })
    const mk = () => f.repos.salesInvoices.create({ partyId: f.customerId, warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 10 }] })
    const [a, b, c] = [await mk(), await mk(), await mk()]
    assert.deepEqual([a, b, c].map((x) => x.invoice.invoiceNumber), [1, 2, 3])
    const dup = await f.db.get('SELECT * FROM sales_invoices WHERE id = ?', [a.invoice.id])
    await expectAppError(
      f.db.run(
        'INSERT INTO sales_invoices (id, invoice_number, invoice_date, warehouse_id, subtotal_amount, total_amount, customer_id) VALUES (?, 1, ?, ?, 0, 0, ?)',
        [newId(), NOW, f.warehouseId, String(dup?.['customer_id'])],
      ),
      'duplicate',
      'شماره',
    )
    await f.repos.stock.addToCache(f.warehouseId, p.id, Q(4))
    await f.repos.stock.addToCache(f.warehouseId, p.id, Q(1))
    assert.equal((await f.repos.stock.listLevels({ productId: p.id })).length, 1)
    await expectAppError(
      f.db.run('INSERT INTO warehouse_stock (id, warehouse_id, product_id, quantity) VALUES (?, ?, ?, 1)', [newId(), f.warehouseId, p.id]),
      'duplicate',
    )
    const pi = await f.repos.purchaseInvoices.create({ partyId: (await f.catalog.suppliers.create({ name: 'س' })).id, warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 1 }] })
    assert.equal(pi.invoice.invoiceNumber, 1, 'purchase sequence is independent')
  })

  it('auto product codes are unique and skip manually used codes', async () => {
    const f = await setup()
    await f.catalog.products.create({ name: 'دستی', code: '1001', groupId: f.groupId })
    const a = await f.catalog.products.create({ name: 'خودکار ۱', groupId: f.groupId })
    const b = await f.catalog.products.create({ name: 'خودکار ۲', groupId: f.groupId })
    assert.deepEqual([a.code, b.code], ['1002', '1003'])
  })
})

describe('stock ledger vs cache', () => {
  it('stays consistent across purchases, sales, cancels and several warehouses', async () => {
    const f = await setup()
    const w2 = await f.catalog.warehouses.create({ name: 'فروشگاه ۱' })
    const a = await f.catalog.products.create({ name: 'الف', groupId: f.groupId })
    const b = await f.catalog.products.create({ name: 'ب', groupId: f.groupId })
    const inv = f.inventory
    await inv.applyMovement({ productId: a.id, warehouseId: f.warehouseId, quantityDelta: Q(100), movementType: 'purchase' }, LOT0)
    const sale = await inv.applyMovement({ productId: a.id, warehouseId: f.warehouseId, quantityDelta: Q(-30), movementType: 'sale' })
    await inv.applyMovement({ productId: a.id, warehouseId: f.warehouseId, quantityDelta: Q(-20), movementType: 'transfer_out' })
    await inv.applyMovement({ productId: a.id, warehouseId: w2.id, quantityDelta: Q(20), movementType: 'transfer_in' }, LOT0)
    await inv.applyMovement({ productId: b.id, warehouseId: w2.id, quantityDelta: Q(7), movementType: 'purchase' }, LOT0)
    await inv.applyMovement({ productId: a.id, warehouseId: f.warehouseId, quantityDelta: Q(30), movementType: 'sale_cancel' }, { kind: 'reverse', originalMovementId: sale.id })

    assert.equal(await inv.getQuantity(f.warehouseId, a.id), Q(80))
    assert.equal(await inv.getQuantity(w2.id, a.id), Q(20))
    assert.equal(await inv.getQuantity(w2.id, b.id), Q(7))
    assert.deepEqual(await inv.verifyConsistency(), [])
    assert.deepEqual(await inv.verifyCosts(), [])
    const total = await f.db.get('SELECT SUM(quantity_delta) AS s FROM stock_movements WHERE product_id = ?', [a.id])
    assert.equal(Number(total?.['s']), Q(100))
  })

  it('detects a corrupted cache and rebuilds it from the ledger', async () => {
    const f = await setup()
    const a = await f.catalog.products.create({ name: 'الف', groupId: f.groupId })
    await f.inventory.applyMovement({ productId: a.id, warehouseId: f.warehouseId, quantityDelta: Q(10), movementType: 'purchase' }, LOT0)
    await f.db.run('UPDATE warehouse_stock SET quantity = 99000')
    const bad = await f.inventory.verifyConsistency()
    assert.deepEqual(bad.map((x) => [x.cached, x.ledger]), [[Q(99), Q(10)]])
    await f.inventory.rebuildCache()
    assert.deepEqual(await f.inventory.verifyConsistency(), [])
    assert.equal(await f.inventory.getQuantity(f.warehouseId, a.id), Q(10))
    // ردیف کش بدون هیچ حرکتی هم گزارش می‌شود
    await f.db.run('UPDATE warehouse_stock SET quantity = 0')
    await f.repos.stock.addToCache(f.warehouseId, (await f.catalog.products.create({ name: 'ج', groupId: f.groupId })).id, Q(3))
    assert.equal((await f.inventory.verifyConsistency()).length, 2)
  })

  it('always forbids negative stock (service message + unconditional database trigger)', async () => {
    const f = await setup()
    const a = await f.catalog.products.create({ name: 'الف', groupId: f.groupId })
    await f.inventory.applyMovement({ productId: a.id, warehouseId: f.warehouseId, quantityDelta: Q(2), movementType: 'purchase' }, LOT0)
    await expectAppError(
      f.inventory.applyMovement({ productId: a.id, warehouseId: f.warehouseId, quantityDelta: Q(-3), movementType: 'sale' }),
      'insufficient_stock',
      'موجودی «الف» در «انبار مرکزی» کافی نیست. موجودی فعلی: ۲ عدد',
    )
    assert.equal(await rowCount(f.db, 'stock_movements'), 1)
    await expectAppError(f.repos.stock.addToCache(f.warehouseId, a.id, Q(-5)), 'insufficient_stock') // سد دفاعی دیتابیس
    // تنظیم قدیمی دیگر هیچ اثری ندارد
    await f.repos.settings.setValue('allow_negative_stock', '1')
    await expectAppError(f.inventory.applyMovement({ productId: a.id, warehouseId: f.warehouseId, quantityDelta: Q(-3), movementType: 'sale' }), 'insufficient_stock')
    await expectAppError(f.repos.stock.addToCache(f.warehouseId, a.id, Q(-5)), 'insufficient_stock')
    assert.equal(await f.inventory.getQuantity(f.warehouseId, a.id), Q(2))
    assert.deepEqual(await f.inventory.verifyCosts(), [])
  })

  it('ledger rows are immutable; inactive products cannot be sold', async () => {
    const f = await setup()
    const a = await f.catalog.products.create({ name: 'الف', groupId: f.groupId })
    const m = await f.inventory.applyMovement({ productId: a.id, warehouseId: f.warehouseId, quantityDelta: Q(4), movementType: 'purchase' }, LOT0)
    await expectAppError(f.db.run('UPDATE stock_movements SET quantity_delta = 99 WHERE id = ?', [m.id]), 'immutable')
    await expectAppError(f.db.run('DELETE FROM stock_movements WHERE id = ?', [m.id]), 'immutable')
    const sold = await f.inventory.applyMovement({ productId: a.id, warehouseId: f.warehouseId, quantityDelta: Q(-1), movementType: 'sale' })
    await f.catalog.products.setActive(a.id, false)
    await expectAppError(
      f.inventory.applyMovement({ productId: a.id, warehouseId: f.warehouseId, quantityDelta: Q(-1), movementType: 'sale' }),
      'validation',
      'غیرفعال',
    )
    // ابطال روی کالای غیرفعال مجاز است
    await f.inventory.applyMovement({ productId: a.id, warehouseId: f.warehouseId, quantityDelta: Q(1), movementType: 'sale_cancel' }, { kind: 'reverse', originalMovementId: sold.id })
    assert.deepEqual(await f.inventory.verifyCosts(), [])
  })
})

describe('documents: no editing, only cancelling', () => {
  it('blocks edits/deletes of invoices and items, allows a single cancel', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'کالا', groupId: f.groupId })
    const { invoice, items } = await f.repos.salesInvoices.create({
      partyId: f.customerId, warehouseId: f.warehouseId, reference: 'R-1', note: 'یادداشت',
      items: [{ productId: p.id, quantity: Q(3), unitPrice: 100, discount: 50 }],
    })
    assert.equal(invoice.status, 'active')
    assert.equal(items[0]?.lineTotal, 250)
    assert.equal(invoice.totalAmount, 250)

    await expectAppError(f.db.run('UPDATE sales_invoices SET total_amount = 1 WHERE id = ?', [invoice.id]), 'immutable')
    await expectAppError(f.db.run('UPDATE sales_items SET quantity = 9 WHERE id = ?', [items[0]!.id]), 'immutable')
    await expectAppError(f.db.run('DELETE FROM sales_items WHERE id = ?', [items[0]!.id]), 'immutable')
    await expectAppError(f.db.run('DELETE FROM sales_invoices WHERE id = ?', [invoice.id]), 'immutable')

    await f.repos.salesInvoices.markCancelled(invoice.id, 'اشتباه ثبت شد', NOW)
    const cancelled = await f.repos.salesInvoices.getById(invoice.id)
    assert.equal(cancelled?.status, 'cancelled')
    assert.equal(cancelled?.cancelReason, 'اشتباه ثبت شد')
    await expectAppError(f.repos.salesInvoices.markCancelled(invoice.id, null, NOW), 'immutable')
    await expectAppError(
      f.db.run(
        "INSERT INTO sales_items (id, invoice_id, product_id, quantity, unit_price, discount, line_total) VALUES (?, ?, ?, 1000, 1, 0, 1)",
        [newId(), invoice.id, p.id],
      ),
      'immutable',
    )
  })

  it('checks line arithmetic and payments integrity in the database', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'کالا', groupId: f.groupId })
    const { invoice } = await f.repos.salesInvoices.create({ partyId: f.customerId, warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(2), unitPrice: 500 }] })
    await expectAppError(
      f.db.run(
        'INSERT INTO sales_items (id, invoice_id, product_id, quantity, unit_price, discount, line_total) VALUES (?, ?, ?, 2000, 500, 0, 999)',
        [newId(), invoice.id, p.id],
      ),
      'constraint',
    )
    await f.repos.payments.create({ salesInvoiceId: invoice.id, amount: 400, paidAt: NOW })
    await f.repos.payments.create({ salesInvoiceId: invoice.id, amount: 100, paidAt: NOW })
    assert.equal(await f.repos.payments.totalForSalesInvoice(invoice.id), 500)
    assert.equal((invoice.totalAmount - (await f.repos.payments.totalForSalesInvoice(invoice.id))), 500)
    await expectAppError(f.repos.payments.create({ amount: 5, paidAt: NOW }), 'constraint') // بدون فاکتور
    await expectAppError(f.repos.payments.create({ salesInvoiceId: invoice.id, amount: 0, paidAt: NOW }), 'constraint')
    await expectAppError(f.repos.payments.create({ salesInvoiceId: newId(), amount: 5, paidAt: NOW }), 'constraint')
    await expectAppError(f.db.run('DELETE FROM sales_invoices WHERE id = ?', [invoice.id]), 'immutable')
  })

  it('lists invoices with filters (date, party, warehouse)', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'کالا', groupId: f.groupId })
    const w2 = await f.catalog.warehouses.create({ name: 'انبار ۲' })
    const items = [{ productId: p.id, quantity: Q(1), unitPrice: 1 }]
    await f.repos.salesInvoices.create({ partyId: f.customerId, warehouseId: f.warehouseId, invoiceDate: '2026-01-01T00:00:00.000Z', items })
    await f.repos.salesInvoices.create({ partyId: f.customerId, warehouseId: w2.id, invoiceDate: '2026-06-01T00:00:00.000Z', items })
    assert.equal((await f.repos.salesInvoices.list()).length, 2)
    assert.equal((await f.repos.salesInvoices.list({ from: '2026-03-01T00:00:00.000Z' })).length, 1)
    assert.equal((await f.repos.salesInvoices.list({ warehouseId: w2.id }))[0]?.invoiceNumber, 2)
    assert.equal((await f.repos.salesInvoices.list({ status: 'cancelled' })).length, 0)
  })
})

describe('validation layer', () => {
  it('rejects bad product input with per-field Persian messages', async () => {
    const f = await setup()
    const err = await f.catalog.products.create({ name: '   ', groupId: '', salePrice: -1.5, reorderPoint: 2 ** 60 }).catch((e: unknown) => e)
    assert.ok(err instanceof ValidationError)
    const fields = (err as ValidationError).fieldErrors
    assert.equal(fields['name'], 'نام کالا را وارد کنید.')
    assert.equal(fields['groupId'], 'گروه کالا را انتخاب کنید.')
    assert.ok(fields['salePrice'])
    assert.ok(fields['reorderPoint'])
    assert.equal(await rowCount(f.db, 'products'), 0)
  })

  it('normalises Persian digits in codes/phones and Arabic letters in names', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: '  كتاب   ياد ', code: ' ab-۱۲۳ ', groupId: f.groupId })
    assert.equal(p.code, 'AB-123')
    assert.equal(p.name, 'کتاب یاد')
    const c = await f.catalog.customers.create({ name: 'علی', phone: '۰۹۱۲ ۱۲۳ ۴۵۶۷' })
    assert.equal(c.phone, '0912 123 4567')
    await expectAppError(f.catalog.customers.create({ name: 'x', phone: 'abc' }), 'validation', 'شماره تماس')
  })

  it('validates invoices: items, quantities, discounts, duplicates, overflow', async () => {
    const f = await setup()
    const { validateInvoice } = await import('../src/validation/entities')
    const base = { partyId: 'c', warehouseId: 'w' }
    const msg = (items: { productId: string; quantity: number; unitPrice: number; discount?: number }[]) => {
      try {
        validateInvoice({ ...base, items }, 'مشتری')
        return null
      } catch (e) {
        return (e as ValidationError).userMessage
      }
    }
    assert.ok(msg([])?.includes('حداقل یک کالا'))
    assert.ok(msg([{ productId: 'p', quantity: 0, unitPrice: 1 }])?.includes('حداقل 1'))
    assert.ok(msg([{ productId: 'p', quantity: Q(1), unitPrice: 10, discount: 11 }])?.includes('تخفیف'))
    assert.ok(msg([{ productId: 'p', quantity: Q(1), unitPrice: 1 }, { productId: 'p', quantity: Q(1), unitPrice: 1 }])?.includes('بیش از یک بار'))
    assert.ok(msg([{ productId: 'p', quantity: 1_000_000_000, unitPrice: 1_000_000_000_000 }])?.includes('بیش از حد'))
    assert.equal(msg([{ productId: 'p', quantity: Q(2), unitPrice: 5, discount: 10 }]), null)
    assert.equal(await rowCount(f.db, 'sales_invoices'), 0)
  })

  it('product update keeps the code, guards duplicates, and requires an active group', async () => {
    const f = await setup()
    const a = await f.catalog.products.create({ name: 'الف', groupId: f.groupId })
    const b = await f.catalog.products.create({ name: 'ب', groupId: f.groupId })
    const upd = await f.catalog.products.update(a.id, { name: 'الف جدید', groupId: f.groupId, salePrice: 900 })
    assert.equal(upd.code, a.code)
    assert.equal(upd.salePrice, 900)
    await expectAppError(f.catalog.products.update(a.id, { name: 'الف', code: b.code, groupId: f.groupId }), 'duplicate')
    const g2 = await f.catalog.groups.create({ name: 'گروه ۲' })
    await f.catalog.groups.setActive(g2.id, false)
    await expectAppError(f.catalog.products.update(a.id, { name: 'الف', groupId: g2.id }), 'validation', 'گروه')
    await expectAppError(f.catalog.products.update(newId(), { name: 'الف', groupId: f.groupId }), 'not_found')
    assert.equal((await f.catalog.products.list({ search: 'جدید' })).length, 1)
    assert.equal((await f.catalog.products.list({ search: '%' })).length, 0, 'LIKE wildcards are escaped')
  })
})
