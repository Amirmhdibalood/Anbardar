import type { SqlExecutor } from '../database/types'
import type { IsoDateTime, Money } from '../models/common'
import type { InvoiceKind } from '../models/invoice'
import {
  MONEY_METHOD_LABELS,
  type InvoiceSettlement,
  type LedgerEntry,
  type MoneyDocument,
  type MoneyMethod,
  type MoneySource,
} from '../models/money'
import type { Party, PartyInput } from '../models/party'
import { createCatalogService } from './catalogService'
import { createRepositories } from '../repositories'
import { compareFa } from '../utils/collate'
import { AppError, ValidationError } from '../utils/errors'
import { formatMoney } from '../utils/money'
import { toPersianDigits } from '../utils/persian'
import { nowIso } from '../utils/time'
import { Fields, amountInRange, cleanText, optionalIsoDate, optionalText, requiredId } from '../validation/fields'

export interface AllocationInput {
  invoiceId: string
  amount: Money
}

export interface MoneyDocumentInput {
  kind: 'receipt' | 'payment'
  partyId: string
  amount: Money
  docDate?: IsoDateTime
  method?: MoneyMethod
  note?: string | null
  /** فقط برای فاکتورهای باز همین طرف (دریافت ← فروش، پرداخت ← خرید) */
  allocations?: AllocationInput[]
  /** شناسه یکتای فرم برای جلوگیری از ثبت دوباره با دو بار زدن دکمه */
  requestId?: string
}

export interface OpeningBalanceInput {
  partyId: string
  amount: Money
  /** debit = طرف به ما بدهکار است؛ credit = ما به طرف بدهکاریم */
  side: 'debit' | 'credit'
  docDate?: IsoDateTime
  note?: string | null
  requestId?: string
}

export interface OpenInvoice {
  id: string
  number: number
  date: IsoDateTime
  settlement: InvoiceSettlement
}

export interface PartyWithBalance {
  party: Party
  balance: Money
}

export interface BalancesReport {
  debtors: PartyWithBalance[]
  creditors: PartyWithBalance[]
  totalReceivable: Money
  totalPayable: Money
}

const MAX_REASON = 200
const METHODS = Object.keys(MONEY_METHOD_LABELS) as MoneyMethod[]

/** پیشنهاد تخصیص «قدیمی‌ترین اول» (فقط پیشنهاد؛ کاربر تأیید یا تغییر می‌دهد) */
export function suggestOldestFirst(open: readonly Pick<OpenInvoice, 'id' | 'settlement'>[], amount: Money): AllocationInput[] {
  let left = Math.max(0, Math.trunc(amount))
  const out: AllocationInput[] = []
  for (const inv of open) {
    if (left <= 0) break
    const take = Math.min(left, inv.settlement.remaining)
    if (take > 0) out.push({ invoiceId: inv.id, amount: take })
    left -= take
  }
  return out
}

const invoiceKindFor = (kind: 'receipt' | 'payment'): InvoiceKind => (kind === 'receipt' ? 'sales' : 'purchase')

/**
 * اسناد مالی (دریافت، پرداخت، مانده اول دوره) و مانده طرف حساب. طراحی: docs/parties-and-money.md
 * مانده فقط از اسناد فعال محاسبه می‌شود؛ هیچ عدد «مانده» جایی ذخیره نمی‌شود.
 */
