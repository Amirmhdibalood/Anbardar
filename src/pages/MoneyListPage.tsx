import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Button, ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { Chip } from '../components/Chip'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { MONEY_KIND_LABELS, MONEY_METHOD_LABELS, type MoneyKind } from '../models/money'
import { getCatalog, getMoney } from '../services/appContext'
import { formatPersianDateTime } from '../utils/date'
import { formatMoney } from '../utils/money'
import { toPersianDigits } from '../utils/persian'
import styles from './money/Money.module.css'

type Filter = 'all' | 'receipt' | 'payment' | 'opening' | 'cancelled'
const KINDS: Record<Filter, MoneyKind[] | undefined> = {
  all: undefined,
  receipt: ['receipt'],
  payment: ['payment'],
  opening: ['opening_debit', 'opening_credit'],
  cancelled: undefined,
}

/** فهرست اسناد دریافت و پرداخت (جدیدترین اول) */
export default function MoneyListPage() {
  const goBack = useGoBack('/more')
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const load = useCallback(async () => {
    const [docs, parties] = await Promise.all([
      getMoney().list({ kinds: KINDS[filter], status: filter === 'cancelled' ? 'cancelled' : undefined, limit: 300 }),
      getCatalog().parties.list({ includeInactive: true }),
    ])
    return { docs, names: new Map(parties.map((p) => [p.id, p.name])) }
  }, [filter])
  const { data, error, loading, reload } = useAsync(load)

  return (
    <>
      <PageHeader title="دریافت و پرداخت" onBack={goBack} />
      <div className={styles.actions}>
        <ButtonLink icon="plus" to="/money/new?kind=receipt">
          دریافت جدید
        </ButtonLink>
        <ButtonLink variant="secondary" icon="plus" to="/money/new?kind=payment">
          پرداخت جدید
        </ButtonLink>
      </div>
      <div className={styles.filters}>
        {(
          [
            ['all', 'همه'],
            ['receipt', 'دریافت'],
            ['payment', 'پرداخت'],
            ['opening', 'مانده اول دوره'],
            ['cancelled', 'ابطال‌شده'],
          ] as const
        ).map(([f, label]) => (
          <Chip key={f} label={label} selected={filter === f} onClick={() => setFilter(f)} />
        ))}
      </div>
      {error && !data ? (
        <EmptyState icon="alert" title="فهرست باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      ) : loading || !data ? null : data.docs.length === 0 ? (
        <EmptyState
          icon="wallet"
          title="سندی نیست"
          description="هر پولی که از مشتری می‌گیرید یا به تأمین‌کننده می‌دهید را اینجا ثبت کنید. مبلغ پرداختی هنگام ثبت فاکتور هم خودکار اینجا می‌آید."
        />
      ) : (
        <Card>
          <ul className={styles.list} data-testid="money-list">
            {data.docs.map((d) => (
              <li key={d.id}>
                <button type="button" className={styles.row} onClick={() => navigate(`/money/${d.id}`)}>
                  <span className={styles.rowMain}>
                    <strong>
                      {MONEY_KIND_LABELS[d.kind]} {toPersianDigits(d.docNumber)} | {data.names.get(d.partyId) ?? '—'}
                    </strong>
                    <span className={styles.meta}>
                      {formatPersianDateTime(d.docDate)}
                      {d.method ? ` | ${MONEY_METHOD_LABELS[d.method]}` : ''}
                      {d.source !== 'manual' ? ' | خودکار' : ''}
                    </span>
                  </span>
                  {d.status === 'cancelled' && <Badge tone="error">ابطال‌شده</Badge>}
                  <span className={`${d.kind === 'receipt' || d.kind === 'opening_credit' ? styles.plus : styles.minus} ${d.status === 'cancelled' ? styles.struck : ''}`}>
                    {formatMoney(d.amount)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
