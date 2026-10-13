import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ChequeActions, ChequeBadge } from '../components/ChequeActions'
import { Chip } from '../components/Chip'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { CHEQUE_DIRECTION_LABELS, daysUntil, type ChequeRow, type ChequeStatus } from '../models/cheque'
import { getCheques } from '../services/appContext'
import { formatPersianDate } from '../utils/date'
import { formatMoney } from '../utils/money'
import { toPersianDigits } from '../utils/persian'
import styles from './money/Money.module.css'

type Filter = 'due' | 'received' | 'issued' | ChequeStatus

function dueText(c: ChequeRow): { text: string; cls?: string } {
  if (c.status !== 'pending') return { text: `سررسید ${formatPersianDate(new Date(c.dueDate))}` }
  const n = daysUntil(c.dueDate)
  if (n < 0) return { text: `سررسید ${formatPersianDate(new Date(c.dueDate))} · ${toPersianDigits(-n)} روز گذشته`, cls: styles.overdue }
  if (n === 0) return { text: `سررسید امروز`, cls: styles.overdue }
  if (n <= 7) return { text: `سررسید ${formatPersianDate(new Date(c.dueDate))} · ${toPersianDigits(n)} روز دیگر`, cls: styles.dueSoon }
  return { text: `سررسید ${formatPersianDate(new Date(c.dueDate))} · ${toPersianDigits(n)} روز دیگر` }
}

/** چک‌ها: فهرست سررسید و تغییر وضعیت (وصول / برگشتی / خرج) */
export default function ChequesPage() {
  const goBack = useGoBack('/more')
  const [filter, setFilter] = useState<Filter>('due')
  const load = useCallback(async () => {
    const svc = getCheques()
    if (filter === 'due') return svc.list({ status: 'pending' })
    if (filter === 'received' || filter === 'issued') return svc.list({ direction: filter })
    return svc.list({ status: filter })
  }, [filter])
  const { data, error, loading, reload } = useAsync(load)
  const pendingReceived = (data ?? []).filter((c) => c.status === 'pending' && c.direction === 'received').reduce((s, c) => s + c.amount, 0)
  const pendingIssued = (data ?? []).filter((c) => c.status === 'pending' && c.direction === 'issued').reduce((s, c) => s + c.amount, 0)

  return (
    <>
      <PageHeader title="چک‌ها" onBack={goBack} />
      <div className={styles.filters}>
        {(
          [
            ['due', 'در جریان (سررسید)'],
            ['received', 'دریافتی'],
            ['issued', 'پرداختی'],
            ['cleared', 'وصول'],
            ['bounced', 'برگشتی'],
            ['spent', 'خرج‌شده'],
          ] as const
        ).map(([f, label]) => (
          <Chip key={f} label={label} selected={filter === f} onClick={() => setFilter(f)} />
        ))}
      </div>
      {filter === 'due' && data && data.length > 0 && (
        <Card>
          <div className={styles.totals} data-testid="cheque-totals">
            <div>
              <span>دریافتی در جریان</span>
              <strong>{formatMoney(pendingReceived)}</strong>
            </div>
            <div>
              <span>پرداختی در جریان</span>
              <strong>{formatMoney(pendingIssued)}</strong>
            </div>
          </div>
        </Card>
      )}
      {error && !data ? (
        <EmptyState icon="alert" title="فهرست باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      ) : loading || !data ? null : data.length === 0 ? (
        <EmptyState icon="file" title="چکی نیست" description="هنگام ثبت دریافت یا پرداخت، روش «چک» را انتخاب کنید تا چک با سررسیدش اینجا بیاید." />
      ) : (
        <Card>
          <ul className={styles.list} data-testid="cheque-list">
            {data.map((c) => {
              const due = dueText(c)
              return (
                <li key={c.id} className={styles.chequeCard} data-cheque={c.number}>
                  <div className={styles.chequeTop}>
                    <strong>
                      <Link to={`/money/${c.documentId}`}>
                        چک {CHEQUE_DIRECTION_LABELS[c.direction]} {toPersianDigits(c.number)}
                      </Link>
                    </strong>
                    <ChequeBadge status={c.status} />
                  </div>
                  <div className={styles.chequeTop}>
                    <span className={styles.meta}>
                      {c.direction === 'received' ? 'از' : 'به'} {c.partyName} · بانک {c.bank}
                      {c.spentToName ? ` · خرج به ${c.spentToName}` : ''}
                    </span>
                    <strong>{formatMoney(c.amount)}</strong>
                  </div>
                  <span className={`${styles.meta} ${due.cls ?? ''}`}>{due.text}</span>
                  <ChequeActions cheque={c} onDone={reload} />
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </>
  )
}
