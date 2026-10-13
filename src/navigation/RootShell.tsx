import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { Button } from '../components/Button'
import { LockScreen } from '../components/LockScreen'
import { Sheet } from '../components/Sheet'
import { useSession } from '../hooks/useSession'
import { setActor, setUsersOn } from '../services/session'
import { useToast } from '../components/Toast'
import { getApp, getUsers } from '../services/appContext'
import { hasChangesSinceBackup } from '../services/backupChanges'
import { shareBackup } from '../services/backupService'
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

  const session = useSession()
  // حالت چندکاربره: در شروع بررسی، و قفل خودکار پس از ۵ دقیقه در پس‌زمینه
  useEffect(() => {
    void getUsers()
      .enabled()
      .then(setUsersOn)
      .catch(() => setUsersOn(false))
    let hiddenAt = 0
    const onVis = () => {
      if (document.hidden) hiddenAt = Date.now()
      else if (hiddenAt && Date.now() - hiddenAt > 5 * 60_000) setActor(null)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  const [exitPrompt, setExitPrompt] = useState(false)
  const [backingUp, setBackingUp] = useState(false)

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
          // اگر از آخرین پشتیبان چیزی تغییر کرده، قبل از خروج پیشنهاد پشتیبان بده
          void hasChangesSinceBackup(getApp().db)
            .catch(() => false)
            .then((changed) => (changed ? setExitPrompt(true) : exitNow()))
          break
      }
      if (action !== 'arm-exit') lastHome.current = null
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

  const backupAndExit = async () => {
    setBackingUp(true)
    try {
      await shareBackup()
      setExitPrompt(false)
      exitNow()
    } catch {
      toast.show('پشتیبان‌گیری انجام نشد؛ دوباره تلاش کنید.')
    } finally {
      setBackingUp(false)
    }
  }

  return (
    <>
      {session.usersOn && !session.actor ? <LockScreen /> : <Outlet />}
      <Sheet open={exitPrompt} title="قبل از خروج پشتیبان بگیرید؟" onClose={() => setExitPrompt(false)}>
        <div data-testid="exit-backup-sheet" style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 8 }}>
          <p style={{ margin: 0, lineHeight: 1.9, color: 'var(--muted)' }}>
            از آخرین نسخه پشتیبان، اطلاعات فروشگاه تغییر کرده است. اگر گوشی گم یا خراب شود، فقط با فایل پشتیبان می‌توانید اطلاعات را برگردانید.
          </p>
          <Button block icon="shield" loading={backingUp} onClick={() => void backupAndExit()} data-testid="exit-backup">
            پشتیبان و خروج
          </Button>
          <Button block variant="secondary" disabled={backingUp} onClick={() => { setExitPrompt(false); exitNow() }} data-testid="exit-no-backup">
            خروج بدون پشتیبان
          </Button>
          <Button block variant="ghost" disabled={backingUp} onClick={() => setExitPrompt(false)} data-testid="exit-stay">
            ماندن در برنامه
          </Button>
        </div>
      </Sheet>
    </>
  )
}

function exitNow() {
  if (Capacitor.isNativePlatform()) void import('@capacitor/app').then(({ App }) => App.exitApp())
  else window.dispatchEvent(new Event(EXIT_EVENT))
}