export function createMoneyService(db: SqlExecutor) {
  return {
    async create(input: MoneyDocumentInput): Promise<MoneyDocument> {
      if (input.requestId) {
        const existing = await createRepositories(db).money.getByRequestId(input.requestId)
        if (existing) return existing
      }
      const f = new Fields()
      const kind = input.kind === 'payment' ? 'payment' : 'receipt'
      const partyId = requiredId(f, 'partyId', 'طرف حساب', input.partyId)
      const amount = amountInRange(f, 'amount', 'مبلغ', input.amount, 1)
      const docDate = optionalIsoDate(f, 'docDate', 'تاریخ', input.docDate) ?? nowIso()
      const method = input.method ?? 'cash'
      if (!METHODS.includes(method)) f.fail('method', 'روش پرداخت معتبر نیست.')
      const note = optionalText(f, 'note', 'توضیحات', input.note)
      f.done()

      return db.transaction(async (tx) => {
        const r = createRepositories(tx)
        if (input.requestId) {
          const existing = await r.money.getByRequestId(input.requestId)
          if (existing) return existing
        }
        const party = await r.parties.getById(partyId)
        if (!party || !party.isActive) throw new ValidationError({ partyId: 'طرف حساب انتخاب‌شده پیدا نشد یا غیرفعال است.' })
        if (party.isSystem) throw new ValidationError({ partyId: `برای «${party.name}» حساب جدا نگه داشته نمی‌شود؛ یک طرف حساب با نام ثبت کنید.` })

        const invoiceKind = invoiceKindFor(kind)
        const openList = await r.money.openInvoices(invoiceKind, party.id)
        const open = new Map(openList.map((o) => [o.id, o]))
        // تصمیم کاربر: اگر چیزی دستی تخصیص داده نشد، هنگام ثبت «قدیمی‌ترین فاکتور اول» خودکار اعمال می‌شود
        const manual = (input.allocations ?? []).filter((a) => a.amount !== 0)
        const allocations = manual.length ? manual : suggestOldestFirst(openList, amount)
        const errors: Record<string, string> = {}
        let sum = 0
        const seen = new Set<string>()
        allocations.forEach((a, i) => {
          const inv = open.get(a.invoiceId)
          if (!Number.isSafeInteger(a.amount) || a.amount < 0) errors[`allocations.${i}`] = 'مبلغ تخصیص باید عدد صحیح مثبت باشد.'
          else if (!inv || seen.has(a.invoiceId)) errors[`allocations.${i}`] = 'این فاکتور باز نیست یا مال این طرف حساب نیست.'
          else if (a.amount > inv.settlement.remaining) {
            errors[`allocations.${i}`] = `برای فاکتور ${toPersianDigits(inv.number)} حداکثر ${formatMoney(inv.settlement.remaining, { withUnit: true })} باقی مانده است.`
          }
          seen.add(a.invoiceId)
          sum += a.amount
        })
        if (Object.keys(errors).length) throw new ValidationError(errors)
        if (sum > amount) throw new ValidationError({ allocations: 'جمع تخصیص به فاکتورها از مبلغ سند بیشتر است.' })

        const doc = await r.money.insertDocument({ kind, partyId: party.id, amount, docDate, method, note, source: 'manual', sourceId: null, requestId: input.requestId ?? null })
        for (const a of allocations) await r.money.insertSettlement(doc.id, invoiceKind, a.invoiceId, a.amount)
        return doc
      })
    },

    /**
     * سند تسویه مانده: بستانکار (ما به او بدهکاریم / اضافه پرداخت کرده) ← پرداخت به او؛
     * بدهکاری که فاکتور فروش باز ندارد (مثلاً اضافه پرداخت ما به تأمین‌کننده) ← دریافت از او.
     */
    async settleBalance(partyId: string, opts: { requestId?: string; method?: MoneyMethod; note?: string | null } = {}): Promise<MoneyDocument> {
      if (opts.requestId) {
        const existing = await createRepositories(db).money.getByRequestId(opts.requestId)
        if (existing) return existing
      }
      const plan = await this.settlePlan(partyId)
      if (!plan) throw new AppError('validation', 'این حساب مانده‌ای برای تسویه ندارد.')
      return this.create({ kind: plan.kind, partyId, amount: plan.amount, method: opts.method, note: opts.note ?? 'تسویه مانده حساب', requestId: opts.requestId })
    },

    /** آیا دکمه تسویه مانده معنا دارد؟ (null = نه) */
    async settlePlan(partyId: string): Promise<{ kind: 'receipt' | 'payment'; amount: Money } | null> {
      const r = createRepositories(db)
      const balance = await r.money.balanceOf(partyId)
      if (balance < 0) return { kind: 'payment', amount: -balance }
      if (balance > 0 && (await r.money.openInvoices('sales', partyId)).length === 0) return { kind: 'receipt', amount: balance }
      return null
    },

    /** مانده اول دوره به‌صورت یک سند واقعی (قابل ابطال، بدون ویرایش) */
    async createOpening(input: OpeningBalanceInput): Promise<MoneyDocument> {
      if (input.requestId) {
        const existing = await createRepositories(db).money.getByRequestId(input.requestId)
        if (existing) return existing
      }
      const f = new Fields()
      const partyId = requiredId(f, 'partyId', 'طرف حساب', input.partyId)
      const amount = amountInRange(f, 'amount', 'مبلغ', input.amount, 1)
      const docDate = optionalIsoDate(f, 'docDate', 'تاریخ', input.docDate) ?? nowIso()
      const note = optionalText(f, 'note', 'توضیحات', input.note)
      if (input.side !== 'debit' && input.side !== 'credit') f.fail('side', 'نوع مانده را انتخاب کنید.')
      f.done()
      return db.transaction(async (tx) => {
        const r = createRepositories(tx)
        const party = await r.parties.getById(partyId)
        if (!party || !party.isActive) throw new ValidationError({ partyId: 'طرف حساب انتخاب‌شده پیدا نشد یا غیرفعال است.' })
        if (party.isSystem) throw new ValidationError({ partyId: `برای «${party.name}» مانده نگه داشته نمی‌شود.` })
        return r.money.insertDocument({
          kind: input.side === 'debit' ? 'opening_debit' : 'opening_credit',
          partyId,
          amount,
          docDate,
          method: null,
          note,
          source: 'manual',
          sourceId: null,
          requestId: input.requestId ?? null,
        })
      })
    },

    /** ساخت طرف حساب جدید و (اختیاری) مانده اول دوره‌اش در یک تراکنش */
    async createPartyWithOpening(input: PartyInput, opening: Omit<OpeningBalanceInput, 'partyId'> | null): Promise<Party> {
      return db.transaction(async (tx) => {
        const party = await createCatalogService(tx).parties.create(input)
        if (opening && opening.amount > 0) await createMoneyService(tx).createOpening({ ...opening, partyId: party.id })
        return party
      })
    },

    /** ابطال سند دستی؛ تخصیص‌هایش بی‌اثر می‌شوند. سند خودکار فقط با ابطال سند مبدأ باطل می‌شود. */
    async cancel(id: string, reason?: string | null): Promise<void> {
      const why = cleanText(reason) || null
      if (why && why.length > MAX_REASON) throw new ValidationError({ reason: `دلیل ابطال نباید بیشتر از ${MAX_REASON} نویسه باشد.` })
      await db.transaction(async (tx) => {
        const r = createRepositories(tx)
        const doc = await r.money.getDocument(id)
        if (!doc) throw new AppError('not_found', 'سند پیدا نشد.')
        if (doc.status === 'cancelled') throw new AppError('immutable', 'این سند قبلاً ابطال شده است.')
        if (doc.source !== 'manual') {
          throw new AppError('protected', 'این سند همراه فاکتور یا برگشت ثبت شده است. برای اصلاح، همان فاکتور یا برگشت را ابطال کنید.')
        }
        await r.money.markCancelled(id, why, nowIso())
      })
    },

    get: (id: string) => createRepositories(db).money.getDocument(id),
    list: (filter: Parameters<ReturnType<typeof createRepositories>['money']['listDocuments']>[0] = {}) => createRepositories(db).money.listDocuments(filter),
    settlementsOf: (id: string) => createRepositories(db).money.settlementsOfDocument(id),
    openInvoices: (kind: InvoiceKind, partyId: string): Promise<OpenInvoice[]> => createRepositories(db).money.openInvoices(kind, partyId),
    invoiceSettlement: async (kind: InvoiceKind, invoiceId: string) => (await createRepositories(db).money.invoiceSettlements(kind, [invoiceId])).get(invoiceId) ?? null,
    invoiceSettlements: (kind: InvoiceKind, ids: string[]) => createRepositories(db).money.invoiceSettlements(kind, ids),
    documentsForInvoice: (kind: InvoiceKind, invoiceId: string) => createRepositories(db).money.documentsForInvoice(kind, invoiceId),
    balanceOf: (partyId: string) => createRepositories(db).money.balanceOf(partyId),
    ledger: (partyId: string): Promise<LedgerEntry[]> => createRepositories(db).money.ledger(partyId),

    /** سند با طرف حساب و فاکتورهای تخصیص‌یافته (برای صفحه جزئیات) */
    async detail(id: string) {
      const r = createRepositories(db)
      const doc = await r.money.getDocument(id)
      if (!doc) return null
      const party = await r.parties.getById(doc.partyId)
      const settlements = await r.money.settlementsOfDocument(id)
      const allocations = []
      for (const s of settlements) {
        const kind: InvoiceKind = s.salesInvoiceId ? 'sales' : 'purchase'
        const invoiceId = (s.salesInvoiceId ?? s.purchaseInvoiceId)!
        const table = kind === 'sales' ? 'sales_invoices' : 'purchase_invoices'
        const row = await db.get(`SELECT invoice_number, status FROM ${table} WHERE id = ?`, [invoiceId])
        allocations.push({ kind, invoiceId, amount: s.amount, number: row ? Number(row['invoice_number']) : 0, invoiceStatus: row ? String(row['status']) : 'missing' })
      }
      return { document: doc, party, allocations }
    },

    /** مانده همه طرف‌ها (برای فهرست طرف حساب) */
    async balanceMap(): Promise<Map<string, Money>> {
      return new Map((await createRepositories(db).money.balances()).map((b) => [b.partyId, b.balance]))
    },

    /** گزارش بدهکاران و بستانکاران (بزرگ‌ترین مانده اول) */
    async balancesReport(): Promise<BalancesReport> {
      const r = createRepositories(db)
      const balances = await r.money.balances()
      const parties = new Map((await r.parties.list({ includeInactive: true })).map((p) => [p.id, p]))
      const rows = balances.flatMap((b) => {
        const party = parties.get(b.partyId)
        return party ? [{ party, balance: b.balance }] : []
      })
      const sort = (a: PartyWithBalance, b: PartyWithBalance) => Math.abs(b.balance) - Math.abs(a.balance) || compareFa(a.party.name, b.party.name)
      const debtors = rows.filter((x) => x.balance > 0).sort(sort)
      const creditors = rows.filter((x) => x.balance < 0).sort(sort)
      return {
        debtors,
        creditors,
        totalReceivable: debtors.reduce((s, x) => s + x.balance, 0),
        totalPayable: -creditors.reduce((s, x) => s + x.balance, 0),
      }
    },
  }
}

