import type { SqlExecutor } from '../database/types'
import type { InvoiceItem, InvoiceItemInput, SalesInvoice } from '../models/invoice'
import type { Product, Warehouse } from '../models/catalog'
import type { IsoDateTime } from '../models/common'
import type { Customer } from '../models/party'
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
import type { InvoiceListFilter } from './purchaseService'

export interface SaleInput {
  /** خالی = مشتری نقدی پیش‌فرض */
  customerId?: string | null
  warehouseId: string
  invoiceDate?: IsoDateTime
  reference?: string | null
  note?: string | null
  /** تخفیف کل فاکتور؛ از مبلغ دریافتی کم می‌شود */
  discount?: number
  /** مبلغ دریافتی هنگام ثبت؛ پیش‌فرض = کل فاکتور (فروش نقدی). کمتر از کل = نسیه (فقط برای مشتری با نام) */
  paidAmount?: number
  items: InvoiceItemInput[]
}

export interface SaleListRow {
  invoice: SalesInvoice
  customerName: string
  itemCount: number
  payment?: PaymentStatus
}

export interface SaleDetail {
  invoice: SalesInvoice
  customer: Customer | null
  warehouse: Warehouse | null
  items: (InvoiceItem & { product: Product | null; netAmount: number; unitName: string })[]
}

const MAX_REASON = 200

/**
 * فروش: هر ردیف = حرکت «فروش» با برداشت FIFO از لایه‌ها و ذخیره بهای هر سه روش روی حرکت و ردیف فاکتور،
 * به‌علاوه یک دریافت نقدی به مبلغ کل فاکتور (نسخه اول بدون بدهی). همه در یک تراکنش.
 */
