export const THEME_PREFERENCES = ['system', 'dark', 'light'] as const
export type ThemePreference = (typeof THEME_PREFERENCES)[number]
export type ResolvedTheme = 'dark' | 'light'

/** روش محاسبه بهای تمام‌شده برای سود: FIFO (پیش‌فرض)، میانگین موزون متحرک، آخرین قیمت خرید */
export const COST_METHODS = ['fifo', 'average', 'last'] as const
export type CostMethod = (typeof COST_METHODS)[number]

/** پیشنهاد قیمت فروش در فاکتور: دستی (خالی)، آخرین قیمت فروش همین کالا (پیش‌فرض)، آخرین قیمت خرید + درصد سود */
export const SALE_PRICE_MODES = ['manual', 'last_sale', 'markup'] as const
export type SalePriceMode = (typeof SALE_PRICE_MODES)[number]

/** سقف درصد سود: ۱۰۰۰٪ (به صدم درصد) */
export const MAX_MARKUP_BP = 100_000

export interface AppSettings {
  theme: ThemePreference
  costMethod: CostMethod
  salePriceMode: SalePriceMode
  /** درصد سود سراسری به صدم درصد (۲۵٪ = ۲۵۰۰) */
  markupBp: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  costMethod: 'fifo',
  salePriceMode: 'last_sale',
  markupBp: 0,
}

/** هر مقدار نامعتبر یا خراب با مقدار پیش‌فرض جایگزین می‌شود */
export function sanitizeSettings(raw: unknown): AppSettings {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const markup = typeof obj.markupBp === 'number' ? obj.markupBp : Number(obj.markupBp)
  return {
    theme: THEME_PREFERENCES.find((t) => t === obj.theme) ?? DEFAULT_SETTINGS.theme,
    costMethod: COST_METHODS.find((m) => m === obj.costMethod) ?? DEFAULT_SETTINGS.costMethod,
    salePriceMode: SALE_PRICE_MODES.find((m) => m === obj.salePriceMode) ?? DEFAULT_SETTINGS.salePriceMode,
    markupBp: Number.isSafeInteger(markup) && markup >= 0 && markup <= MAX_MARKUP_BP ? markup : DEFAULT_SETTINGS.markupBp,
  }
}
