import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'
import type { ResolvedTheme, ThemePreference } from '../models/settings'
import { logger } from '../utils/logger'

const THEME_COLORS: Record<ResolvedTheme, string> = { dark: '#0F0F14', light: '#F6F6FA' }

function systemQuery(): MediaQueryList {
  return window.matchMedia('(prefers-color-scheme: dark)')
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return systemQuery().matches ? 'dark' : 'light'
  return preference
}

/** اعمال تم روی صفحه (data-theme) و نوار وضعیت اندروید */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme])

  if (Capacitor.isNativePlatform()) {
    SystemBars.setStyle({ style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch((error) =>
      logger.warn('تنظیم رنگ نوار وضعیت ناموفق بود', error),
    )
  }
}

/** وقتی گزینه «سیستم» انتخاب است، با تغییر تم گوشی هماهنگ می‌شود. تابع لغو اشتراک را برمی‌گرداند. */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = systemQuery()
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
