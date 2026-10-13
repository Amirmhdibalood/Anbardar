import type { IsoDateTime, Money } from './common'

export type ChequeDirection = 'received' | 'issued'
export type ChequeStatus = 'pending' | 'cleared' | 'bounced' | 'spent'

export const CHEQUE_STATUS_LABELS: Record<ChequeStatus, string> = {
  pending: 'در جریان',
  cleared: 'وصول',
  bounced: 'برگشتی',
  spent: 'خرج‌شده',
}

export const CHEQUE_DIRECTION_LABELS: Record<ChequeDirection, string> = {
  received: 'دریافتی',
  issued: 'پرداختی',
}

export interface ChequeInput {
  number: string
  bank: string
  /** سررسید (ISO) */
  dueDate: IsoDateTime
}

export interface Cheque {
  id: string
  documentId: string
  direction: ChequeDirection
  number: string
  bank: string
  dueDate: IsoDateTime
  status: ChequeStatus
  spentDocumentId: string | null
  statusAt: IsoDateTime | null
  note: string | null
  createdAt: IsoDateTime
}

/** چک با اطلاعات سند و طرف حساب برای فهرست */
export interface ChequeRow extends Cheque {
  amount: Money
  partyId: string
  partyName: string
  documentNumber: number
  documentStatus: 'active' | 'cancelled'
  /** طرفی که چک دریافتی به او خرج شده */
  spentToName: string | null
}
