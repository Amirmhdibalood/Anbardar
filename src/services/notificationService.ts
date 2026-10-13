import type { SqlExecutor } from '../database/types'
import { daysUntil } from '../models/cheque'
import { createRepositories } from '../repositories'
import { formatMoney } from '../utils/money'
import { toPersianDigits } from '../utils/persian'
import { formatQuantityWithUnit } from '../utils/quantity'
import { createChequeService } from './chequeService'

/** طراحی: docs/stage3-notifications-safety.md — اعلان‌ها از داده زنده ساخته می‌شوند؛ فقط وضعیت «خوانده‌شده» ذخیره می‌شود */
export const READ_KEY = 'notifications_read'

export type NotificationKind = 'cheque_overdue' | 'cheque_today' | 'cheque_soon' | 'stock_out' | 'stock_low'

export interface AppNotification {
  /** شناسه پایدار kind:entity:bucket (تکراری ساخته نمی‌شود) */
  id: string
  kind: NotificationKind
  title: string
  detail: string
  /** تاریخ مربوط (سررسید چک / آخرین تغییر موجودی) */
  date: string | null
  /** مسیر صفحه مرتبط */
  to: string
  severity: 0 | 1 | 2
  read: boolean
}

const SEVERITY: Record<NotificationKind, 0 | 1 | 2> = { cheque_overdue: 2, stock_out: 2, cheque_today: 1, cheque_soon: 0, stock_low: 0 }

export function createNotificationService(db: SqlExecutor) {
  const r = () => createRepositories(db)

  async function readIds(): Promise<Set<string>> {
    try {
      const raw = await r().settings.getValue(READ_KEY)
      const list = raw ? (JSON.parse(raw) as unknown) : []
      return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [])
    } catch {
      return new Set()
    }
  }
  const saveRead = (ids: Iterable<string>) => r().settings.setValue(READ_KEY, JSON.stringify([...ids]))

  /** ساخت اعلان‌ها از داده فعلی */
  async function compute(now = new Date()): Promise<Omit<AppNotification, 'read'>[]> {
    const out: Omit<AppNotification, 'read'>[] = []
    const until = new Date(now.getTime() + 8 * 24 * 3600 * 1000).toISOString()
    for (const c of await createChequeService(db).dueUntil(until)) {
      const n = daysUntil(c.dueDate, now)
      if (n > 7) continue
      const kind: NotificationKind = n < 0 ? 'cheque_overdue' : n === 0 ? 'cheque_today' : 'cheque_soon'
      const dir = c.direction === 'received' ? 'دریافتی از' : 'پرداختی به'
      out.push({
        id: `cheque:${c.id}:${kind.slice(7)}`,
        kind,
        title: n < 0 ? `سررسید چک گذشته (${toPersianDigits(-n)} روز)` : n === 0 ? 'سررسید چک امروز است' : `سررسید چک ${toPersianDigits(n)} روز دیگر`,
        detail: `چک ${dir} ${c.partyName} · ${formatMoney(c.amount)} · بانک ${c.bank} · شماره ${toPersianDigits(c.number)}`,
        date: c.dueDate,
        to: '/cheques',
        severity: SEVERITY[kind],
      })
    }
    for (const { product: p, quantity: q } of await r().products.listWithStock()) {
      if (!p.isActive) continue
      const out0 = q <= 0
      const low = !out0 && p.reorderPoint > 0 && q <= p.reorderPoint
      if (!out0 && !low) continue
      const kind: NotificationKind = out0 ? 'stock_out' : 'stock_low'
      out.push({
        id: `stock:${p.id}:${out0 ? 'out' : 'low'}`,
        kind,
        title: out0 ? `«${p.name}» تمام شد` : `«${p.name}» کم شده است`,
        detail: out0 ? 'موجودی این کالا صفر است.' : `موجودی ${formatQuantityWithUnit(q, p.unitName)} · نقطه سفارش ${formatQuantityWithUnit(p.reorderPoint, p.unitName)}`,
        date: p.updatedAt ?? null,
        to: `/stock?f=low`,
        severity: SEVERITY[kind],
      })
    }
    // یکتا بر اساس شناسه، مرتب: شدت بیشتر اول، بعد تاریخ
    const unique = [...new Map(out.map((n) => [n.id, n])).values()]
    return unique.sort((a, b) => b.severity - a.severity || String(a.date ?? '').localeCompare(String(b.date ?? '')))
  }

  return {
    async list(now = new Date()): Promise<AppNotification[]> {
      const items = await compute(now)
      const read = await readIds()
      const live = new Set(items.map((i) => i.id))
      // وضعیت خوانده‌شده فقط برای اعلان‌های موجود نگه داشته می‌شود
      const pruned = [...read].filter((id) => live.has(id))
      if (pruned.length !== read.size) await saveRead(pruned)
      return items.map((i) => ({ ...i, read: read.has(i.id) }))
    },
    async unreadCount(now = new Date()): Promise<number> {
      return (await this.list(now)).filter((n) => !n.read).length
    },
    async markRead(id: string): Promise<void> {
      const read = await readIds()
      read.add(id)
      await saveRead(read)
    },
    async markAllRead(now = new Date()): Promise<void> {
      const items = await compute(now)
      await saveRead(items.map((i) => i.id))
    },
  }
}
