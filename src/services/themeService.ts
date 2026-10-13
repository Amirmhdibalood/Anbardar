import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'
import type { Accent, ResolvedTheme, ThemePreference } from '../models/settings'
import { logger } from '../utils/logger'


function systemQuery(): MediaQueryList {
  return window.matchMedia('(prefers-color-scheme: dark)')
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return systemQuery().matches ? 'dark' : 'light'
  return preference
}

/** اعمال تم روی صفحه (data-theme + data-accent) و رنگ آیکون‌های نوار وضعیت/ناوبری اندروید */
export function applyTheme(theme: ResolvedTheme, accent: Accent = 'purple'): void {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  if (accent === 'purple') root.removeAttribute('data-accent')
  else root.setAttribute('data-accent', accent)
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)

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

/** جابه‌جایی نرم بین تم‌ها (View Transitions اگر باشد؛ وگرنه transition موقت رنگ‌ها) */
export function withThemeTransition(change: () => void): void {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  type VT = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> }
  const doc = document as Document & { startViewTransition?: (cb: () => void) => VT }
  if (reduce) return change()
  if (doc.startViewTransition) {
    const t = doc.startViewTransition(change)
    // دو بار زدن پشت سر هم transition قبلی را رد می‌کند (AbortError)؛ بی‌اهمیت است
    for (const p of [t.ready, t.finished, t.updateCallbackDone]) p?.catch(() => {})
    return
  }
  const root = document.documentElement
  root.classList.add('theme-transition')
  change()
  window.setTimeout(() => root.classList.remove('theme-transition'), 450)
}
