import type { Accent } from '../models/settings'

/**
 * قفل رنگ‌های ویژه — یک پرچم واحد. فعلاً false (همه قابل انتخاب، فقط نشان «ویژه»).
 * در مرحله ۶ (پرداخت Myket) true و با وضعیت خرید ترکیب می‌شود.
 */
export const PREMIUM_ACCENTS_LOCKED = false

/** رنگ‌های رایگان (برای هر دو حالت) */
export const FREE_ACCENTS: readonly Accent[] = ['purple']

export const ACCENT_META: Record<Accent, { label: string; dark: string; light: string }> = {
  purple: { label: 'بنفش', dark: '#8b5cf6', light: '#8b5cf6' },
  teal: { label: 'آبی نفتی', dark: '#14b8a6', light: '#0d9488' },
  emerald: { label: 'زمردی', dark: '#10b981', light: '#059669' },
  gold: { label: 'طلایی', dark: '#f59e0b', light: '#d97706' },
  crimson: { label: 'سرخابی', dark: '#e11d48', light: '#e11d48' },
}

export const isPremiumAccent = (a: Accent) => !FREE_ACCENTS.includes(a)
/** آیا انتخاب این رنگ (فعلاً) مجاز نیست؟ */
export const isAccentLocked = (a: Accent, purchased = false) => PREMIUM_ACCENTS_LOCKED && isPremiumAccent(a) && !purchased
