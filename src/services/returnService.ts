import type { SqlExecutor } from '../database/types'
import type { ReturnLineInput } from '../models/returns'
import { createRepositories } from '../repositories'
import { AppError, ValidationError } from '../utils/errors'
import { newId } from '../utils/id'
import { mulDivRound } from '../utils/money'
import { cleanText } from '../validation/fields'
import { toBaseQuantity } from '../utils/invoiceMath'

/** تعداد برگشت به واحد ردیف (یا واحد پایه) → هزارم واحد پایه */
function resolveReturnQty(line: ReturnLineInput, src: { unitId: string | null; unitFactor: number }, idx: number) {
  const useSrcUnit = !!line.unitId && line.unitId === src.unitId
  const factor = useSrcUnit ? src.unitFactor : 1000
  if (line.unitId && !useSrcUnit && line.unitId !== 'base') throw new ValidationError({ [`lines.${idx}.unitId`]: 'واحد برگشت باید واحد ردیف فاکتور یا واحد اصلی کالا باشد.' })
  if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new ValidationError({ [`lines.${idx}.quantity`]: 'تعداد برگشت معتبر نیست.' })
  const base = toBaseQuantity(line.quantity, factor)
  if (base === null || base <= 0) throw new ValidationError({ [`lines.${idx}.quantity`]: 'تعداد برگشت به واحد اصلی بیش از سه رقم اعشار می‌شود.' })
  return { base, unitId: useSrcUnit ? src.unitId : null, unitFactor: factor, unitQuantity: line.quantity }
}
import { nowIso } from '../utils/time'
import { createInventoryService } from './inventoryService'
import { cancelAutoDocuments, recordReturnRefund } from './moneyService'

const MAX_REASON = 200

/**
 * برگشت فروش: کالا به انبار برمی‌گردد و لایه بها با بهای متناسب ردیف فروش ساخته می‌شود (FIFO-correct نسبت به بهای ذخیره‌شده).
 * برگشت خرید: خروج FIFO با ترجیح لایه همان خرید مبدأ.
 */
