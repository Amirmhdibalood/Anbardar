import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { getNotifications, NOTIFY_EVENT, pingNotifications } from '../services/appContext'
import type { AppNotification } from '../services/notificationService'
import { Icon, type IconName } from './Icon'
import styles from './FloatingBanners.module.css'

const MAX_VISIBLE = 2
const AUTO_HIDE_MS = 6000

function iconOf(n: AppNotification): IconName {
  if (n.kind.startsWith('cheque')) return 'wallet'
  if (n.kind.startsWith('backup')) return 'shield'
  return 'box'
}

/**
 * بنرهای شناور تلگرام‌مانند زیر سربرگ: روی محتوا می‌نشینند (بدون جابه‌جایی صفحه)، حداکثر ۲ تا،
 * هر مورد تازه/تغییرکرده فقط یک بار. بسته شدن (X، کشیدن، یا پنهان شدن خودکار) آن را در زنگ اعلان‌ها نگه می‌دارد.
 */
export function FloatingBanners() {
  const navigate = useNavigate()
  const [visible, setVisible] = useState<AppNotification[]>([])
  const queue = useRef<AppNotification[]>([])
  const seen = useRef(new Set<string>())

  const fill = useCallback(() => {
    setVisible((cur) => {
      const next = [...cur]
      while (next.length < MAX_VISIBLE && queue.current.length) {
        const n = queue.current.shift()!
        next.push(n)
        // همان لحظه نمایش «نشان داده شد» ثبت می‌شود تا دیگر تکرار نشود
        void getNotifications().markShown(n.id)
      }
      return next
    })
  }, [])

  const load = useCallback(async () => {
    const pending = await getNotifications().pendingBanners()
    for (const n of pending) {
      if (seen.current.has(n.id)) continue
      seen.current.add(n.id)
      queue.current.push(n)
    }
    fill()
  }, [fill])

  useEffect(() => {
    void load().catch(() => undefined)
    const on = () => void load().catch(() => undefined)
    window.addEventListener(NOTIFY_EVENT, on)
    return () => window.removeEventListener(NOTIFY_EVENT, on)
  }, [load])

  const dismiss = useCallback(
    (id: string) => {
      setVisible((cur) => cur.filter((n) => n.id !== id))
      setTimeout(fill, 0)
      pingNotifications()
    },
    [fill],
  )

  const open = async (n: AppNotification) => {
    await getNotifications().markRead(n.id)
    dismiss(n.id)
    navigate(n.to)
  }

  if (!visible.length) return null
  return (
    <div className={styles.stack} aria-live="polite" data-testid="floating-banners">
      {visible.map((n) => (
        <Banner key={n.id} n={n} onClose={() => dismiss(n.id)} onOpen={() => void open(n)} />
      ))}
    </div>
  )
}

function Banner({ n, onClose, onOpen }: { n: AppNotification; onClose: () => void; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number; id: number } | null>(null)
  const [dx, setDx] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const close = useCallback(() => {
    setLeaving(true)
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    setTimeout(onClose, reduce ? 0 : 180)
  }, [onClose])

  useEffect(() => {
    if (n.sticky) return
    const t = setTimeout(close, AUTO_HIDE_MS)
    return () => clearTimeout(t)
  }, [n.sticky, close])

  const down = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
  }
  const move = (e: RPointerEvent) => {
    if (!start.current) return
    const x = e.clientX - start.current.x
    const y = e.clientY - start.current.y
    if (Math.abs(x) > 6 || y < -6) ref.current?.setPointerCapture?.(start.current.id)
    setDx(y < -Math.abs(x) ? 0 : x)
    if (y < -40) {
      start.current = null
      close()
    }
  }
  const up = (e: RPointerEvent) => {
    if (!start.current) return
    const x = e.clientX - start.current.x
    const y = e.clientY - start.current.y
    start.current = null
    if (Math.abs(x) > 70) close()
    else if (Math.abs(x) < 6 && Math.abs(y) < 6) onOpen()
    else setDx(0)
  }

  return (
    <div
      ref={ref}
      role="status"
      className={styles.banner}
      data-severity={n.severity}
      data-leaving={leaving}
      data-testid="floating-banner"
      data-id={n.id}
      style={dx ? { transform: `translateX(${dx}px)`, opacity: Math.max(0.2, 1 - Math.abs(dx) / 200) } : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => ((start.current = null), setDx(0))}
    >
      <span className={styles.icon}>
        <Icon name={iconOf(n)} size={18} />
      </span>
      <div className={styles.text}>
        <strong>{n.title}</strong>
        <span>{n.detail}</span>
        {n.action && (
          <button type="button" className={styles.action} onClick={onOpen} data-testid="banner-action">
            {n.action}
          </button>
        )}
      </div>
      <button type="button" className={styles.close} aria-label="بستن" onClick={close} data-testid="banner-close">
        <Icon name="x" size={16} />
      </button>
    </div>
  )
}
