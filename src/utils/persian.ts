const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'

/** تبدیل ارقام انگلیسی (و عربی) یک رشته یا عدد به ارقام فارسی */
export function toPersianDigits(value: string | number): string {
  return String(value)
    .replace(/[0-9]/g, (d) => PERSIAN_DIGITS.charAt(Number(d)))
    .replace(/[\u0660-\u0669]/g, (d) => PERSIAN_DIGITS.charAt(d.charCodeAt(0) - 0x0660))
}

/** تبدیل ارقام فارسی و عربی به انگلیسی (برای پردازش ورودی کاربر) */
export function toEnglishDigits(value: string): string {
  return value
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
}

/** عدد صحیح با جداکننده هزارگان و ارقام فارسی: 4520000 ← ۴,۵۲۰,۰۰۰ */
export function formatInteger(value: number): string {
  const sign = value < 0 ? '-' : ''
  const grouped = Math.abs(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return toPersianDigits(sign + grouped)
}

/**
 * تبدیل متن واردشده توسط کاربر به عدد صحیح.
 * ارقام فارسی/عربی و جداکننده هزارگان را می‌پذیرد؛ برای ورودی نامعتبر null برمی‌گرداند.
 */
export function parseIntegerInput(text: string): number | null {
  const cleaned = toEnglishDigits(text).replace(/[,\u066C\u060C\s]/g, '')
  if (!/^-?\d+$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isSafeInteger(n) ? n : null
}
