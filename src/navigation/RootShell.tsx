import { useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useToast } from '../components/Toast'
import { EXIT_TOAST, decideBack } from './backButton'

/** رویداد آزمایشی برای شبیه‌سازی دکمه بازگشت در مرورگر/تست */
export const BACK_EVENT = 'anbardar:back'
/** در مرورگر به‌جای خروج از برنامه (برای تست) */
export const EXIT_EVENT = 'anbardar:exit'

function topDialog(): HTMLElement | null {
  const d = document.querySelectorAll<HTMLElement>('[role="dialog"]')
  return d[d.length - 1] ?? null
}

/**
 * پوسته ریشه همه صفحه‌ها: دکمه بازگشت سخت‌افزاری و جابه‌جایی صفحه‌کلید.
 * - بازگشت: اول برگه باز بسته می‌شود؛ بعد همان دکمه بازگشت سربرگ (با تأیید خروج فرم پر)؛ تب ریشه ← خانه؛
 *   روی خانه دو بار زدن در ۲ ثانیه ← خروج.
 * - صفحه‌کلید: WebView به‌صورت بومی (adjustResize + SystemBars) کوچک می‌شود؛ اگر نشد (صفحه‌کلید روی محتوا)
 *   از visualViewport مقدار --kb-inset ساخته می‌شود. هر دو هم‌زمان صفر نیستند، پس فاصله دو بار حساب نمی‌شود.
 */
export function RootShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const lastHome = useRef<number | null>(null)
  const state = useRef({ pathname: location.pathname, key: location.key })
  useEffect(() => {
    state.current = { pathname: location.pathname, key: location.key }
  }, [location])

  useEffect(() => {
    const onBack = () => {
      const dialog = topDialog()
      const backButton = document.querySelector<HTMLElement>('[data-back-button]')
      const action = decideBack({
        dialogOpen: !!dialog,
        hasBackButton: !!backButton,
        pathname: state.current.pathname,
        canGoBack: state.current.key !== 'default' && window.history.length > 1,
        lastHomePress: lastHome.current,
        now: Date.now(),
      })
      switch (action) {
        case 'close-dialog':
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          break
        case 'page-back':
          backButton?.click()
          break
        case 'history-back':
          navigate(-1)
          break
        case 'go-home':
          navigate('/', { replace: true })
          break
        case 'arm-exit':
          lastHome.current = Date.now()
          toast.show(EXIT_TOAST)
          break
        case 'exit':
          if (Capacitor.isNativePlatform()) void import('@capacitor/app').then(({ App }) => App.exitApp())
          else window.dispatchEvent(new Event(EXIT_EVENT))
          break
      }
      if (action !== 'arm-exit' && action !== 'exit') lastHome.current = null
    }
    window.addEventListener(BACK_EVENT, onBack)
    let remove: (() => void) | undefined
    if (Capacitor.isNativePlatform()) {
      void import('@capacitor/app').then(({ App }) =>
        App.addListener('backButton', onBack).then((h) => {
          remove = () => void h.remove()
        }),
      )
    }
    return () => {
      window.removeEventListener(BACK_EVENT, onBack)
      remove?.()
    }
  }, [navigate, toast])

  useEffect(() => {
    const root = document.documentElement
    const vv = window.visualViewport
    const reveal = () => {
      const el = document.activeElement as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    const update = () => {
      const inset = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0
      root.style.setProperty('--kb-inset', `${inset}px`)
      root.classList.toggle('kb-open', inset > 80)
      if (inset > 80) setTimeout(reveal, 60)
    }
    update()
    vv?.addEventListener('resize', update)
    const onFocus = () => setTimeout(reveal, 300)
    document.addEventListener('focusin', onFocus)
    let removeKb: (() => void) | undefined
    if (Capacitor.isNativePlatform()) {
      void import('@capacitor/keyboard').then(({ Keyboard }) => {
        const hs = [
          Keyboard.addListener('keyboardDidShow', () => {
            root.classList.add('kb-open')
            reveal()
          }),
          Keyboard.addListener('keyboardDidHide', () => root.classList.remove('kb-open')),
        ]
        removeKb = () => hs.forEach((h) => void h.then((x) => x.remove()))
      })
    }
    return () => {
      vv?.removeEventListener('resize', update)
      document.removeEventListener('focusin', onFocus)
      removeKb?.()
    }
  }, [])

  return <Outlet />
}
