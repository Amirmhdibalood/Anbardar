import type { BaseEntity, IsoDateTime, Money } from './common'

export type MoneyKind = 'receipt' | 'payment' | 'opening_debit' | 'opening_credit'
export type MoneyMethod = 'cash' | 'card' | 'transfer' | 'cheque' | 'other'
export type MoneySource = 'manual' | 'sale' | 'purchase' | 'sale_return' | 'purchase_return'
export type MoneyStatus = 'active' | 'cancelled'

export const MONEY_KIND_LABELS: Record<MoneyKind, string> = {
  receipt: 'دریافت',
  payment: 'پرداخت',
  opening_debit: 'مانده اول دوره (بدهکار)',
  opening_credit: 'مانده اول دوره (بستانکار)',
}

export const MONEY_METHOD_LABELS: Record<MoneyMethod, string> = {
  cash: 'نقدی',
  card: 'کارتخوان',
  transfer: 'کارت‌به‌کارت / انتقال',
  cheque: 'چک',
  other: 'سایر',
}

/** اثر هر نوع سند روی مانده طرف حساب (مثبت = طرف به ما بدهکار است) */
export const MONEY_KIND_SIGN: Record<MoneyKind, 1 | -1> = { receipt: -1, payment: 1, opening_debit: 1, opening_credit: -1 }

/** دریافت، پرداخت یا مانده اول دوره؛ مثل فاکتور تغییرناپذیر است و فقط ابطال می‌شود */
export interface MoneyDocument extends BaseEntity {
  kind: MoneyKind
  docNumber: number
  partyId: string
  amount: Money
  docDate: IsoDateTime
  method: MoneyMethod | null
  note: string | null
  /** manual = ثبت دستی؛ بقیه = خودکار همراه فاکتور/برگشت (sourceId) */
  source: MoneySource
  sourceId: string | null
  requestId: string | null
  status: MoneyStatus
  cancelledAt: IsoDateTime | null
  cancelReason: string | null
}

export interface Settlement extends BaseEntity {
  documentId: string
  salesInvoiceId: string | null
  purchaseInvoiceId: string | null
  amount: Money
}

export type PaymentStatus = 'paid' | 'partial' | 'unpaid'

/** وضعیت پرداخت یک فاکتور (همیشه از اسناد محاسبه می‌شود) */
export interface InvoiceSettlement {
  invoiceId: string
  total: Money
  /** جمع برگشت‌های فعال */
  returned: Money
  /** تخصیص‌های فعال منهای استرداد خودکار برگشت‌ها */
  settled: Money
  /** total − returned − settled (هرگز منفی نمایش داده نمی‌شود) */
  remaining: Money
  status: PaymentStatus
}

export function paymentStatusOf(net: Money, settled: Money): PaymentStatus {
  if (net - settled <= 0) return 'paid'
  return settled > 0 ? 'partial' : 'unpaid'
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = { paid: 'تسویه', partial: 'بخشی پرداخت‌شده', unpaid: 'پرداخت‌نشده' }

export type LedgerEntryType = 'sale' | 'sale_return' | 'purchase' | 'purchase_return' | MoneyKind

export interface LedgerEntry {
  type: LedgerEntryType
  id: string
  number: number
  date: IsoDateTime
  /** اثر روی مانده (مثبت = بدهکارتر شدن طرف) */
  delta: Money
  status: MoneyStatus
  source: MoneySource | null
  note: string | null
  /** مانده بعد از این ردیف (فقط ردیف‌های فعال در آن اثر دارند) */
  balance: Money
}

export const LEDGER_TYPE_LABELS: Record<LedgerEntryType, string> = {
  sale: 'فاکتور فروش',
  sale_return: 'برگشت فروش',
  purchase: 'فاکتور خرید',
  purchase_return: 'برگشت خرید',
  ...MONEY_KIND_LABELS,
}

export interface PartyBalance {
  partyId: string
  balance: Money
}
