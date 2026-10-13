import type { SqlExecutor, SqlRow } from '../../database/types'
import type {
  PurchaseReturn,
  PurchaseReturnItem,
  SaleReturn,
  SaleReturnItem,
  WarehouseTransfer,
  WarehouseTransferItem,
} from '../../models/returns'
import type { MovementCosts } from '../../models/stock'
import { nowIso } from '../../utils/time'
import { baseFromRow, insertSql, notFound, num, str, strOrNull } from './helpers'

function costsFrom(r: SqlRow): MovementCosts {
  return { fifo: num(r, 'cost_fifo'), average: num(r, 'cost_average'), last: num(r, 'cost_last') }
}

function mapSaleReturn(r: SqlRow): SaleReturn {
  return {
    ...baseFromRow(r),
    returnNumber: num(r, 'return_number'),
    salesInvoiceId: str(r, 'sales_invoice_id'),
    warehouseId: str(r, 'warehouse_id'),
    docDate: str(r, 'doc_date'),
    totalAmount: num(r, 'total_amount'),
    status: str(r, 'status') as SaleReturn['status'],
    cancelledAt: strOrNull(r, 'cancelled_at'),
    cancelReason: strOrNull(r, 'cancel_reason'),
    note: strOrNull(r, 'note'),
  }
}

function mapPurchaseReturn(r: SqlRow): PurchaseReturn {
  return {
    ...baseFromRow(r),
    returnNumber: num(r, 'return_number'),
    purchaseInvoiceId: str(r, 'purchase_invoice_id'),
    warehouseId: str(r, 'warehouse_id'),
    docDate: str(r, 'doc_date'),
    totalAmount: num(r, 'total_amount'),
    status: str(r, 'status') as PurchaseReturn['status'],
    cancelledAt: strOrNull(r, 'cancelled_at'),
    cancelReason: strOrNull(r, 'cancel_reason'),
    note: strOrNull(r, 'note'),
  }
}

function mapTransfer(r: SqlRow): WarehouseTransfer {
  return {
    ...baseFromRow(r),
    transferNumber: num(r, 'transfer_number'),
    fromWarehouseId: str(r, 'from_warehouse_id'),
    toWarehouseId: str(r, 'to_warehouse_id'),
    docDate: str(r, 'doc_date'),
    status: str(r, 'status') as WarehouseTransfer['status'],
    cancelledAt: strOrNull(r, 'cancelled_at'),
    cancelReason: strOrNull(r, 'cancel_reason'),
    note: strOrNull(r, 'note'),
  }
}

function mapSaleReturnItem(r: SqlRow): SaleReturnItem {
  return {
    ...baseFromRow(r),
    returnId: str(r, 'return_id'),
    salesItemId: str(r, 'sales_item_id'),
    productId: str(r, 'product_id'),
    quantity: num(r, 'quantity'),
    unitPrice: num(r, 'unit_price'),
    lineTotal: num(r, 'line_total'),
    costs: costsFrom(r),
    lineNo: num(r, 'line_no'),
  }
}

function mapPurchaseReturnItem(r: SqlRow): PurchaseReturnItem {
  return {
    ...baseFromRow(r),
    returnId: str(r, 'return_id'),
    purchaseItemId: str(r, 'purchase_item_id'),
    productId: str(r, 'product_id'),
    quantity: num(r, 'quantity'),
    unitPrice: num(r, 'unit_price'),
    lineTotal: num(r, 'line_total'),
    costs: costsFrom(r),
    lineNo: num(r, 'line_no'),
  }
}

function mapTransferItem(r: SqlRow): WarehouseTransferItem {
  return {
    ...baseFromRow(r),
    transferId: str(r, 'transfer_id'),
    productId: str(r, 'product_id'),
    quantity: num(r, 'quantity'),
    costs: costsFrom(r),
    lineNo: num(r, 'line_no'),
  }
}

export class SqliteReturnsRepository {
  constructor(private readonly db: SqlExecutor) {}

  // ---- sale returns
  async insertSaleReturn(row: {
    id: string
    returnNumber: number
    salesInvoiceId: string
    warehouseId: string
    docDate: string
    totalAmount: number
    note: string | null
  }): Promise<SaleReturn> {
    const now = nowIso()
    const { sql, params } = insertSql('sale_returns', {
      id: row.id,
      return_number: row.returnNumber,
      sales_invoice_id: row.salesInvoiceId,
      warehouse_id: row.warehouseId,
      doc_date: row.docDate,
      total_amount: row.totalAmount,
      status: 'active',
      note: row.note,
      created_at: now,
      updated_at: now,
      is_active: 1,
      created_by: null,
    })
    await this.db.run(sql, params)
    return (await this.getSaleReturn(row.id))!
  }

