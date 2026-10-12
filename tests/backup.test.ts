import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MIGRATIONS } from '../src/database/migrations'
import { runMigrations } from '../src/database/migrations/runner'
import { seedIfNeeded } from '../src/database/seed'
import { dumpDatabase, MemorySnapshotStore, restoreDump, validateDump } from '../src/database/snapshot'
import { createRepositories } from '../src/repositories'
import { createInventoryService } from '../src/services/inventoryService'
import { createPurchaseService } from '../src/services/purchaseService'
import { calcMinSalePrice } from '../src/services/pricing'
import { Q, setup } from './helpers'

describe('backup and restore', () => {
  it('validateDump rejects foreign/newer/corrupt files and accepts a real dump', async () => {
    const f = await setup()
    const dump = await dumpDatabase(f.db, MIGRATIONS.length, 'test')
    assert.equal(validateDump(dump, MIGRATIONS.length).ok, true)
    assert.equal(validateDump({ format: 'other' }, MIGRATIONS.length).ok, false)
    assert.equal(validateDump({ ...dump, schemaVersion: 99 }, MIGRATIONS.length).ok, false)
    assert.equal(validateDump({ ...dump, tables: { ...dump.tables, products: undefined } }, MIGRATIONS.length).ok, false)
  })

  it('round-trips purchase data through dump → empty db → restore and keeps cost invariants', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'هدفون', groupId: f.groupId })
    await createPurchaseService(f.db).create({
      warehouseId: f.warehouseId,
      discount: 100,
      items: [{ productId: p.id, quantity: Q(5), unitPrice: 1000 }],
    })
    const dump = await dumpDatabase(f.db, MIGRATIONS.length, 'user-backup')
    const json = JSON.stringify(dump)

    // دیتابیس خالی تازه
    const { freshDb } = await import('./helpers')
    const db2 = await freshDb()
    const snaps = new MemorySnapshotStore()
    await restoreDump(db2, JSON.parse(json))
    await runMigrations(db2, MIGRATIONS, snaps)
    await seedIfNeeded(db2) // shouldn't reseed over existing
    const repos = createRepositories(db2)
    const products = await repos.products.list({ includeInactive: true })
    assert.ok(products.some((x) => x.name === 'هدفون'))
    const inv = createInventoryService(db2)
    assert.equal(await inv.getQuantity(f.warehouseId, p.id), Q(5))
    assert.deepEqual(await inv.verifyConsistency(), [])
    assert.deepEqual(await inv.verifyCosts(), [])
    const lots = await repos.costs.listLots({ productId: p.id })
    assert.equal(lots[0]?.totalCost, 5000 - 100)
  })
})

it('calcMinSalePrice still works as smoke for pricing module used by backup page imports', () => {
  assert.equal(calcMinSalePrice(100, 0, 0).markupPrice, 100)
})
