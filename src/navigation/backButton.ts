/** منطق دکمه بازگشت سخت‌افزاری اندروید (جدا از UI تا تست واحد داشته باشد) */
export const ROOT_TABS = ['/', '/products', '/stock', '/reports', '/more'] as const
export const EXIT_WINDOW_MS = 2000
export const EXIT_TOAST = 'برای خروج دوباره بزنید'

export type BackAction = 'close-dialog' | 'page-back' | 'history-back' | 'go-home' | 'arm-exit' | 'exit'

export interface BackState {
  /** برگه/پنجره بازی روی صفحه هست */
  dialogOpen: boolean
  /** سربرگ صفحه دکمه بازگشت دارد (همان رفتار، از جمله تأیید خروج از فرم پر) */
  hasBackButton: boolean
  pathname: string
  /** تاریخچه داخل برنامه قدم قبلی دارد */
  canGoBack: boolean
  /** زمان آخرین «بازگشت» روی خانه (برای دو بار زدن) */
  lastHomePress: number | null
  now: number
}

export function decideBack(s: BackState): BackAction {
  if (s.dialogOpen) return 'close-dialog'
  if (s.hasBackButton) return 'page-back'
  if (s.pathname === '/' || s.pathname === '') {
    return s.lastHomePress !== null && s.now - s.lastHomePress <= EXIT_WINDOW_MS ? 'exit' : 'arm-exit'
  }
  if ((ROOT_TABS as readonly string[]).includes(s.pathname)) return 'go-home'
  return s.canGoBack ? 'history-back' : 'go-home'
}
