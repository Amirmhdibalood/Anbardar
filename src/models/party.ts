import type { BaseEntity } from './common'

export type PartyRole = 'customer' | 'supplier'

/** طرف حساب واحد: می‌تواند مشتری، تأمین‌کننده یا هر دو باشد (Migration 006) */
export interface Party extends BaseEntity {
  name: string
  phone: string | null
  address: string | null
  description: string | null
  isCustomer: boolean
  isSupplier: boolean
  /** «مشتری نقدی» و «متفرقه»: قابل حذف، غیرفعال‌شدن یا تغییر نقش نیستند */
  isSystem: boolean
}

/** سازگاری با کد قبلی: مشتری و تأمین‌کننده همان طرف حساب با نقش مربوط‌اند */
export type Customer = Party
export type Supplier = Party

/** شناسه ثابت تأمین‌کننده سیستمی «متفرقه» (Migration 003) */
export const MISC_SUPPLIER_ID = 'e4238491-7f1a-4f2e-95bd-1df38fa5a6e6'

export interface PartyInput {
  name: string
  phone?: string | null
  address?: string | null
  description?: string | null
  /** فقط برای طرف حساب واحد؛ مخزن مشتری/تأمین‌کننده نقش خودش را می‌گذارد */
  isCustomer?: boolean
  isSupplier?: boolean
}

export function partyRoleLabel(p: Pick<Party, 'isCustomer' | 'isSupplier'>): string {
  if (p.isCustomer && p.isSupplier) return 'مشتری و تأمین‌کننده'
  return p.isCustomer ? 'مشتری' : 'تأمین‌کننده'
}