export function createSaleService(db: SqlExecutor) {
  return {
    async create(input: SaleInput): Promise<InvoiceWithItems<SalesInvoice>> {
      return db.transaction(async (tx) => {
        const r = createRepositories(tx)
        const defaultCustomerId = (await r.settings.getValue('default_customer_id')) ?? ''
        const clean = validateInvoice({ ...input, partyId: input.customerId || defaultCustomerId, reference: input.reference ? toEnglishDigits(input.reference) : input.reference }, 'مشتری')
        const customer = await r.customers.getById(clean.partyId)
        if (!customer || !customer.isActive) throw new ValidationError({ partyId: 'مشتری انتخاب‌شده پیدا نشد یا غیرفعال است.' })
        const warehouse = await r.warehouses.getById(clean.warehouseId)
        if (!warehouse || !warehouse.isActive) throw new ValidationError({ warehouseId: 'انبار انتخاب‌شده پیدا نشد یا غیرفعال است.' })
        if (clean.items.some((it) => it.priceMode === 'total')) throw new ValidationError({ items: 'در فروش فقط «قیمت واحد» مجاز است.' })
        const checked = await checkLines(r, clean.items)

        const invoiceDate = clean.invoiceDate ?? nowIso()
        const prepared = prepareInvoice({ ...clean, items: checked.items }, undefined, { factorOf: checked.factorOf })
        const inventory = createInventoryService(tx)

        // اول حرکت‌ها و تخصیص لایه‌ها تا بهای هر ردیف معلوم شود، بعد سربرگ با همان شناسه‌ها
        const lineCosts = []
        for (const line of prepared.lines) {
          const movement = await inventory.applyMovement({
            productId: line.productId,
            warehouseId: clean.warehouseId,
            quantityDelta: -line.quantity,
            movementType: 'sale',
            documentType: 'sales_invoice',
            documentId: prepared.id,
            documentLineId: line.id,
            occurredAt: invoiceDate,
          })
          lineCosts.push(movement.costs!)
        }
        for (let i = 0; i < prepared.lines.length; i++) prepared.lines[i]!.costs = lineCosts[i]!

        const result = await r.salesInvoices.insertPrepared({ ...clean, items: checked.items, invoiceDate }, prepared)
        const paid = resolvePaidAmount(input.paidAmount, prepared.total, customer.isSystem, customer.name)
        await recordInvoicePayment(tx, 'sales', { id: prepared.id, partyId: customer.id }, paid, invoiceDate)
        return result
      })
    },

    async cancel(id: string, reason?: string | null): Promise<void> {
      const why = cleanText(reason) || null
      if (why && why.length > MAX_REASON) throw new ValidationError({ reason: `دلیل ابطال نباید بیشتر از ${MAX_REASON} نویسه باشد.` })
      await db.transaction(async (tx) => {
        const r = createRepositories(tx)
        const invoice = await r.salesInvoices.getById(id)
        if (!invoice) throw new AppError('not_found', 'فاکتور فروش پیدا نشد.')
        if (invoice.status === 'cancelled') throw new AppError('immutable', 'این فاکتور قبلاً ابطال شده است.')
        if (await tx.get("SELECT 1 AS x FROM sale_returns WHERE sales_invoice_id = ? AND status = 'active'", [id])) {
          throw new AppError('protected', 'برای این فاکتور برگشت فروش ثبت شده است. اول برگشت را ابطال کنید، بعد فاکتور را.')
        }
        const inventory = createInventoryService(tx)
        for (const item of await r.salesInvoices.getItems(id)) {
          const [original] = await r.stock.listMovements({ documentLineId: item.id })
          if (!original || original.movementType !== 'sale') throw new AppError('integrity', 'حرکت انبار این فاکتور پیدا نشد.')
          await inventory.applyMovement(
            {
              productId: item.productId,
              warehouseId: invoice.warehouseId,
              quantityDelta: item.quantity,
              movementType: 'sale_cancel',
              documentType: 'sales_invoice',
              documentId: id,
              documentLineId: item.id,
              note: why,
            },
            { kind: 'reverse', originalMovementId: original.id },
          )
        }
        await r.salesInvoices.markCancelled(id, why, nowIso())
        // دریافت خودکار همراه فاکتور هم باطل می‌شود؛ دریافت دستی به «علی‌الحساب» برمی‌گردد
        await cancelAutoDocuments(tx, 'sale', id, 'ابطال فاکتور')
      })
    },

    async list(filter: InvoiceListFilter = {}): Promise<SaleListRow[]> {
      const r = createRepositories(db)
      const customers = await r.customers.list({ includeInactive: true })
      const names = new Map(customers.map((c) => [c.id, c.name]))
      const search = cleanText(filter.search)
      const latin = toEnglishDigits(search).replace(/^#/, '')
      const base = { status: filter.status, from: filter.from, to: filter.to, limit: filter.limit, offset: filter.offset }
      const invoices = !search
        ? await r.salesInvoices.list(base)
        : /^\d{1,9}$/.test(latin)
          ? await r.salesInvoices.list({ ...base, invoiceNumber: Number(latin) })
          : await r.salesInvoices.list({ ...base, text: { reference: latin, partyIds: customers.filter((c) => c.name.includes(search)).map((c) => c.id) } })
      const counts = await r.salesInvoices.itemCounts(invoices.map((i) => i.id))
      const pay = await r.money.invoiceSettlements('sales', invoices.filter((i) => i.status === 'active').map((i) => i.id))
      return invoices.map((invoice) => ({ invoice, customerName: names.get(invoice.customerId) ?? '—', itemCount: counts[invoice.id] ?? 0, payment: pay.get(invoice.id)?.status }))
    },

    async detail(id: string): Promise<SaleDetail | null> {
      const r = createRepositories(db)
      const invoice = await r.salesInvoices.getById(id)
      if (!invoice) return null
      const items = await r.salesInvoices.getItems(id)
      const withProducts = await Promise.all(
        items.map(async (it) => {
          const product = await r.products.getById(it.productId)
          return { ...it, product, netAmount: it.lineTotal - it.invoiceDiscountShare, unitName: product ? unitLabel(product, it.unitId) : '' }
        }),
      )
      return { invoice, customer: await r.customers.getById(invoice.customerId), warehouse: await r.warehouses.getById(invoice.warehouseId), items: withProducts }
    },

    lastSalePrice: (productId: string) => createRepositories(db).salesInvoices.lastUnitPrice(productId),

    /** جمع مبلغ فاکتورهای فروش فعال در بازه (برای کارت صفحه اصلی) */
    async totalActive(from?: IsoDateTime, to?: IsoDateTime): Promise<number> {
      const list = await createRepositories(db).salesInvoices.list({ status: 'active', from, to })
      return list.reduce((s, i) => s + i.totalAmount, 0)
    },
  }
}
