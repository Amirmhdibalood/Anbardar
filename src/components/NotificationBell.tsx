import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { getNotifications, NOTIFY_EVENT } from '../services/appContext'
import { toPersianDigits } from '../utils/persian'
import { Icon } from './Icon'
import styles from './NotificationBell.module.css'

/** زنگ اعلان‌های داخل برنامه با شمارنده خوانده‌نشده (بدون اعلان سیستمی) */
export function NotificationBell() {
  const [count, setCount] = useState(0)
  const { pathname } = useLocation()
  useEffect(() => {
    let alive = true
    const refresh = () =>
      void getNotifications()
        .unreadCount()
        .then((n) => alive && setCount(n))
        .catch(() => undefined)
    refresh()
    window.addEventListener(NOTIFY_EVENT, refresh)
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      window.removeEventListener(NOTIFY_EVENT, refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [pathname])
  const label = count > 0 ? `اعلان‌ها، ${toPersianDigits(count)} خوانده‌نشده` : 'اعلان‌ها'
  return (
    <Link to="/notifications" className={styles.bell} aria-label={label} title="اعلان‌ها" data-testid="notification-bell">
      <Icon name="bell" size={20} />
      {count > 0 && (
        <span className={styles.badge} data-testid="notification-badge">
          {count > 9 ? '۹+' : toPersianDigits(count)}
        </span>
      )}
    </Link>
  )
}
