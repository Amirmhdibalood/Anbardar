import type { SqlExecutor } from '../database/types'
import type { InvoiceItem, InvoiceItemInput, InvoiceStatus, PurchaseCharge, PurchaseInvoice } from '../models/invoice'
import type { Product, Warehouse } from '../models/catalog'
import type { IsoDateTime } from '../models/common'
import { MISC_SUPPLIER_ID, type Supplier } from '../models/party'
import { createRepositories } from '../repositories'
import type { InvoiceWithItems } from '../repositories'
import { AppError, ValidationError } from '../utils/errors'
import { prepareInvoice } from '../utils/invoiceMath'
import { toEnglishDigits } from '../utils/persian'
import { checkLines, unitLabel } from './lineUnits'
import { nowIso } from '../utils/time'
import { cleanText } from '../validation/fields'
import { validateInvoice } from '../validation/entities'
import { createInventoryService } from './inventoryService'
import type { PaymentStatus } from '../models/money'
import { cancelAutoDocuments, recordInvoicePayment } from './moneyService'
import { resolvePaidAmount } from './paidAmount'
import { claimRequestId, findByRequestId } from './requestKey'

export interface PurchaseInput {
  /** خالی = تأمین‌کننده سیستمی «متفرقه» */
  supplierId?: string | null
  warehouseId: string
  /** پیش‌فرض: اکنون؛ عقب‌تاریخ مجاز است (هشدار تاریخ آینده با UI) */
  invoiceDate?: IsoDateTime
  reference?: string | null
  note?: string | null
  /** تخفیف کل فاکتور؛ از مبلغ پرداختی و از بهای لایه‌ها کم می‌شود */
  discount?: number
  /** مبلغ پرداختی هنگام ثبت؛ پیش‌فرض = کل فاکتور (خرید نقدی). کمتر از کل = نسیه (فقط برای تأمین‌کننده با نام) */
  paidAmount?: number
  items: InvoiceItemInput[]
  /** هزینه‌های جانبی (حمل، بیمه، ...): به بهای لایه‌ها اضافه می‌شود ولی جزو بدهی تأمین‌کننده نیست */
  charges?: { title: string; amount: number }[]
  /** روش تسهیم هزینه‌های جانبی؛ پیش‌فرض بر اساس ارزش */
  landedMethod?: 'value' | 'quantity'
  /** کلید یک‌باره فرم؛ تکرار آن همان فاکتور قبلی را برمی‌گرداند */
  requestId?: string | null
}

export interface InvoiceListFilter {
  /** شماره فاکتور، نام طرف حساب یا شماره مرجع */
  search?: string
  status?: InvoiceStatus
  from?: IsoDateTime
  to?: IsoDateTime
  limit?: number
  offset?: number
}

export interface PurchaseListRow {
  invoice: PurchaseInvoice
  supplierName: string
  itemCount: number
  payment?: PaymentStatus
}

export interface PurchaseDetail {
  invoice: PurchaseInvoice
  supplier: Supplier | null
  warehouse: Warehouse | null
  items: (InvoiceItem & { product: Product | null; netAmount: number; unitName: string })[]
  charges: PurchaseCharge[]
}

const MAX_REASON = 200

/**
 * خرید: هر ردیف فاکتور = یک حرکت «خرید» در دفتر + یک لایه بها با بهای خالص (مبلغ ردیف − سهم تخفیف فاکتور)،
 * همه در یک تراکنش. ابطال فقط وقتی مجاز است که هیچ‌چیز از لایه‌های این فاکتور مصرف نشده باشد.
 */
