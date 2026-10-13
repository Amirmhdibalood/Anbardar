import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { HelpTip } from '../components/HelpTip'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { getNotifications, pingNotifications } from '../services/appContext'
import type { AppNotification } from '../services/notificationService'
import { formatPersianDate } from '../utils/date'
import styles from './NotificationsPage.module.css'

function dateLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  return Number.isNaN(d.getTime()) ? '' : formatPersianDate(d)
}

export default function NotificationsPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<AppNotification[] | null>(null)
  const load = useCallback(() => void getNotifications().list().then(setItems), [])
  useEffect(load, [load])

  const open = async (n: AppNotification) => {
    if (!n.read) await getNotifications().markRead(n.id)
    pingNotifications()
    navigate(n.to)
  }
  const readOne = async (n: AppNotification) => {
    await getNotifications().markRead(n.id)
    pingNotifications()
    load()
  }
  const readAll = async () => {
    await getNotifications().markAllRead()
    pingNotifications()
    load()
  }
  const unread = items?.filter((n) => !n.read).length ?? 0

  return (
    <div className={styles.page} data-testid="notifications-page">
      <PageHeader
        title="اعلان‌ها"
        backTo="/"
        actions={
          <HelpTip
            title="اعلان‌ها چطور ساخته می‌شوند؟"
            text="اعلان‌ها هر بار از روی داده‌های خودِ برنامه ساخته می‌شوند: چک‌هایی که تا ۷ روز آینده سررسید دارند، امروز سررسیدند یا گذشته‌اند، و کالاهایی که به نقطه سفارش رسیده یا تمام شده‌اند. با رفع مشکل، اعلان خودبه‌خود حذف می‌شود. اعلان سیستمی یا پیامکی ارسال نمی‌شود."
          />
        }
      />
      {items && items.length > 0 && (
        <div className={styles.bar}>
          <span>{unread > 0 ? `${unread.toLocaleString('fa-IR')} اعلان خوانده‌نشده` : 'همه اعلان‌ها خوانده شده‌اند'}</span>
          <button type="button" className={styles.allBtn} onClick={readAll} disabled={unread === 0} data-testid="notifications-read-all">
            خواندن همه
          </button>
        </div>
      )}
      {items && items.length === 0 && (
        <div data-testid="notifications-empty">
          <EmptyState icon="bell" title="اعلانی ندارید" description="چک نزدیک سررسید یا کالای کم‌موجودی وجود ندارد. هر وقت چیزی نیاز به توجه داشت، اینجا می‌بینید." />
        </div>
      )}
      <ul className={styles.list}>
        {items?.map((n) => (
          <li key={n.id} className={styles.item} data-read={n.read} data-severity={n.severity} data-testid="notification-item">
            <button type="button" className={styles.main} onClick={() => void open(n)}>
              <span className={styles.icon}>
                <Icon name={n.kind.startsWith('cheque') ? 'wallet' : 'box'} size={18} />
              </span>
              <span className={styles.text}>
                <span className={styles.title}>{n.title}</span>
                <span className={styles.detail}>{n.detail}</span>
                {n.date && <span className={styles.date}>{dateLabel(n.date)}</span>}
              </span>
              {!n.read && <span className={styles.dot} aria-label="خوانده‌نشده" />}
            </button>
            {!n.read && (
              <button type="button" className={styles.mark} onClick={() => void readOne(n)} aria-label="علامت خوانده‌شده" data-testid="notification-mark-read">
                <Icon name="check" size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
