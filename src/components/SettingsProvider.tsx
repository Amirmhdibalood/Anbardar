import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SettingsContext, type SettingsContextValue } from '../hooks/settingsContext'
import { DEFAULT_SETTINGS, type AppSettings, type CostMethod, type SalePriceMode, type ThemePreference, type Accent, type AppFont, type ResolvedTheme } from '../models/settings'
import { cacheTheme, loadSettings, updateSettings } from '../services/settingsService'
import { applyFont, applyTheme, resolveTheme, watchSystemTheme, withThemeTransition } from '../services/themeService'
import { logger } from '../utils/logger'

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadSettings().then((loaded) => {
      if (cancelled) return
      setSettings(loaded)
      cacheTheme(loaded)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // تم را با تنظیمات (و در حالت «سیستم» با تم گوشی) هماهنگ نگه می‌دارد
  useEffect(() => {
    if (!ready) return
    const apply = () => {
      const mode = resolveTheme(settings.theme)
      applyTheme(mode, mode === 'dark' ? settings.accentDark : settings.accentLight)
    }
    apply()
    return settings.theme === 'system' ? watchSystemTheme(() => withThemeTransition(apply)) : undefined
  }, [ready, settings.theme, settings.accentDark, settings.accentLight])

  useEffect(() => {
    if (ready) applyFont(settings.font)
  }, [ready, settings.font])

  const latest = useRef(settings)
  useEffect(() => {
    latest.current = settings
  }, [settings])

  const patch = useCallback((change: Partial<AppSettings>) => {
    const current = latest.current
    const next = { ...current, ...change }
    latest.current = next
    setSettings(next)
    updateSettings(current, change).catch((error) => logger.error('ذخیره تنظیمات ناموفق بود', error))
  }, [])

  /** تغییر ظاهر با جابه‌جایی نرم: رنگ‌ها همان لحظه داخل transition اعمال می‌شوند، state بعد هماهنگ می‌شود */
  const patchAppearance = useCallback(
    (change: Partial<AppSettings>) => {
      const next = { ...latest.current, ...change }
      const mode = resolveTheme(next.theme)
      withThemeTransition(() => applyTheme(mode, mode === 'dark' ? next.accentDark : next.accentLight))
      patch(change)
    },
    [patch],
  )

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      setTheme: (theme: ThemePreference) => patchAppearance({ theme }),
      setAccent: (mode: ResolvedTheme, accent: Accent) => patchAppearance(mode === 'dark' ? { accentDark: accent } : { accentLight: accent }),
      setFont: (font: AppFont) => {
        applyFont(font)
        patch({ font })
      },
      setCostMethod: (costMethod: CostMethod) => patch({ costMethod }),
      setSalePriceMode: (salePriceMode: SalePriceMode) => patch({ salePriceMode }),
      setMarkupBp: (markupBp: number) => patch({ markupBp }),
    }),
    [settings, patch, patchAppearance],
  )

  if (!ready) return null
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
