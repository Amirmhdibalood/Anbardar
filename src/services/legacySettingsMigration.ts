import { THEME_PREFERENCES, type ThemePreference } from '../models/settings'
import type { Repositories } from '../repositories'
import { logger } from '../utils/logger'

/** کلید تنظیمات Phase 1 که در localStorage بود */
export const LEGACY_SETTINGS_KEY = 'anbardar.settings.v1'
/** کش تم برای جلوگیری از چشمک در شروع برنامه (دیتابیس مرجع اصلی است؛ index.html همین کلید را می‌خواند) */
export const THEME_CACHE_KEY = 'anbardar.theme.v1'
const DONE_MARKER = 'legacy_settings_imported'

/**
 * انتقال یک‌باره تنظیمات قدیمی (تم) از localStorage به جدول settings.
 * بعد از موفقیت علامت می‌خورد و کلید قدیمی پاک می‌شود. «ریال» دیگر پشتیبانی نمی‌شود و نادیده گرفته می‌شود.
 */
export async function importLegacySettings(repos: Repositories): Promise<boolean> {
  if ((await repos.settings.getValue(DONE_MARKER)) === '1') return false
  let imported = false
  try {
    const raw = localStorage.getItem(LEGACY_SETTINGS_KEY)
    if (raw) {
      const theme = (JSON.parse(raw) as { theme?: unknown }).theme
      const valid = THEME_PREFERENCES.find((t): t is ThemePreference => t === theme)
      if (valid) {
        await repos.settings.setValue('theme', valid)
        imported = true
      }
    }
  } catch (error) {
    logger.warn('خواندن تنظیمات قدیمی ناموفق بود؛ نادیده گرفته شد', error)
  }
  await repos.settings.setValue(DONE_MARKER, '1')
  try {
    localStorage.removeItem(LEGACY_SETTINGS_KEY)
  } catch {
    /* بی‌اهمیت */
  }
  return imported
}
