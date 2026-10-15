import type { SqlExecutor, SqlRow } from '../database/types'
import { AppError, ValidationError } from '../utils/errors'
import { newId } from '../utils/id'
import { formatJalaliDay, isJalaliLeapYear, toJalali, type JalaliDate } from '../utils/jalali'
import { mulDivRound } from '../utils/money'
import { jalaliFromParam, jalaliToParam, resolvePeriod } from '../utils/period'
import { toPersianDigits } from '../utils/persian'
import { cleanText } from '../validation/fields'
import { authorize, writeAudit } from './authz'

/** دوره مالی. طراحی: docs/stage5-fiscal-periods.md */
export interface FiscalPeriod {
  id: string
  name: string
  /** روز شمسی «YYYY-MM-DD» (هر دو شامل) */
  startDay: string
  endDay: string
  /** بازه ISO؛ endAt انحصاری */
  startAt: string
  endAt: string
  status: 'open' | 'closed'
  closedAt: string | null
  closedBy: string | null
}

export interface FiscalBalances {
  parties: { partyId: string; name: string; balance: number }[]
  stock: { productId: string; productName: string; warehouseId: string; warehouseName: string; quantity: number; value: number }[]
  layers: number
  cash: number
  stockValue: number
  receivable: number
  payable: number
}

const map = (r: SqlRow): FiscalPeriod => ({
  id: r.id as string,
  name: r.name as string,
  startDay: r.start_day as string,
  endDay: r.end_day as string,
  startAt: r.start_at as string,
  endAt: r.end_at as string,
  status: r.status as 'open' | 'closed',
  closedAt: (r.closed_at as string | null) ?? null,
  closedBy: (r.closed_by as string | null) ?? null,
})

export const fiscalLabel = (p: Pick<FiscalPeriod, 'startDay' | 'endDay'>) =>
  `${formatJalaliDay(jalaliFromParam(p.startDay)!)} تا ${formatJalaliDay(jalaliFromParam(p.endDay)!)}`

/** پیشنهاد پیش‌فرض: سال شمسی کامل (۱ فروردین تا ۲۹/۳۰ اسفند) */
export function jalaliYearRange(jy: number): { startDay: string; endDay: string; name: string } {
  return {
    startDay: jalaliToParam({ jy, jm: 1, jd: 1 }),
    endDay: jalaliToParam({ jy, jm: 12, jd: isJalaliLeapYear(jy) ? 30 : 29 }),
    name: `سال مالی ${toPersianDigits(jy)}`,
  }
}

/** دوره بسته‌ای که این لحظه داخل آن است (یا null) */
export async function closedPeriodAt(tx: SqlExecutor, iso: string): Promise<FiscalPeriod | null> {
  const r = await tx.get("SELECT * FROM fiscal_periods WHERE status = 'closed' AND start_at <= ? AND end_at > ? LIMIT 1", [iso, iso])
  return r ? map(r) : null
}

