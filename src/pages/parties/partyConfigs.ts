import type { IconName } from '../../components/Icon'

export interface PartyPageConfig {
  kind: 'customers' | 'suppliers'
  title: string
  label: 'مشتری' | 'تأمین‌کننده'
  icon: IconName
  emptyTitle: string
  emptyDescription: string
  systemNote: string
}

export const SUPPLIERS_CONFIG: PartyPageConfig = {
  kind: 'suppliers',
  title: 'تأمین‌کنندگان',
  label: 'تأمین‌کننده',
  icon: 'briefcase',
  emptyTitle: 'هنوز تأمین‌کننده‌ای ثبت نشده',
  emptyDescription: 'فروشندگانی که از آن‌ها کالا می‌خرید را اینجا ثبت می‌کنید.',
  systemNote: '«متفرقه» برای خریدهایی است که فروشنده مشخصی ندارند؛ حذف یا غیرفعال نمی‌شود ولی می‌توانید نامش را عوض کنید.',
}

export const CUSTOMERS_CONFIG: PartyPageConfig = {
  kind: 'customers',
  title: 'مشتریان',
  label: 'مشتری',
  icon: 'users',
  emptyTitle: 'هنوز مشتری ثبت نشده',
  emptyDescription: 'مشتریان خود را اینجا ثبت می‌کنید. برای فروش سریع، «مشتری نقدی» همیشه آماده است.',
  systemNote: '«مشتری نقدی» برای فروش سریع بدون نام است؛ حذف یا غیرفعال نمی‌شود ولی می‌توانید نامش را عوض کنید.',
}