export function createReturnService(db: SqlExecutor) {
  return {
    async createSaleReturn(input: {
      salesInvoiceId: string
      lines: ReturnLineInput[]
      docDate?: string
      note?: string | null
    }) {
      if (!input.lines.length) throw new ValidationError({ lines: 'حداقل یک ردیف برای برگشت لازم است.' })
      return db.transaction(async (tx) => {
        const r = createRepositories(tx)
        const invoice = await r.salesInvoices.getById(input.salesInvoiceId)
        if (!invoice || invoice.status !== 'active') throw new AppError('validation', 'فاکتور فروش فعال پیدا نشد.')
        const items = await r.salesInvoices.getItems(invoice.id)
        const byId = new Map(items.map((i) => [i.id, i]))
        const docDate = input.docDate ?? nowIso()
        const returnId = newId()
        const returnNumber = await r.sequences.next('sale_return')
        const inventory = createInventoryService(tx)

        let total = 0
        const prepared: {
          id: string
          salesItemId: string
          productId: string
          quantity: number
          unitPrice: number
          unitId: string | null
          unitFactor: number
          unitQuantity: number
          lineTotal: number
          costs: { fifo: number; average: number; last: number }
        }[] = []

        for (const [idx, line] of input.lines.entries()) {
          const src = byId.get(line.sourceItemId)
          if (!src) throw new ValidationError({ [`lines.${idx}`]: 'ردیف فاکتور معتبر نیست.' })
          const u = resolveReturnQty(line, src, idx)
          const qty = u.base
          const already = await r.returns.returnedQtyForSalesItem(src.id)
          const left = src.quantity - already
          if (qty > left) {
            throw new ValidationError({
              [`lines.${idx}.quantity`]: `از این ردیف حداکثر می‌توانید ${left} هزارم‌واحد برگردانید.`,
            })
          }
          // بهای متناسب با بهای ذخیره‌شده روی ردیف فروش
          const costs = src.costs
            ? {
                fifo: mulDivRound(src.costs.fifo, qty, src.quantity),
                average: mulDivRound(src.costs.average, qty, src.quantity),
                last: mulDivRound(src.costs.last, qty, src.quantity),
              }
            : { fifo: 0, average: 0, last: 0 }
          // مبلغ برگشتی به مشتری = نسبت مبلغ خالص ردیف (پس از سهم تخفیف فاکتور)
          const netShare = mulDivRound(src.lineTotal - src.invoiceDiscountShare, qty, src.quantity)
          total += netShare
          const itemId = newId()
          prepared.push({
            id: itemId,
            salesItemId: src.id,
            productId: src.productId,
            quantity: qty,
            unitPrice: src.unitPrice,
            unitId: u.unitId,
            unitFactor: u.unitFactor,
            unitQuantity: u.unitQuantity,
            lineTotal: netShare,
            costs,
          })
        }

        await r.returns.insertSaleReturn({
          id: returnId,
          returnNumber,
          salesInvoiceId: invoice.id,
          warehouseId: invoice.warehouseId,
          docDate,
          totalAmount: total,
          note: cleanText(input.note) || null,
        })

        for (let i = 0; i < prepared.length; i++) {
          const p = prepared[i]!
          await inventory.applyMovement(
            {
              productId: p.productId,
              warehouseId: invoice.warehouseId,
              quantityDelta: p.quantity,
              movementType: 'sale_return',
              documentType: 'sales_invoice',
              documentId: returnId,
              documentLineId: p.id,
              occurredAt: docDate,
            },
            { kind: 'lot', totalCost: p.costs.fifo, lotDate: docDate },
          )
          await r.returns.insertSaleReturnItem({ ...p, returnId, lineNo: i + 1 })
        }
        await recordReturnRefund(tx, 'sales', { id: invoice.id, partyId: invoice.customerId }, returnId, docDate)
        return (await r.returns.getSaleReturn(returnId))!
      })
    },

    async createPurchaseReturn(input: {
      purchaseInvoiceId: string
      lines: ReturnLineInput[]
      docDate?: string
      note?: string | null
    }) {
      if (!input.lines.length) throw new ValidationError({ lines: 'حداقل یک ردیف برای برگشت لازم است.' })
      return db.transaction(async (tx) => {
        const r = createRepositories(tx)
        const invoice = await r.purchaseInvoices.getById(input.purchaseInvoiceId)
        if (!invoice || invoice.status !== 'active') throw new AppError('validation', 'فاکتور خرید فعال پیدا نشد.')
        const items = await r.purchaseInvoices.getItems(invoice.id)
        const byId = new Map(items.map((i) => [i.id, i]))
        const docDate = input.docDate ?? nowIso()
        const returnId = newId()
        const returnNumber = await r.sequences.next('purchase_return')
        const inventory = createInventoryService(tx)

        let total = 0
        const prepared: {
          id: string
          purchaseItemId: string
          productId: string
          quantity: number
          unitPrice: number
          unitId: string | null
          unitFactor: number
          unitQuantity: number
          lineTotal: number
          preferLotMovementId: string
        }[] = []

        for (const [idx, line] of input.lines.entries()) {
          const src = byId.get(line.sourceItemId)
          if (!src) throw new ValidationError({ [`lines.${idx}`]: 'ردیف فاکتور معتبر نیست.' })
          const u = resolveReturnQty(line, src, idx)
          const qty = u.base
          const already = await r.returns.returnedQtyForPurchaseItem(src.id)
          const left = src.quantity - already
          if (qty > left) {
            throw new ValidationError({
              [`lines.${idx}.quantity`]: `از این ردیف حداکثر می‌توانید ${left} هزارم‌واحد برگردانید.`,
            })
          }
          const [purchaseMove] = await r.stock.listMovements({ documentLineId: src.id })
          if (!purchaseMove || purchaseMove.movementType !== 'purchase') {
            throw new AppError('integrity', 'حرکت خرید این ردیف پیدا نشد.')
          }
          const netShare = mulDivRound(src.lineTotal - src.invoiceDiscountShare, qty, src.quantity)
          total += netShare
          prepared.push({
            id: newId(),
            purchaseItemId: src.id,
            productId: src.productId,
            quantity: qty,
            unitPrice: src.unitPrice,
            unitId: u.unitId,
            unitFactor: u.unitFactor,
            unitQuantity: u.unitQuantity,
            lineTotal: netShare,
            preferLotMovementId: purchaseMove.id,
          })
        }

        await r.returns.insertPurchaseReturn({
          id: returnId,
          returnNumber,
          purchaseInvoiceId: invoice.id,
          warehouseId: invoice.warehouseId,
          docDate,
          totalAmount: total,
          note: cleanText(input.note) || null,
        })

        for (let i = 0; i < prepared.length; i++) {
          const p = prepared[i]!
          const movement = await inventory.applyMovement(
            {
              productId: p.productId,
              warehouseId: invoice.warehouseId,
              quantityDelta: -p.quantity,
              movementType: 'purchase_return',
              documentType: 'purchase_invoice',
              documentId: returnId,
              documentLineId: p.id,
              occurredAt: docDate,
            },
            { kind: 'fifo', preferLotMovementId: p.preferLotMovementId },
          )
          await r.returns.insertPurchaseReturnItem({
            id: p.id,
            returnId,
            purchaseItemId: p.purchaseItemId,
            productId: p.productId,
            quantity: p.quantity,
            unitPrice: p.unitPrice,
            lineTotal: p.lineTotal,
            unitId: p.unitId,
            unitFactor: p.unitFactor,
            unitQuantity: p.unitQuantity,
            costs: movement.costs!,
            lineNo: i + 1,
          })
        }
        await recordReturnRefund(tx, 'purchase', { id: invoice.id, partyId: invoice.supplierId }, returnId, docDate)
        return (await r.returns.getPurchaseReturn(returnId))!
      })
    },

    listSaleReturns: (limit?: number) => createRepositories(db).returns.listSaleReturns(limit),
    listPurchaseReturns: (limit?: number) => createRepositories(db).returns.listPurchaseReturns(limit),

    async saleReturnDetail(id: string) {
      const r = createRepositories(db)
      const doc = await r.returns.getSaleReturn(id)
      if (!doc) return null
      const items = await r.returns.saleReturnItems(id)
      const withProducts = await Promise.all(items.map(async (it) => ({ ...it, product: await r.products.getById(it.productId) })))
      return { doc, items: withProducts, invoice: await r.salesInvoices.getById(doc.salesInvoiceId) }
    },

    async purchaseReturnDetail(id: string) {
      const r = createRepositories(db)
      const doc = await r.returns.getPurchaseReturn(id)
      if (!doc) return null
      const items = await r.returns.purchaseReturnItems(id)
      const withProducts = await Promise.all(items.map(async (it) => ({ ...it, product: await r.products.getById(it.productId) })))
      return { doc, items: withProducts, invoice: await r.purchaseInvoices.getById(doc.purchaseInvoiceId) }
    },

    /** مقادیر قابل برگشت هر ردیف فاکتور فروش */
    async saleReturnable(salesInvoiceId: string) {
      const r = createRepositories(db)
      const items = await r.salesInvoices.getItems(salesInvoiceId)
      return Promise.all(
        items.map(async (it) => {
          const returned = await r.returns.returnedQtyForSalesItem(it.id)
          return { item: it, returned, remaining: it.quantity - returned, product: await r.products.getById(it.productId) }
        }),
      )
    },

    async purchaseReturnable(purchaseInvoiceId: string) {
      const r = createRepositories(db)
      const items = await r.purchaseInvoices.getItems(purchaseInvoiceId)
      return Promise.all(
        items.map(async (it) => {
          const returned = await r.returns.returnedQtyForPurchaseItem(it.id)
          return { item: it, returned, remaining: it.quantity - returned, product: await r.products.getById(it.productId) }
        }),
      )
    },

    async cancelSaleReturn(id: string, reason?: string | null) {
      const why = cleanText(reason) || null
      if (why && why.length > MAX_REASON) throw new ValidationError({ reason: `دلیل ابطال نباید بیشتر از ${MAX_REASON} نویسه باشد.` })
      await db.transaction(async (tx) => {
        const r = createRepositories(tx)
        const doc = await r.returns.getSaleReturn(id)
        if (!doc) throw new AppError('not_found', 'برگشت فروش پیدا نشد.')
        if (doc.status === 'cancelled') throw new AppError('immutable', 'این برگشت قبلاً ابطال شده است.')
        const inventory = createInventoryService(tx)
        for (const item of await r.returns.saleReturnItems(id)) {
          const [original] = await r.stock.listMovements({ documentLineId: item.id })
          if (!original || original.movementType !== 'sale_return') throw new AppError('integrity', 'حرکت برگشت پیدا نشد.')
          // ابطال برگشت فروش = خروج دوباره با cancel_lot روی لایه ساخته‌شده
          await inventory.applyMovement(
            {
              productId: item.productId,
              warehouseId: doc.warehouseId,
              quantityDelta: -item.quantity,
              movementType: 'purchase_cancel', // reuse cancel_lot semantics (consume whole lot)
              documentType: 'sales_invoice',
              documentId: id,
              documentLineId: item.id,
              note: why,
            },
            { kind: 'cancel_lot', lotMovementId: original.id },
          )
        }
        await r.returns.markSaleReturnCancelled(id, why, nowIso())
        await cancelAutoDocuments(tx, 'sale_return', id, 'ابطال برگشت')
      })
    },
  }
}

