import { DEFAULT_SETTINGS, type AppSettings } from '../models/settings'
import { logger } from '../utils/logger'
import { getApp } from './appContext'
import { ACCENT_CACHE_KEY, THEME_CACHE_KEY } from './legacySettingsMigration'

export async function loadSettings(): Promise<AppSettings> {
  try {
    return await getApp().repos.settings.load()
  } catch (error) {
    logger.error('بارگذاری تنظیمات ناموفق بود', error)
    return { ...DEFAULT_SETTINGS }
  }
}

/** تغییر بخشی از تنظیمات و ذخیره آن در دیتابیس؛ تنظیمات جدید را برمی‌گرداند */
export async function updateSettings(current: AppSettings, patch: Partial<AppSettings>): Promise<AppSettings> {
  const next: AppSettings = { ...current, ...patch }
  await getApp().repos.settings.save(next)
  cacheTheme(next)
  return next
}

/** کش تم در localStorage فقط برای جلوگیری از چشمک هنگام شروع است؛ مرجع اصلی دیتابیس است */
export function cacheTheme(settings: Pick<AppSettings, 'theme' | 'accentDark' | 'accentLight' | 'font'>): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, settings.theme)
    localStorage.setItem(ACCENT_CACHE_KEY, JSON.stringify({ dark: settings.accentDark, light: settings.accentLight, font: settings.font }))
  } catch {
    /* بی‌اهمیت */
  }
}
