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

export const CHEQUE_TONES: Record<ChequeStatus, 'warning' | 'success' | 'error' | 'accent'> = {
  pending: 'warning',
  cleared: 'success',
  bounced: 'error',
  spent: 'accent',
}

/** روزهای مانده تا سررسید بر اساس روز تقویمی محلی (منفی = گذشته) */
export function daysUntil(dueIso: string, now = new Date()): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const due = new Date(dueIso)
  const d = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime()
  return Math.round((d - start) / (24 * 3600 * 1000))
}
