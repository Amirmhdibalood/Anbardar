import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createMoneyService } from '../src/services/moneyService'
import { createNotificationService, READ_KEY } from '../src/services/notificationService'
import { createPurchaseService } from '../src/services/purchaseService'
import { createSaleService } from '../src/services/saleService'
import { Q, setup } from './helpers'

const NOW = new Date('2026-10-13T09:00:00.000Z')
const day = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString()

async function world() {
  const f = await setup()
  const customer = await f.catalog.customers.create({ name: 'مشتری' })
  const low = await f.catalog.products.create({ name: 'کم', groupId: f.groupId, reorderPoint: Q(5) })
  const ok = await f.catalog.products.create({ name: 'زیاد', groupId: f.groupId, reorderPoint: Q(1) })
  await createPurchaseService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: low.id, quantity: Q(3), unitPrice: 1000 }, { productId: ok.id, quantity: Q(50), unitPrice: 1000 }] })
  await createSaleService(f.db).create({ customerId: customer.id, paidAmount: 0, warehouseId: f.warehouseId, items: [{ productId: ok.id, quantity: Q(1), unitPrice: 9_000_000 }] })
  const money = createMoneyService(f.db)
  const cheque = (dueDate: string, number: string) => money.create({ kind: 'receipt', partyId: customer.id, amount: 1_000_000, method: 'cheque', cheque: { number, bank: 'ملت', dueDate } })
  return { f, n: createNotificationService(f.db), low, ok, cheque }
}

describe('stage 3: notifications', () => {
  it('builds cheque buckets (overdue/today/soon) and ignores > 7 days', async () => {
    const { n, cheque } = await world()
    await cheque(day(-2), '1')
    await cheque(day(0), '2')
    await cheque(day(5), '3')
    await cheque(day(12), '4')
    const kinds = (await n.list(NOW)).filter((i) => i.kind.startsWith('cheque')).map((i) => i.kind)
    assert.deepEqual(kinds.sort(), ['cheque_overdue', 'cheque_soon', 'cheque_today'])
  })
  it('low stock at/under reorder point and out of stock; dedupes', async () => {
    const { f, n, low, ok } = await world()
    const items = await n.list(NOW)
    assert.ok(items.some((i) => i.id === `stock:${low.id}:low`))
    assert.ok(!items.some((i) => i.id.startsWith(`stock:${ok.id}`)))
    assert.equal(new Set(items.map((i) => i.id)).size, items.length)
    const c2 = await f.catalog.customers.create({ name: 'دو' })
    await createSaleService(f.db).create({ customerId: c2.id, paidAmount: 0, warehouseId: f.warehouseId, items: [{ productId: low.id, quantity: Q(3), unitPrice: 9_000_000 }] })
    const after = await n.list(NOW)
    assert.ok(after.some((i) => i.id === `stock:${low.id}:out` && i.severity === 2))
    assert.ok(!after.some((i) => i.id === `stock:${low.id}:low`))
  })
  it('read state persists, bucket change re-arms, stale ids are pruned', async () => {
    const { f, n, low } = await world()
    const id = `stock:${low.id}:low`
    const before = await n.unreadCount(NOW)
    await n.markRead(id)
    assert.equal(await n.unreadCount(NOW), before - 1)
    assert.equal((await createNotificationService(f.db).list(NOW)).find((i) => i.id === id)?.read, true)
    await n.markAllRead(NOW)
    assert.equal(await n.unreadCount(NOW), 0)
    const c2 = await f.catalog.customers.create({ name: 'دو' })
    await createSaleService(f.db).create({ customerId: c2.id, paidAmount: 0, warehouseId: f.warehouseId, items: [{ productId: low.id, quantity: Q(3), unitPrice: 9_000_000 }] })
    assert.equal(await n.unreadCount(NOW), 1, 'out bucket is a new unread item')
    await n.list(NOW)
    const stored = JSON.parse((await f.repos.settings.getValue(READ_KEY)) as string) as string[]
    assert.ok(!stored.includes(id), 'the old low id was pruned')
  })
})

