import { useCallback, useEffect, useState } from 'react'
import { Chip } from '../components/Chip'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { useGoBack } from '../hooks/useGoBack'
import { useSession } from '../hooks/useSession'
import { getUsers } from '../services/appContext'
import type { AuditRow, UserRow } from '../services/userService'
import { formatPersianDateTime } from '../utils/date'
import { toUserMessage } from '../utils/errors'
import styles from './AuditLogPage.module.css'

const PAGE = 50

/** گزارش فعالیت‌ها: چه کسی، چه زمانی، چه کاری (فقط خواندنی) */
export default function AuditLogPage() {
  const goBack = useGoBack('/more')
  const { usersOn } = useSession()
  const [users, setUsers] = useState<UserRow[]>([])
  const [userId, setUserId] = useState<string | undefined>(undefined)
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (usersOn) void getUsers().list().then(setUsers).catch(() => undefined)
  }, [usersOn])
  const load = useCallback(
    async (offset: number) => {
      try {
        const page = await getUsers().audit({ userId, limit: PAGE, offset })
        setRows((cur) => (offset ? [...(cur ?? []), ...page] : page))
        setMore(page.length === PAGE)
        setError(null)
      } catch (e) {
        setError(toUserMessage(e))
      }
    },
    [userId],
  )
  useEffect(() => {
    const t = setTimeout(() => void load(0), 0)
    return () => clearTimeout(t)
  }, [load])

  return (
    <>
      <PageHeader title="گزارش فعالیت‌ها" onBack={goBack} />
      {users.length > 0 && (
        <div className={styles.chips}>
          <Chip label="همه" selected={userId === undefined} onClick={() => setUserId(undefined)} />
          {users.map((u) => (
            <Chip key={u.id} label={u.name} selected={userId === u.id} onClick={() => setUserId(u.id)} />
          ))}
        </div>
      )}
      {error && <EmptyState icon="alert" title="دسترسی ندارید" description={error} />}
      {rows && rows.length === 0 && <EmptyState icon="file" title="فعالیتی ثبت نشده" description="هر ثبت، ابطال، ورود و تغییر تنظیمات اینجا با نام کاربر ثبت می‌شود." />}
      <ul className={styles.list} data-testid="audit-list">
        {rows?.map((r) => (
          <li key={r.id} className={styles.row} data-action={r.action}>
            <div className={styles.top}>
              <strong>{r.userName}</strong>
              <time>{formatPersianDateTime(r.at)}</time>
            </div>
            <p>{r.summary}</p>
          </li>
        ))}
      </ul>
      {more && (
        <button type="button" className={styles.more} onClick={() => void load(rows?.length ?? 0)}>
          موارد قدیمی‌تر
        </button>
      )}
    </>
  )
}
