import type { BaseEntity } from './common'

interface PartyBase extends BaseEntity {
  name: string
  phone: string | null
  address: string | null
  description: string | null
}

export interface Customer extends PartyBase {
  /** «مشتری نقدی» پیش‌فرض: قابل حذف یا غیرفعال‌شدن نیست */
  isSystem: boolean
}

export interface Supplier extends PartyBase {
  /** «متفرقه» (خرید بدون تأمین‌کننده مشخص): قابل حذف یا غیرفعال‌شدن نیست */
  isSystem: boolean
}

/** شناسه ثابت تأمین‌کننده سیستمی «متفرقه» (Migration 003) */
export const MISC_SUPPLIER_ID = 'e4238491-7f1a-4f2e-95bd-1df38fa5a6e6'

export interface PartyInput {
  name: string
  phone?: string | null
  address?: string | null
  description?: string | null
}
