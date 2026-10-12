import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Button, ButtonLink } from '../components/Button'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { EmptyState } from '../components/EmptyState'
import { Field, TextArea } from '../components/Field'
import { PageHeader } from '../components/PageHeader'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { MONEY_KIND_LABELS, MONEY_METHOD_LABELS } from '../models/money'
import { getMoney } from '../services/appContext'
import { formatPersianDateTime } from '../utils/date'
import { formatMoney } from '../utils/money'
import { toPersianDigits } from '../utils/persian'
import inv from './invoices/Invoices.module.css'
import styles from './money/Money.module.css'

const SOURCE_TEXT = {
  sale: 'همراه فاکتور فروش ثبت شده',
  purchase: 'همراه فاکتور خرید ثبت شده',
  sale_return: 'استرداد خودکار برگشت فروش',
  purchase_return: 'استرداد خودکار برگشت خرید',
} as const

/** جزئیات سند دریافت/پرداخت + ابطال (فقط اسناد دستی) */
export default function MoneyDetailPage() {
  const { id = '' } = useParams()
  const goBack = useGoBack('/money')
  const toast = useToast()
  const load = useCallback(() => getMoney().detail(id), [id])
  const { data, error, loading, reload } = useAsync(load)
  const [asking, setAsking] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [reason, setReason] = useState('')

  if (error && data === undefined) {
    return (
      <>
        <PageHeader title="سند" onBack={goBack} />
        <EmptyState icon="alert" title="سند باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      </>
    )
  }
  if (loading || data === undefined) return <PageHeader title="سند" onBack={goBack} />
  if (data === null) {
    return (
      <>
        <PageHeader title="سند" onBack={goBack} />
        <EmptyState icon="help" title="سند پیدا نشد" description="این سند وجود ندارد یا نشانی اشتباه است." action={<ButtonLink to="/money">دریافت و پرداخت</ButtonLink>} />
      </>
    )
  }

  const { document: d, party, allocations } = data
  const cancelled = d.status === 'cancelled'
  const allocated = allocations.reduce((s, a) => s + a.amount, 0)
  const title = `${MONEY_KIND_LABELS[d.kind]} ${toPersianDigits(d.docNumber)}`

  return (
    <>
      <PageHeader title={title} onBack={goBack} actions={cancelled ? <Badge tone="error">ابطال‌شده</Badge> : undefined} />
      {cancelled && (
        <div className={inv.cancelBox}>
          <strong>این سند ابطال شده و در مانده حساب اثری ندارد</strong>
          {d.cancelledAt && (
            <>
              <br />
              تاریخ ابطال: {formatPersianDateTime(d.cancelledAt)}
            </>
          )}
          {d.cancelReason && (
            <>
              <br />
              دلیل: {d.cancelReason}
            </>
          )}
        </div>
      )}
      <div className={inv.card}>
        <dl className={inv.info}>
          <dt>طرف حساب</dt>
          <dd>{party ? <Link to={`/parties/${party.id}`}>{party.name}</Link> : '—'}</dd>
          <dt>مبلغ</dt>
          <dd data-testid="money-amount">{formatMoney(d.amount)}</dd>
          <dt>تاریخ</dt>
          <dd>{formatPersianDateTime(d.docDate)}</dd>
          {d.method && (
            <>
              <dt>روش</dt>
              <dd>{MONEY_METHOD_LABELS[d.method]}</dd>
            </>
          )}
          {d.source !== 'manual' && (
            <>
              <dt>منشأ</dt>
              <dd>{SOURCE_TEXT[d.source]}</dd>
            </>
          )}
          {d.note && (
            <>
              <dt>توضیحات</dt>
              <dd>{d.note}</dd>
            </>
          )}
        </dl>
      </div>
      {(d.kind === 'receipt' || d.kind === 'payment') && (
        <div className={inv.card}>
          <strong>تسویه فاکتورها</strong>
          {allocations.length === 0 ? (
            <p className={styles.meta}>به فاکتور خاصی تخصیص نیافته؛ کل مبلغ علی‌الحساب است.</p>
          ) : (
            <ul className={styles.list} data-testid="money-allocations">
              {allocations.map((a) => (
                <li key={a.invoiceId}>
                  <Link className={styles.row} to={a.kind === 'sales' ? `/sales/${a.invoiceId}` : `/purchases/${a.invoiceId}`}>
                    <span className={styles.rowMain}>
                      <strong>
                        فاکتور {a.kind === 'sales' ? 'فروش' : 'خرید'} {toPersianDigits(a.number)}
                      </strong>
                      {a.invoiceStatus === 'cancelled' && <span className={styles.meta}>فاکتور ابطال شده؛ این مبلغ علی‌الحساب حساب می‌شود</span>}
                    </span>
                    <span>{formatMoney(a.amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {allocations.length > 0 && d.amount > allocated && <p className={styles.meta}>علی‌الحساب: {formatMoney(d.amount - allocated)}</p>}
        </div>
      )}
      {!cancelled && d.source === 'manual' && (
        <div className={inv.actionStack}>
          <Button variant="danger" icon="trash" block onClick={() => setAsking(true)}>
            ابطال سند
          </Button>
        </div>
      )}
      {!cancelled && d.source !== 'manual' && <p className={styles.meta}>این سند همراه فاکتور یا برگشت ثبت شده و با ابطال همان فاکتور/برگشت خودکار ابطال می‌شود.</p>}

      <Sheet open={asking && !confirm} title="ابطال سند" onClose={() => setAsking(false)}>
        <div className={inv.sheetBody}>
          <p className={inv.muted}>سند حذف نمی‌شود؛ با نشان «ابطال‌شده» می‌ماند و از مانده حساب و تسویه فاکتورها کنار می‌رود.</p>
          <Field label="دلیل ابطال" htmlFor="cancel-reason" hint="اختیاری">
            <TextArea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          </Field>
          <Button variant="danger" block onClick={() => setConfirm(true)}>
            ادامه
          </Button>
        </div>
      </Sheet>
      <ConfirmSheet
        open={confirm}
        tone="danger"
        title="ابطال قطعی؟"
        message={`${title} ابطال می‌شود و این کار برگشت ندارد.`}
        confirmLabel="بله، ابطال شود"
        onConfirm={async () => {
          await getMoney().cancel(d.id, reason)
          setConfirm(false)
          setAsking(false)
          toast.show('سند ابطال شد.')
          reload()
        }}
        onCancel={() => setConfirm(false)}
      />
    </>
  )
}
