import { DEFAULT_SETTINGS, type AppSettings } from '../models/settings'
import { logger } from '../utils/logger'
import { getApp } from './appContext'
import { THEME_CACHE_KEY } from './legacySettingsMigration'

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
  cacheTheme(next.theme)
  return next
}

/** کش تم در localStorage فقط برای جلوگیری از چشمک هنگام شروع است؛ مرجع اصلی دیتابیس است */
export function cacheTheme(theme: string): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, theme)
  } catch {
    /* بی‌اهمیت */
  }
}
