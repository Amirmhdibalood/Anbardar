/**
 * ثبت خطاها فقط برای توسعه‌دهنده (کنسول).
 * جزئیات فنی هرگز به کاربر نمایش داده نمی‌شود. در فازهای بعد می‌تواند به لاگ محلی دیتابیس وصل شود.
 */
export const logger = {
  error(context: string, error: unknown): void {
    console.error(`[انباردار] ${context}`, error)
  },
  warn(context: string, detail?: unknown): void {
    console.warn(`[انباردار] ${context}`, detail)
  },
}