  async insertSaleReturnItem(row: {
    id: string
    returnId: string
    salesItemId: string
    productId: string
    quantity: number
    unitPrice: number
    lineTotal: number
    costs: MovementCosts
    lineNo: number
    unitId?: string | null
    unitFactor?: number
    unitQuantity?: number
  }): Promise<void> {
    const now = nowIso()
    const { sql, params } = insertSql('sale_return_items', {
      id: row.id,
      return_id: row.returnId,
      sales_item_id: row.salesItemId,
      product_id: row.productId,
      quantity: row.quantity,
      unit_price: row.unitPrice,
      line_total: row.lineTotal,
      unit_id: row.unitId ?? null,
      unit_factor: row.unitFactor ?? 1000,
      unit_quantity: row.unitQuantity ?? null,
      cost_fifo: row.costs.fifo,
      cost_average: row.costs.average,
      cost_last: row.costs.last,
      line_no: row.lineNo,
      created_at: now,
      updated_at: now,
      is_active: 1,
      created_by: null,
    })
    await this.db.run(sql, params)
  }

  async getSaleReturn(id: string): Promise<SaleReturn | null> {
    const row = await this.db.get('SELECT * FROM sale_returns WHERE id = ?', [id])
    return row ? mapSaleReturn(row) : null
  }

  async listSaleReturns(limit = 100): Promise<SaleReturn[]> {
    const rows = await this.db.all('SELECT * FROM sale_returns ORDER BY doc_date DESC, return_number DESC LIMIT ?', [limit])
    return rows.map(mapSaleReturn)
  }

  async saleReturnItems(returnId: string): Promise<SaleReturnItem[]> {
    const rows = await this.db.all('SELECT * FROM sale_return_items WHERE return_id = ? ORDER BY line_no', [returnId])
    return rows.map(mapSaleReturnItem)
  }

  /** جمع تعداد برگشتی فعال برای یک ردیف فاکتور فروش */
  async returnedQtyForSalesItem(salesItemId: string): Promise<number> {
    const row = await this.db.get<{ n: number }>(
      `SELECT COALESCE(SUM(i.quantity), 0) AS n FROM sale_return_items i
       JOIN sale_returns r ON r.id = i.return_id
       WHERE i.sales_item_id = ? AND r.status = 'active'`,
      [salesItemId],
    )
    return Number(row?.n ?? 0)
  }

  async markSaleReturnCancelled(id: string, reason: string | null, at: string): Promise<void> {
    const result = await this.db.run(
      `UPDATE sale_returns SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ? AND status = 'active'`,
      [at, reason, nowIso(), id],
    )
    if (result.changes === 0) throw notFound('برگشت فروش')
  }

  // ---- purchase returns
  async insertPurchaseReturn(row: {
    id: string
    returnNumber: number
    purchaseInvoiceId: string
    warehouseId: string
    docDate: string
    totalAmount: number
    note: string | null
  }): Promise<PurchaseReturn> {
    const now = nowIso()
    const { sql, params } = insertSql('purchase_returns', {
      id: row.id,
      return_number: row.returnNumber,
      purchase_invoice_id: row.purchaseInvoiceId,
      warehouse_id: row.warehouseId,
      doc_date: row.docDate,
      total_amount: row.totalAmount,
      status: 'active',
      note: row.note,
      created_at: now,
      updated_at: now,
      is_active: 1,
      created_by: null,
    })
    await this.db.run(sql, params)
    return (await this.getPurchaseReturn(row.id))!
  }

  async insertPurchaseReturnItem(row: {
    id: string
    returnId: string
    purchaseItemId: string
    productId: string
    quantity: number
    unitPrice: number
    lineTotal: number
    costs: MovementCosts
    lineNo: number
    unitId?: string | null
    unitFactor?: number
    unitQuantity?: number
  }): Promise<void> {
    const now = nowIso()
    const { sql, params } = insertSql('purchase_return_items', {
      id: row.id,
      return_id: row.returnId,
      purchase_item_id: row.purchaseItemId,
      product_id: row.productId,
      quantity: row.quantity,
      unit_price: row.unitPrice,
      line_total: row.lineTotal,
      unit_id: row.unitId ?? null,
      unit_factor: row.unitFactor ?? 1000,
      unit_quantity: row.unitQuantity ?? null,
      cost_fifo: row.costs.fifo,
      cost_average: row.costs.average,
      cost_last: row.costs.last,
      line_no: row.lineNo,
      created_at: now,
      updated_at: now,
      is_active: 1,
      created_by: null,
    })
    await this.db.run(sql, params)
  }

