import { toPersianDigits } from './persian'

/** تاریخ شمسی کامل با نام روز، مثال: «شنبه ۱۲ مهر ۱۴۰۵». تاریخ‌ها در دیتابیس میلادی/ISO ذخیره می‌شوند. */
export function formatPersianDate(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return toPersianDigits(`${get('weekday')} ${get('day')} ${get('month')} ${get('year')}`)
}

/** تاریخ و ساعت کوتاه شمسی برای فهرست‌ها: «۱۴ مهر ۱۴۰۵، ۱۰:۳۰» */
export function formatPersianDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return toPersianDigits(`${get('day')} ${get('month')} ${get('year')}، ${get('hour')}:${get('minute')}`)
}