/** --- کمک‌تابع‌های داخل تراکنش برای سرویس‌های فاکتور و برگشت --- */

/** سند خودکار همراه فاکتور (مبلغ پرداختی هنگام ثبت فاکتور) */
export async function recordInvoicePayment(
  tx: SqlExecutor,
  kind: InvoiceKind,
  invoice: { id: string; partyId: string },
  amount: Money,
  docDate: IsoDateTime,
  method: MoneyMethod = 'cash',
): Promise<void> {
  if (amount <= 0) return
  const r = createRepositories(tx)
  const doc = await r.money.insertDocument({
    kind: kind === 'sales' ? 'receipt' : 'payment',
    partyId: invoice.partyId,
    amount,
    docDate,
    method,
    note: null,
    source: kind === 'sales' ? 'sale' : 'purchase',
    sourceId: invoice.id,
    requestId: null,
  })
  await r.money.insertSettlement(doc.id, kind, invoice.id, amount)
}

/** ابطال اسناد خودکارِ یک سند مبدأ (هنگام ابطال فاکتور یا برگشت) */
export async function cancelAutoDocuments(tx: SqlExecutor, source: Exclude<MoneySource, 'manual'>, sourceId: string, reason: string): Promise<void> {
  const r = createRepositories(tx)
  for (const doc of await r.money.listBySource(source, sourceId)) {
    if (doc.status === 'active') await r.money.markCancelled(doc.id, reason, nowIso())
  }
}

/**
 * پس از ثبت برگشت: اگر مبلغ پرداخت‌شده فاکتور از مبلغ خالص (بعد از برگشت) بیشتر شد، مازاد به‌صورت استرداد خودکار ثبت می‌شود.
 * فاکتور نقدی ← پول پس داده می‌شود (رفتار قبلی)؛ فاکتور نسیه ← فقط بدهی کم می‌شود.
 */
export async function recordReturnRefund(
  tx: SqlExecutor,
  kind: InvoiceKind,
  invoice: { id: string; partyId: string },
  returnId: string,
  docDate: IsoDateTime,
): Promise<Money> {
  const r = createRepositories(tx)
  const s = (await r.money.invoiceSettlements(kind, [invoice.id])).get(invoice.id)
  if (!s) return 0
  const overpaid = s.settled - (s.total - s.returned)
  if (overpaid <= 0) return 0
  await r.money.insertDocument({
    kind: kind === 'sales' ? 'payment' : 'receipt',
    partyId: invoice.partyId,
    amount: overpaid,
    docDate,
    method: 'cash',
    note: 'استرداد برگشت',
    source: kind === 'sales' ? 'sale_return' : 'purchase_return',
    sourceId: returnId,
    requestId: null,
  })
  return overpaid
}
