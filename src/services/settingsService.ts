import { DEFAULT_SETTINGS, type AppSettings } from '../models/settings'
import { logger } from '../utils/logger'
import { createRepositories } from '../repositories'
import { getApp } from './appContext'
import { authorize, writeAudit } from './authz'

const APPEARANCE_KEYS: readonly (keyof AppSettings)[] = ['theme', 'accentDark', 'accentLight', 'font']
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
  // ظاهر (تم، رنگ، فونت) برای همه آزاد است؛ بقیه تنظیمات فقط با مجوز settings.manage
  const changed = (Object.keys(patch) as (keyof AppSettings)[]).filter((k) => patch[k] !== current[k])
  const sensitive = changed.filter((k) => !APPEARANCE_KEYS.includes(k))
  await getApp().db.transaction(async (tx) => {
    const actor = sensitive.length ? await authorize(tx, 'settings.manage') : null
    await createRepositories(tx).settings.save(next)
    if (actor) await writeAudit(tx, actor, { action: 'settings.update', entityType: 'settings', summary: `تغییر تنظیمات: ${sensitive.join('، ')}` })
  })
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
