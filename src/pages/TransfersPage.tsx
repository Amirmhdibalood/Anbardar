import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Button, ButtonLink, IconLink } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { getCatalog, getTransfers } from '../services/appContext'
import { formatPersianDateTime } from '../utils/date'
import { toPersianDigits } from '../utils/persian'
import styles from './Returns.module.css'

export default function TransfersPage() {
  const goBack = useGoBack('/more')
  const load = useCallback(async () => {
    const [list, warehouses] = await Promise.all([getTransfers().list(100), getCatalog().warehouses.list({ includeInactive: true })])
    const names = Object.fromEntries(warehouses.map((w) => [w.id, w.name]))
    return list.map((t) => ({
      ...t,
      fromName: names[t.fromWarehouseId] ?? '—',
      toName: names[t.toWarehouseId] ?? '—',
    }))
  }, [])
  const { data, error, loading, reload } = useAsync(load)

  return (
    <div className={styles.page} data-testid="transfers-page">
      <PageHeader title="انتقال بین انبارها" onBack={goBack} actions={<IconLink icon="plus" label="انتقال جدید" to="/transfers/new" />} />
      {error && !data ? (
        <EmptyState icon="alert" title="فهرست باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      ) : loading || !data ? (
        <div aria-busy="true" />
      ) : data.length === 0 ? (
        <EmptyState
          icon="grid"
          title="هنوز انتقالی ثبت نشده"
          description="برای جابه‌جایی کالا بین انبارها، انتقال جدید ثبت کنید. بهای لایه‌ها حفظ می‌شود."
          action={<ButtonLink icon="plus" to="/transfers/new">انتقال جدید</ButtonLink>}
        />
      ) : (
        <div className={styles.card}>
          <ul className={styles.list}>
            {data.map((t) => (
              <li key={t.id}>
                <Link to={`/transfers/${t.id}`} className={undefined}>
                  <span className={styles.num}>{toPersianDigits(t.transferNumber)}</span>
                  <span className={styles.main}>
                    <strong>
                      {t.fromName} ← {t.toName}
                    </strong>
                    <span>
                      {formatPersianDateTime(t.docDate)}
                      {t.status === 'cancelled' ? ' | ابطال‌شده' : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