  async getPurchaseReturn(id: string): Promise<PurchaseReturn | null> {
    const row = await this.db.get('SELECT * FROM purchase_returns WHERE id = ?', [id])
    return row ? mapPurchaseReturn(row) : null
  }

  async listPurchaseReturns(limit = 100): Promise<PurchaseReturn[]> {
    const rows = await this.db.all('SELECT * FROM purchase_returns ORDER BY doc_date DESC, return_number DESC LIMIT ?', [limit])
    return rows.map(mapPurchaseReturn)
  }

  async purchaseReturnItems(returnId: string): Promise<PurchaseReturnItem[]> {
    const rows = await this.db.all('SELECT * FROM purchase_return_items WHERE return_id = ? ORDER BY line_no', [returnId])
    return rows.map(mapPurchaseReturnItem)
  }

  async returnedQtyForPurchaseItem(purchaseItemId: string): Promise<number> {
    const row = await this.db.get<{ n: number }>(
      `SELECT COALESCE(SUM(i.quantity), 0) AS n FROM purchase_return_items i
       JOIN purchase_returns r ON r.id = i.return_id
       WHERE i.purchase_item_id = ? AND r.status = 'active'`,
      [purchaseItemId],
    )
    return Number(row?.n ?? 0)
  }

  async markPurchaseReturnCancelled(id: string, reason: string | null, at: string): Promise<void> {
    const result = await this.db.run(
      `UPDATE purchase_returns SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ? AND status = 'active'`,
      [at, reason, nowIso(), id],
    )
    if (result.changes === 0) throw notFound('برگشت خرید')
  }

  // ---- transfers
  async insertTransfer(row: {
    id: string
    transferNumber: number
    fromWarehouseId: string
    toWarehouseId: string
    docDate: string
    note: string | null
  }): Promise<WarehouseTransfer> {
    const now = nowIso()
    const { sql, params } = insertSql('warehouse_transfers', {
      id: row.id,
      transfer_number: row.transferNumber,
      from_warehouse_id: row.fromWarehouseId,
      to_warehouse_id: row.toWarehouseId,
      doc_date: row.docDate,
      status: 'active',
      note: row.note,
      created_at: now,
      updated_at: now,
      is_active: 1,
      created_by: null,
    })
    await this.db.run(sql, params)
    return (await this.getTransfer(row.id))!
  }

  async insertTransferItem(row: {
    id: string
    transferId: string
    productId: string
    quantity: number
    costs: MovementCosts
    lineNo: number
  }): Promise<void> {
    const now = nowIso()
    const { sql, params } = insertSql('warehouse_transfer_items', {
      id: row.id,
      transfer_id: row.transferId,
      product_id: row.productId,
      quantity: row.quantity,
      cost_fifo: row.costs.fifo,
      cost_average: row.costs.average,
      cost_last: row.costs.last,
      line_no: row.lineNo,
      created_at: now,
      updated_at: now,
      is_active: 1,
      created_by: null,
    })
    await this.db.run(sql, params)
  }

  async getTransfer(id: string): Promise<WarehouseTransfer | null> {
    const row = await this.db.get('SELECT * FROM warehouse_transfers WHERE id = ?', [id])
    return row ? mapTransfer(row) : null
  }

  async listTransfers(limit = 100): Promise<WarehouseTransfer[]> {
    const rows = await this.db.all('SELECT * FROM warehouse_transfers ORDER BY doc_date DESC, transfer_number DESC LIMIT ?', [limit])
    return rows.map(mapTransfer)
  }

  async transferItems(transferId: string): Promise<WarehouseTransferItem[]> {
    const rows = await this.db.all('SELECT * FROM warehouse_transfer_items WHERE transfer_id = ? ORDER BY line_no', [transferId])
    return rows.map(mapTransferItem)
  }

  async markTransferCancelled(id: string, reason: string | null, at: string): Promise<void> {
    const result = await this.db.run(
      `UPDATE warehouse_transfers SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ? AND status = 'active'`,
      [at, reason, nowIso(), id],
    )
    if (result.changes === 0) throw notFound('انتقال')
  }
}

