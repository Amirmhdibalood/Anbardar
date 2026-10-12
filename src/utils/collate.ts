/**
 * مرتب‌سازی فارسی. ترتیب پیش‌فرض SQLite بر اساس کد یونیکد است و حروفی مثل «ک، گ، پ، چ، ژ، ی» را جابه‌جا می‌چیند
 * (مثلاً «کابل» بعد از «هدفون» می‌آمد). به همین دلیل نام‌ها در لایه سرویس با Collator فارسی مرتب می‌شوند.
 * numeric: «کالا ۲» قبل از «کالا ۱۰».
 */
const collator = new Intl.Collator('fa', { numeric: true, sensitivity: 'base' })

export const compareFa = (a: string, b: string): number => collator.compare(a, b)

export function sortByName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareFa(a.name, b.name))
}
