import type { BaseEntity, IsoDateTime, Money } from './common'
import type { MovementCosts } from './stock'
import type { Quantity } from '../utils/quantity'

export type ReturnStatus = 'active' | 'cancelled'

interface ReturnDocBase extends BaseEntity {
  returnNumber: number
  warehouseId: string
  docDate: IsoDateTime
  totalAmount: Money
  status: ReturnStatus
  cancelledAt: IsoDateTime | null
  cancelReason: string | null
  note: string | null
}

export interface SaleReturn extends ReturnDocBase {
  salesInvoiceId: string
}

export interface PurchaseReturn extends ReturnDocBase {
  purchaseInvoiceId: string
}

export interface SaleReturnItem extends BaseEntity {
  returnId: string
  salesItemId: string
  productId: string
  quantity: Quantity
  unitPrice: Money
  lineTotal: Money
  costs: MovementCosts
  lineNo: number
}

export interface PurchaseReturnItem extends BaseEntity {
  returnId: string
  purchaseItemId: string
  productId: string
  quantity: Quantity
  unitPrice: Money
  lineTotal: Money
  costs: MovementCosts
  lineNo: number
}

export interface WarehouseTransfer extends BaseEntity {
  transferNumber: number
  fromWarehouseId: string
  toWarehouseId: string
  docDate: IsoDateTime
  status: ReturnStatus
  cancelledAt: IsoDateTime | null
  cancelReason: string | null
  note: string | null
}

export interface WarehouseTransferItem extends BaseEntity {
  transferId: string
  productId: string
  quantity: Quantity
  costs: MovementCosts
  lineNo: number
}

export interface ReturnLineInput {
  /** شناسه ردیف فاکتور اصلی */
  sourceItemId: string
  /** تعداد به واحد unitId (خالی یا 'base' = واحد اصلی کالا) */
  quantity: Quantity
  /** همان واحد ردیف فاکتور، یا خالی برای واحد اصلی */
  unitId?: string | null
}

export interface TransferLineInput {
  productId: string
  quantity: Quantity
}