describe('stage 3: backup change detection', () => {
  it('no data = no prompt; change after backup = prompt; settings-only change ignored', async () => {
    const { hasChangesSinceBackup, LAST_BACKUP_SETTING } = await import('../src/services/backupChanges')
    const f = await setup()
    assert.equal(await hasChangesSinceBackup(f.db), false, 'fresh install (seed only) = no prompt')
    await f.repos.settings.setValue(LAST_BACKUP_SETTING, '2999-01-01T00:00:00.000Z')
    assert.equal(await hasChangesSinceBackup(f.db), false)
    await f.repos.settings.setValue(LAST_BACKUP_SETTING, new Date().toISOString())
    await f.repos.settings.setValue('notifications_read', '[]')
    assert.equal(await hasChangesSinceBackup(f.db), false, 'settings changes are not data changes')
    await new Promise((r) => setTimeout(r, 5))
    await f.catalog.products.create({ name: 'تازه', groupId: f.groupId })
    assert.equal(await hasChangesSinceBackup(f.db), true)
    await f.repos.settings.setValue(LAST_BACKUP_SETTING, new Date(Date.now() + 1000).toISOString())
    assert.equal(await hasChangesSinceBackup(f.db), false)
  })
})

describe('stage 3: idempotent submit', () => {
  it('a repeated request key returns the same document for sale, purchase, returns and transfer', async () => {
    const { createReturnService, createTransferService } = await import('../src/services/returnService')
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'ک', groupId: f.groupId })
    const purchases = createPurchaseService(f.db)
    const sales = createSaleService(f.db)
    const buy = { warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(10), unitPrice: 1000 }], requestId: 'req-p' }
    const a = await purchases.create(buy)
    const b = await purchases.create(buy)
    assert.equal(a.invoice.id, b.invoice.id)
    assert.equal((await purchases.list()).length, 1)
    const sell = { warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 5000 }], requestId: 'req-s' }
    const [s1, s2] = await Promise.all([sales.create(sell), sales.create(sell)])
    assert.equal(s1.invoice.id, s2.invoice.id, 'concurrent double tap = one invoice')
    assert.equal((await sales.list()).length, 1)
    const rs = createReturnService(f.db)
    const sr = { salesInvoiceId: s1.invoice.id, lines: [{ sourceItemId: s1.items[0]!.id, quantity: Q(1) }], requestId: 'req-sr' }
    assert.equal((await rs.createSaleReturn(sr)).id, (await rs.createSaleReturn(sr)).id)
    const pr = { purchaseInvoiceId: a.invoice.id, lines: [{ sourceItemId: a.items[0]!.id, quantity: Q(1) }], requestId: 'req-pr' }
    assert.equal((await rs.createPurchaseReturn(pr)).id, (await rs.createPurchaseReturn(pr)).id)
    const w2 = await f.catalog.warehouses.create({ name: 'انبار دو' })
    const ts = createTransferService(f.db)
    const tr = { fromWarehouseId: f.warehouseId, toWarehouseId: w2.id, lines: [{ productId: p.id, quantity: Q(1) }], requestId: 'req-t' }
    assert.equal((await ts.create(tr)).id, (await ts.create(tr)).id)
    assert.equal((await ts.list()).length, 1)
    // بدون کلید: هر بار سند تازه
    await purchases.create({ ...buy, requestId: undefined })
    assert.equal((await purchases.list()).length, 2)
  })
  it('the DB rejects a second document with the same request key', async () => {
    const f = await setup()
    const p = await f.catalog.products.create({ name: 'ک', groupId: f.groupId })
    const a = await createPurchaseService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 1 }], requestId: 'k' })
    const b = await createPurchaseService(f.db).create({ warehouseId: f.warehouseId, items: [{ productId: p.id, quantity: Q(1), unitPrice: 1 }] })
    await assert.rejects(f.db.run('UPDATE purchase_invoices SET request_id = ? WHERE id = ?', ['k', b.invoice.id]))
    await assert.rejects(f.db.run('UPDATE purchase_invoices SET request_id = ? WHERE id = ?', ['other', a.invoice.id]))
  })
})

describe('stage 3: minimal PDF writer', () => {
  it('writes a valid PDF 1.4 skeleton with a correct xref table', async () => {
    const { buildPdf } = await import('../src/utils/pdf')
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const bytes = buildPdf([{ jpeg, width: 2, height: 3 }, { jpeg, width: 2, height: 3 }])
    const text = Buffer.from(bytes).toString('latin1')
    assert.ok(text.startsWith('%PDF-1.4'))
    assert.ok(text.trimEnd().endsWith('%%EOF'))
    assert.match(text, /\/Count 2/)
    const xref = Number(/startxref\n(\d+)/.exec(text)![1])
    assert.equal(text.slice(xref, xref + 4), 'xref')
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    assert.equal(offsets.length, 8)
    offsets.forEach((o, i) => assert.equal(text.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`))
    assert.throws(() => buildPdf([]))
  })
})