/** قفل دوره: هیچ سندی با تاریخ داخل دوره بسته ثبت یا ابطال نمی‌شود */
export async function assertDatesOpen(tx: SqlExecutor, dates: (string | null | undefined)[]): Promise<void> {
  for (const d of dates) {
    if (!d) continue
    const p = await closedPeriodAt(tx, d)
    if (p) throw new AppError('immutable', `دوره مالی «${p.name}» (${fiscalLabel(p)}) بسته است؛ سند با تاریخ داخل آن ثبت یا ابطال نمی‌شود.`)
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** آثار مانده طرف‌حساب با تاریخ سند (همان قواعد دفتر طرف حساب) */
const DATED_EFFECTS = `
SELECT customer_id AS party_id, total_amount AS delta, invoice_date AS d FROM sales_invoices WHERE status = 'active'
UNION ALL SELECT i.customer_id, -r.total_amount, r.doc_date FROM sale_returns r JOIN sales_invoices i ON i.id = r.sales_invoice_id WHERE r.status = 'active'
UNION ALL SELECT supplier_id, -total_amount, invoice_date FROM purchase_invoices WHERE status = 'active'
UNION ALL SELECT i.supplier_id, r.total_amount, r.doc_date FROM purchase_returns r JOIN purchase_invoices i ON i.id = r.purchase_invoice_id WHERE r.status = 'active'
UNION ALL SELECT party_id, CASE WHEN kind IN ('payment', 'opening_debit') THEN amount ELSE -amount END, doc_date FROM money_documents WHERE status = 'active'`

export function createFiscalService(db: SqlExecutor, opts: { now?: () => Date } = {}) {
  const now = opts.now ?? (() => new Date())

  async function load(tx: SqlExecutor, id: string): Promise<FiscalPeriod> {
    const r = await tx.get('SELECT * FROM fiscal_periods WHERE id = ?', [id])
    if (!r) throw new AppError('not_found', 'دوره مالی پیدا نشد.')
    return map(r)
  }

  /** مانده‌ها در لحظه `at` (انحصاری) */
  async function balancesAt(tx: SqlExecutor, at: string) {
    const parties = await tx.all(`SELECT party_id, SUM(delta) AS b FROM (${DATED_EFFECTS}) WHERE d < ? GROUP BY party_id HAVING SUM(delta) <> 0`, [at])
    const stock = await tx.all(
      `SELECT product_id, warehouse_id, SUM(quantity_delta) AS q FROM stock_movements WHERE occurred_at < ? GROUP BY product_id, warehouse_id HAVING SUM(quantity_delta) <> 0`,
      [at],
    )
    const layers = await tx.all(
      `SELECT l.id, l.product_id, l.warehouse_id, l.quantity, l.total_cost,
  l.quantity - COALESCE((SELECT SUM(a.quantity) FROM lot_allocations a JOIN stock_movements m ON m.id = a.movement_id
    LEFT JOIN stock_movements rv ON rv.id = a.reversal_movement_id
    WHERE a.lot_id = l.id AND m.occurred_at < ? AND (rv.id IS NULL OR rv.occurred_at >= ?)), 0) AS remaining
FROM cost_lots l JOIN stock_movements lm ON lm.id = l.movement_id WHERE lm.occurred_at < ?`,
      [at, at, at],
    )
    const cash = await tx.get<{ c: number | null }>(
      `SELECT COALESCE((SELECT SUM(CASE WHEN kind = 'receipt' THEN amount ELSE -amount END) FROM money_documents WHERE status = 'active' AND method = 'cash' AND kind IN ('receipt', 'payment') AND doc_date < ?), 0)
  - COALESCE((SELECT SUM(amount) FROM expenses WHERE status = 'active' AND expense_date < ?), 0) AS c`,
      [at, at],
    )
    return {
      parties: parties.map((r) => ({ partyId: r.party_id as string, balance: Number(r.b) })),
      stock: stock.map((r) => ({ productId: r.product_id as string, warehouseId: r.warehouse_id as string, quantity: Number(r.q) })),
      layers: layers
        .map((r) => {
          const remaining = Number(r.remaining)
          return { lotId: r.id as string, productId: r.product_id as string, warehouseId: r.warehouse_id as string, quantity: remaining, value: mulDivRound(Number(r.total_cost), remaining, Number(r.quantity)) }
        })
        .filter((l) => l.quantity > 0),
      cash: Number(cash?.c ?? 0),
    }
  }

  return {
    async list(): Promise<FiscalPeriod[]> {
      return (await db.all('SELECT * FROM fiscal_periods ORDER BY start_day DESC')).map(map)
    },

    get: (id: string) => load(db, id),

    /** پیشنهاد دوره بعدی: سال بعد از آخرین دوره، وگرنه سال جاری */
    async suggest(): Promise<{ startDay: string; endDay: string; name: string }> {
      const last = await db.get<{ end_day: string }>('SELECT end_day FROM fiscal_periods ORDER BY end_day DESC LIMIT 1')
      const jy = last ? Number(last.end_day.slice(0, 4)) + 1 : toJalali(now()).jy
      return jalaliYearRange(jy)
    },

    async create(input: { name: string; startDay: string; endDay: string }): Promise<FiscalPeriod> {
      const name = cleanText(input.name)
      const errors: Record<string, string> = {}
      if (!name) errors.name = 'نام دوره را بنویسید.'
      else if (name.length > 60) errors.name = 'نام دوره نباید بیشتر از ۶۰ نویسه باشد.'
      const a: JalaliDate | undefined = DAY.test(input.startDay) ? jalaliFromParam(input.startDay) : undefined
      const b: JalaliDate | undefined = DAY.test(input.endDay) ? jalaliFromParam(input.endDay) : undefined
      if (!a) errors.startDay = 'تاریخ شروع درست نیست.'
      if (!b) errors.endDay = 'تاریخ پایان درست نیست.'
      if (a && b && jalaliToParam(a) > jalaliToParam(b)) errors.endDay = 'تاریخ پایان باید بعد از شروع باشد.'
      if (Object.keys(errors).length) throw new ValidationError(errors)
      const range = resolvePeriod({ key: 'custom', from: a, to: b })
      return db.transaction(async (tx) => {
        const actor = await authorize(tx, 'fiscal.manage')
        const id = newId()
        await tx.run('INSERT INTO fiscal_periods (id, name, start_day, end_day, start_at, end_at) VALUES (?, ?, ?, ?, ?, ?)', [id, name, jalaliToParam(a!), jalaliToParam(b!), range.from, range.to])
        const p = await load(tx, id)
        await writeAudit(tx, actor, { action: 'fiscal.create', entityType: 'fiscal_period', entityId: id, summary: `دوره مالی «${name}» (${fiscalLabel(p)}) تعریف شد` })
        return p
      })
    },

    /** حذف دوره باز (اشتباه در تعریف) */
    async remove(id: string): Promise<void> {
      await db.transaction(async (tx) => {
        const actor = await authorize(tx, 'fiscal.manage')
        const p = await load(tx, id)
        await tx.run('DELETE FROM fiscal_periods WHERE id = ?', [id])
        await writeAudit(tx, actor, { action: 'fiscal.remove', entityType: 'fiscal_period', entityId: id, summary: `دوره مالی «${p.name}» حذف شد` })
      })
    },

    /**
     * بستن دوره: فقط پس از پایان آن و وقتی دوره باز قبلی نمانده.
     * مانده‌ها (طرف حساب، موجودی، لایه‌های FIFO، صندوق) در لحظه پایان ثبت می‌شوند (انتقال به دوره بعد).
     */
    async close(id: string): Promise<FiscalPeriod> {
      return db.transaction(async (tx) => {
        const actor = await authorize(tx, 'fiscal.manage')
        const p = await load(tx, id)
        if (p.status === 'closed') throw new AppError('immutable', 'این دوره قبلاً بسته شده است.')
        if (p.endAt > now().toISOString()) throw new AppError('validation', 'دوره هنوز تمام نشده است؛ بعد از روز پایان آن را ببندید.')
        const earlier = await tx.get<{ name: string }>("SELECT name FROM fiscal_periods WHERE status = 'open' AND end_day < ? ORDER BY start_day LIMIT 1", [p.startDay])
        if (earlier) throw new AppError('validation', `اول دوره قبلی «${earlier.name}» را ببندید.`)
        const b = await balancesAt(tx, p.endAt)
        // سازگاری: موجودی هر کالا/انبار = جمع لایه‌های باقیمانده
        const layerQty = new Map<string, number>()
        for (const l of b.layers) layerQty.set(`${l.productId}|${l.warehouseId}`, (layerQty.get(`${l.productId}|${l.warehouseId}`) ?? 0) + l.quantity)
        for (const s of b.stock) {
          if ((layerQty.get(`${s.productId}|${s.warehouseId}`) ?? 0) !== s.quantity) {
            throw new AppError('integrity', 'موجودی انبار با لایه‌های بهای تمام‌شده نمی‌خواند؛ دوره بسته نشد. از «بررسی سلامت داده» استفاده کنید.')
          }
        }
        const ins = 'INSERT INTO fiscal_balances (id, period_id, kind, party_id, product_id, warehouse_id, lot_id, quantity, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        for (const x of b.parties) await tx.run(ins, [newId(), id, 'party', x.partyId, null, null, null, 0, x.balance])
        for (const x of b.stock) {
          const value = b.layers.filter((l) => l.productId === x.productId && l.warehouseId === x.warehouseId).reduce((s, l) => s + l.value, 0)
          await tx.run(ins, [newId(), id, 'stock', null, x.productId, x.warehouseId, null, x.quantity, value])
        }
        for (const l of b.layers) await tx.run(ins, [newId(), id, 'layer', null, l.productId, l.warehouseId, l.lotId, l.quantity, l.value])
        await tx.run(ins, [newId(), id, 'cash', null, null, null, null, 0, b.cash])
        const at = now().toISOString()
        await tx.run("UPDATE fiscal_periods SET status = 'closed', closed_at = ?, closed_by = ?, updated_at = ? WHERE id = ?", [at, actor.name, at, id])
        await writeAudit(tx, actor, {
          action: 'fiscal.close',
          entityType: 'fiscal_period',
          entityId: id,
          summary: `دوره مالی «${p.name}» بسته شد؛ ${toPersianDigits(b.parties.length)} مانده طرف حساب و ${toPersianDigits(b.stock.length)} ردیف موجودی به دوره بعد منتقل شد`,
        })
        return load(tx, id)
      })
    },

    /** بازگشایی (فقط مالک، فقط آخرین دوره بسته): مانده‌های انتقالی آن حذف می‌شود */
    async reopen(id: string): Promise<FiscalPeriod> {
      return db.transaction(async (tx) => {
        const actor = await authorize(tx, 'fiscal.manage')
        const p = await load(tx, id)
        if (p.status !== 'closed') throw new AppError('validation', 'این دوره باز است.')
        const later = await tx.get<{ name: string }>("SELECT name FROM fiscal_periods WHERE status = 'closed' AND start_day > ? LIMIT 1", [p.startDay])
        if (later) throw new AppError('validation', `اول دوره بعدی «${later.name}» را باز کنید.`)
        await tx.run('DELETE FROM fiscal_balances WHERE period_id = ?', [id])
        await tx.run("UPDATE fiscal_periods SET status = 'open', closed_at = NULL, closed_by = NULL, updated_at = ? WHERE id = ?", [now().toISOString(), id])
        await writeAudit(tx, actor, { action: 'fiscal.reopen', entityType: 'fiscal_period', entityId: id, summary: `دوره مالی «${p.name}» دوباره باز شد` })
        return load(tx, id)
      })
    },

    /** مانده‌های انتقالی دوره بسته (افتتاحیه دوره بعد) */
    async balances(id: string): Promise<FiscalBalances> {
      const rows = await db.all(
        `SELECT b.*, pa.name AS party_name, pr.name AS product_name, w.name AS warehouse_name FROM fiscal_balances b
LEFT JOIN parties pa ON pa.id = b.party_id LEFT JOIN products pr ON pr.id = b.product_id LEFT JOIN warehouses w ON w.id = b.warehouse_id
WHERE b.period_id = ? ORDER BY b.kind, ABS(b.amount) DESC`,
        [id],
      )
      const out: FiscalBalances = { parties: [], stock: [], layers: 0, cash: 0, stockValue: 0, receivable: 0, payable: 0 }
      for (const r of rows) {
        const amount = Number(r.amount)
        if (r.kind === 'party') {
          out.parties.push({ partyId: r.party_id as string, name: (r.party_name as string) ?? '', balance: amount })
          if (amount > 0) out.receivable += amount
          else out.payable -= amount
        } else if (r.kind === 'stock') {
          out.stock.push({ productId: r.product_id as string, productName: (r.product_name as string) ?? '', warehouseId: r.warehouse_id as string, warehouseName: (r.warehouse_name as string) ?? '', quantity: Number(r.quantity), value: amount })
          out.stockValue += amount
        } else if (r.kind === 'layer') out.layers++
        else if (r.kind === 'cash') out.cash = amount
      }
      return out
    },

    /** برای تست/گزارش: مانده‌ها در یک لحظه دلخواه */
    balancesAt: (at: string) => balancesAt(db, at),
  }
}