export function createTransferService(db: SqlExecutor) {
  return {
    async create(input: {
      fromWarehouseId: string
      toWarehouseId: string
      lines: { productId: string; quantity: number }[]
      docDate?: string
      note?: string | null
    }) {
      if (input.fromWarehouseId === input.toWarehouseId) {
        throw new ValidationError({ toWarehouseId: 'انبار مبدأ و مقصد نباید یکی باشند.' })
      }
      if (!input.lines.length) throw new ValidationError({ lines: 'حداقل یک کالا برای انتقال لازم است.' })
      return db.transaction(async (tx) => {
        const r = createRepositories(tx)
        const from = await r.warehouses.getById(input.fromWarehouseId)
        const to = await r.warehouses.getById(input.toWarehouseId)
        if (!from || !from.isActive) throw new ValidationError({ fromWarehouseId: 'انبار مبدأ معتبر نیست.' })
        if (!to || !to.isActive) throw new ValidationError({ toWarehouseId: 'انبار مقصد معتبر نیست.' })
        const docDate = input.docDate ?? nowIso()
        const transferId = newId()
        const transferNumber = await r.sequences.next('transfer')
        const inventory = createInventoryService(tx)

        await r.returns.insertTransfer({
          id: transferId,
          transferNumber,
          fromWarehouseId: from.id,
          toWarehouseId: to.id,
          docDate,
          note: cleanText(input.note) || null,
        })

        for (let i = 0; i < input.lines.length; i++) {
          const line = input.lines[i]!
          if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
            throw new ValidationError({ [`lines.${i}.quantity`]: 'تعداد معتبر نیست.' })
          }
          const product = await r.products.getById(line.productId)
          if (!product || !product.isActive) throw new ValidationError({ [`lines.${i}.productId`]: 'کالا معتبر نیست.' })
          const itemId = newId()
          const out = await inventory.applyMovement({
            productId: line.productId,
            warehouseId: from.id,
            quantityDelta: -line.quantity,
            movementType: 'transfer_out',
            documentType: 'transfer',
            documentId: transferId,
            documentLineId: itemId,
            occurredAt: docDate,
          })
          const costs = out.costs!
          await inventory.applyMovement(
            {
              productId: line.productId,
              warehouseId: to.id,
              quantityDelta: line.quantity,
              movementType: 'transfer_in',
              documentType: 'transfer',
              documentId: transferId,
              documentLineId: itemId,
              occurredAt: docDate,
            },
            { kind: 'lot', totalCost: costs.fifo, lotDate: docDate },
          )
          await r.returns.insertTransferItem({
            id: itemId,
            transferId,
            productId: line.productId,
            quantity: line.quantity,
            costs,
            lineNo: i + 1,
          })
        }
        return (await r.returns.getTransfer(transferId))!
      })
    },

    list: (limit?: number) => createRepositories(db).returns.listTransfers(limit),

    async detail(id: string) {
      const r = createRepositories(db)
      const doc = await r.returns.getTransfer(id)
      if (!doc) return null
      const items = await r.returns.transferItems(id)
      const withProducts = await Promise.all(items.map(async (it) => ({ ...it, product: await r.products.getById(it.productId) })))
      return {
        doc,
        items: withProducts,
        from: await r.warehouses.getById(doc.fromWarehouseId),
        to: await r.warehouses.getById(doc.toWarehouseId),
      }
    },
  }
}