export function createPurchaseService(db: SqlExecutor) {
  return {
    async create(input: PurchaseInput): Promise<InvoiceWithItems<PurchaseInvoice>> {
      const clean = validateInvoice({ ...input, partyId: input.supplierId || MISC_SUPPLIER_ID, reference: input.reference ? toEnglishDigits(input.reference) : input.reference }, 'تأمین‌کننده')
      return db.transaction(async (tx) => {
        const r = createRepositories(tx)
        const existing = await findByRequestId(tx, 'purchase_invoices', input.requestId)
        if (existing) return { invoice: (await r.purchaseInvoices.getById(existing))!, items: await r.purchaseInvoices.getItems(existing) }
        const supplier = await r.suppliers.getById(clean.partyId)
        if (!supplier || !supplier.isActive) throw new ValidationError({ partyId: 'تأمین‌کننده انتخاب‌شده پیدا نشد یا غیرفعال است.' })
        const warehouse = await r.warehouses.getById(clean.warehouseId)
        if (!warehouse || !warehouse.isActive) throw new ValidationError({ warehouseId: 'انبار انتخاب‌شده پیدا نشد یا غیرفعال است.' })
        const checked = await checkLines(r, clean.items)
        const invoiceDate = clean.invoiceDate ?? nowIso()
        const landedTotal = (clean.charges ?? []).reduce((a, c) => a + c.amount, 0)
        const prepared = prepareInvoice({ ...clean, items: checked.items }, undefined, {
          factorOf: checked.factorOf,
          landed: { total: landedTotal, method: clean.landedMethod ?? 'value' },
        })
        const result = await r.purchaseInvoices.insertPrepared({ ...clean, items: checked.items, invoiceDate }, prepared)
        const inventory = createInventoryService(tx)
        for (const line of prepared.lines) {
          await inventory.applyMovement(
            {
              productId: line.productId,
              warehouseId: clean.warehouseId,
              quantityDelta: line.quantity,
              movementType: 'purchase',
              documentType: 'purchase_invoice',
              documentId: prepared.id,
              documentLineId: line.id,
              occurredAt: invoiceDate,
            },
            { kind: 'lot', totalCost: line.lineTotal - line.invoiceDiscountShare + line.landedShare, lotDate: invoiceDate },
          )
        }
        const paid = resolvePaidAmount(input.paidAmount, prepared.total, supplier.isSystem, supplier.name)
        await recordInvoicePayment(tx, 'purchase', { id: prepared.id, partyId: supplier.id }, paid, invoiceDate)
        await claimRequestId(tx, 'purchase_invoices', prepared.id, input.requestId)
        return result
      })
    },

    /** ابطال کامل فاکتور با دلیل؛ اگر بخشی از کالای آن فروخته/مصرف شده باشد خطای فارسی «برگشت از خرید» */
    async cancel(id: string, reason?: string | null): Promise<void> {
      const why = cleanText(reason) || null
      if (why && why.length > MAX_REASON) throw new ValidationError({ reason: `دلیل ابطال نباید بیشتر از ${MAX_REASON} نویسه باشد.` })
      await db.transaction(async (tx) => {
        const r = createRepositories(tx)
        const invoice = await r.purchaseInvoices.getById(id)
        if (!invoice) throw new AppError('not_found', 'فاکتور خرید پیدا نشد.')
        if (invoice.status === 'cancelled') throw new AppError('immutable', 'این فاکتور قبلاً ابطال شده است.')
        const inventory = createInventoryService(tx)
        for (const item of await r.purchaseInvoices.getItems(id)) {
          const [original] = await r.stock.listMovements({ documentLineId: item.id })
          if (!original || original.movementType !== 'purchase') throw new AppError('integrity', 'حرکت انبار این فاکتور پیدا نشد.')
          await inventory.applyMovement(
            {
              productId: item.productId,
              warehouseId: invoice.warehouseId,
              quantityDelta: -item.quantity,
              movementType: 'purchase_cancel',
              documentType: 'purchase_invoice',
              documentId: id,
              documentLineId: item.id,
              note: why,
            },
            { kind: 'cancel_lot', lotMovementId: original.id },
          )
        }
        await r.purchaseInvoices.markCancelled(id, why, nowIso())
        await cancelAutoDocuments(tx, 'purchase', id, 'ابطال فاکتور')
      })
    },

    async list(filter: InvoiceListFilter = {}): Promise<PurchaseListRow[]> {
      const r = createRepositories(db)
      const suppliers = await r.suppliers.list({ includeInactive: true })
      const names = new Map(suppliers.map((s) => [s.id, s.name]))
      const search = cleanText(filter.search)
      const latin = toEnglishDigits(search).replace(/^#/, '')
      const base = { status: filter.status, from: filter.from, to: filter.to, limit: filter.limit, offset: filter.offset }
      const invoices = !search
        ? await r.purchaseInvoices.list(base)
        : /^\d{1,9}$/.test(latin)
          ? await r.purchaseInvoices.list({ ...base, invoiceNumber: Number(latin) })
          : await r.purchaseInvoices.list({ ...base, text: { reference: latin, partyIds: suppliers.filter((s) => s.name.includes(search)).map((s) => s.id) } })
      const counts = await r.purchaseInvoices.itemCounts(invoices.map((i) => i.id))
      const pay = await r.money.invoiceSettlements('purchase', invoices.filter((i) => i.status === 'active').map((i) => i.id))
      return invoices.map((invoice) => ({ invoice, supplierName: names.get(invoice.supplierId) ?? '—', itemCount: counts[invoice.id] ?? 0, payment: pay.get(invoice.id)?.status }))
    },

    async detail(id: string): Promise<PurchaseDetail | null> {
      const r = createRepositories(db)
      const invoice = await r.purchaseInvoices.getById(id)
      if (!invoice) return null
      const items = await r.purchaseInvoices.getItems(id)
      const withProducts = await Promise.all(
        items.map(async (it) => {
          const product = await r.products.getById(it.productId)
          return { ...it, product, netAmount: it.lineTotal - it.invoiceDiscountShare, unitName: product ? unitLabel(product, it.unitId) : '' }
        }),
      )
      return {
        invoice,
        supplier: await r.suppliers.getById(invoice.supplierId),
        warehouse: await r.warehouses.getById(invoice.warehouseId),
        items: withProducts,
        charges: await r.purchaseInvoices.getCharges(id),
      }
    },

    /** قیمت واحد آخرین خرید فعال این کالا (برای پیش‌فرض فرم خرید) */
    lastPurchasePrice: (productId: string) => createRepositories(db).purchaseInvoices.lastUnitPrice(productId),
  }
}
