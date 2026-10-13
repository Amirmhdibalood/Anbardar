import { createContext } from 'react'
import type { Accent, AppFont, AppSettings, CostMethod, ResolvedTheme, SalePriceMode, ThemePreference } from '../models/settings'

export interface SettingsContextValue {
  settings: AppSettings
  setTheme: (theme: ThemePreference) => void
  setAccent: (mode: ResolvedTheme, accent: Accent) => void
  setFont: (font: AppFont) => void
  setCostMethod: (method: CostMethod) => void
  setSalePriceMode: (mode: SalePriceMode) => void
  setMarkupBp: (bp: number) => void
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)
