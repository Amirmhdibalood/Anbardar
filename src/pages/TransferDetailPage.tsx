import { useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Button, ButtonLink } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { getTransfers } from '../services/appContext'
import { formatPersianDateTime } from '../utils/date'
import { formatMoney } from '../utils/money'
import { toPersianDigits } from '../utils/persian'
import { formatQuantityWithUnit } from '../utils/quantity'
import styles from './Returns.module.css'

export default function TransferDetailPage() {
  const { id = '' } = useParams()
  const goBack = useGoBack('/transfers')
  const load = useCallback(() => getTransfers().detail(id), [id])
  const { data, error, loading, reload } = useAsync(load)

  if (error && !data) {
    return (
      <>
        <PageHeader title="جزئیات انتقال" onBack={goBack} />
        <EmptyState icon="alert" title="باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      </>
    )
  }
  if (loading || data === undefined) return <PageHeader title="جزئیات انتقال" onBack={goBack} />
  if (!data) {
    return (
      <>
        <PageHeader title="جزئیات انتقال" onBack={goBack} />
        <EmptyState icon="help" title="پیدا نشد" description="این انتقال وجود ندارد." action={<ButtonLink to="/transfers">فهرست</ButtonLink>} />
      </>
    )
  }

  const { doc, items, from, to } = data
  return (
    <div className={styles.page} data-testid="transfer-detail">
      <PageHeader
        title={`انتقال ${toPersianDigits(doc.transferNumber)}`}
        onBack={goBack}
        actions={doc.status === 'cancelled' ? <Badge tone="error">ابطال‌شده</Badge> : undefined}
      />
      <div className={styles.card}>
        <div className={styles.meta}>
          <span>
            از {from?.name ?? '—'} به {to?.name ?? '—'}
          </span>
          <span>{formatPersianDateTime(doc.docDate)}</span>
        </div>
      </div>
      <div className={styles.card}>
        {items.map((it) => (
          <div key={it.id} className={styles.row}>
            <div className={styles.head}>
              <strong>{it.product?.name ?? 'کالا'}</strong>
              <span>{formatQuantityWithUnit(it.quantity, it.product?.unitName ?? '')}</span>
            </div>
            <div className={styles.meta}>
              <span>بهای منتقل‌شده: {formatMoney(it.costs.fifo)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
