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
