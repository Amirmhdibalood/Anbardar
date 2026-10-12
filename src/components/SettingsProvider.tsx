import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SettingsContext, type SettingsContextValue } from '../hooks/settingsContext'
import { DEFAULT_SETTINGS, type AppSettings, type CostMethod, type SalePriceMode, type ThemePreference } from '../models/settings'
import { cacheTheme, loadSettings, updateSettings } from '../services/settingsService'
import { applyTheme, resolveTheme, watchSystemTheme } from '../services/themeService'
import { logger } from '../utils/logger'

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadSettings().then((loaded) => {
      if (cancelled) return
      setSettings(loaded)
      cacheTheme(loaded.theme)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // تم را با تنظیمات (و در حالت «سیستم» با تم گوشی) هماهنگ نگه می‌دارد
  useEffect(() => {
    if (!ready) return
    const apply = () => applyTheme(resolveTheme(settings.theme))
    apply()
    return settings.theme === 'system' ? watchSystemTheme(apply) : undefined
  }, [ready, settings.theme])

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

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      setTheme: (theme: ThemePreference) => patch({ theme }),
      setCostMethod: (costMethod: CostMethod) => patch({ costMethod }),
      setSalePriceMode: (salePriceMode: SalePriceMode) => patch({ salePriceMode }),
      setMarkupBp: (markupBp: number) => patch({ markupBp }),
    }),
    [settings, patch],
  )

  if (!ready) return null
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
