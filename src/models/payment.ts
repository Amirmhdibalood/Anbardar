import type { BaseEntity, IsoDateTime, Money } from './common'

/** دریافت (از مشتری) یا پرداخت (به تأمین‌کننده) بابت دقیقاً یک فاکتور */
export interface Payment extends BaseEntity {
  salesInvoiceId: string | null
  purchaseInvoiceId: string | null
  amount: Money
  paidAt: IsoDateTime
  note: string | null
}

export interface PaymentInput {
  salesInvoiceId?: string | null
  purchaseInvoiceId?: string | null
  amount: Money
  paidAt?: IsoDateTime
  note?: string | null
}
