import { useCallback, useState } from 'react'
import { useParams } from 'react-router-dom'
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
import { getPurchases } from '../services/appContext'
import { formatPersianDateTime } from '../utils/date'
import { formatMoney } from '../utils/money'
import { toPersianDigits } from '../utils/persian'
import { formatQuantityWithUnit } from '../utils/quantity'
import styles from './invoices/Invoices.module.css'

/** جزئیات فاکتور خرید + ابطال با دلیل */
export default function PurchaseDetailPage() {
  const { id = '' } = useParams()
  const goBack = useGoBack('/purchases')
  const toast = useToast()
  const load = useCallback(() => getPurchases().detail(id), [id])
  const { data, error, loading, reload } = useAsync(load)
  const [asking, setAsking] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [reason, setReason] = useState('')

  if (error && data === undefined) {
    return (
      <>
        <PageHeader title="فاکتور خرید" onBack={goBack} />
        <EmptyState icon="alert" title="فاکتور باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      </>
    )
  }
  if (loading || data === undefined) return <PageHeader title="فاکتور خرید" onBack={goBack} />
  if (data === null) {
    return (
      <>
        <PageHeader title="فاکتور خرید" onBack={goBack} />
        <EmptyState icon="help" title="فاکتور پیدا نشد" description="این فاکتور وجود ندارد یا نشانی اشتباه است." action={<ButtonLink to="/purchases">فهرست خریدها</ButtonLink>} />
      </>
    )
  }

  const { invoice, items, supplier, warehouse } = data
  const cancelled = invoice.status === 'cancelled'
  const lineSum = items.reduce((s, i) => s + i.lineTotal, 0)

  return (
    <>
      <PageHeader title={`فاکتور خرید ${toPersianDigits(invoice.invoiceNumber)}`} onBack={goBack} actions={cancelled ? <Badge tone="error">ابطال‌شده</Badge> : undefined} />
      {cancelled && (
        <div className={styles.cancelBox}>
          <strong>این فاکتور ابطال شده است</strong>
          <br />
          {invoice.cancelledAt && `تاریخ ابطال: ${formatPersianDateTime(invoice.cancelledAt)}`}
          {invoice.cancelReason && (
            <>
              <br />
              دلیل: {invoice.cancelReason}
            </>
          )}
          <br />
          کالاهای این فاکتور از موجودی کم شد.
        </div>
      )}
      <div className={styles.card}>
        <dl className={styles.info}>
          <dt>تأمین‌کننده</dt>
          <dd>{supplier?.name ?? '—'}</dd>
          <dt>انبار</dt>
          <dd>{warehouse?.name ?? '—'}</dd>
          <dt>تاریخ</dt>
          <dd>{formatPersianDateTime(invoice.invoiceDate)}</dd>
          {invoice.reference && (
            <>
              <dt>شماره فاکتور فروشنده</dt>
              <dd>{toPersianDigits(invoice.reference)}</dd>
            </>
          )}
        </dl>
      </div>
      <div className={styles.card}>
        {items.map((it) => (
          <div key={it.id} className={styles.item}>
            <div className={styles.itemHead}>
              <strong>{it.product?.name ?? 'کالای حذف‌شده'}</strong>
              <strong>{formatMoney(it.lineTotal)}</strong>
            </div>
            <div className={styles.itemMeta}>
              <span>
                {formatQuantityWithUnit(it.quantity, it.product?.unitName ?? '')} × {formatMoney(it.unitPrice)}
              </span>
              {it.discount > 0 && <span>تخفیف ردیف: {formatMoney(it.discount)}</span>}
            </div>
            {it.invoiceDiscountShare > 0 && (
              <div className={styles.itemMeta}>
                <span>بهای نهایی پس از سهم تخفیف فاکتور: {formatMoney(it.netAmount)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className={`${styles.card} ${styles.totals}`}>
        <div>
          <span>جمع ردیف‌ها</span>
          <strong>{formatMoney(lineSum)}</strong>
        </div>
        {invoice.discount > 0 && (
          <div>
            <span>تخفیف فاکتور</span>
            <strong>{formatMoney(invoice.discount)}</strong>
          </div>
        )}
        <div className={styles.grand}>
          <span>مبلغ پرداختی</span>
          <strong data-testid="invoice-total">{formatMoney(invoice.totalAmount)}</strong>
        </div>
      </div>
      {!cancelled && (
        <div className={styles.actionStack}>
          <ButtonLink variant="secondary" icon="plus" block to={`/purchases/${id}/return`}>
            برگشت کالا به تأمین‌کننده
          </ButtonLink>
          <Button variant="danger" icon="trash" block onClick={() => setAsking(true)}>
            ابطال فاکتور
          </Button>
        </div>
      )}

      <Sheet open={asking && !confirm} title="ابطال فاکتور خرید" onClose={() => setAsking(false)}>
        <div className={styles.sheetBody}>
          <p className={styles.muted}>با ابطال، کالاهای این فاکتور از موجودی «{warehouse?.name}» کم می‌شود. فاکتور حذف نمی‌شود و با نشان «ابطال‌شده» در فهرست می‌ماند. اگر بخشی از کالاها فروخته شده باشد، ابطال ممکن نیست.</p>
          <Field label="دلیل ابطال" htmlFor="cancel-reason" hint="اختیاری؛ مثلاً «ثبت تکراری»">
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
        message={`فاکتور خرید ${toPersianDigits(invoice.invoiceNumber)} ابطال می‌شود و این کار برگشت ندارد.`}
        confirmLabel="بله، ابطال شود"
        onConfirm={async () => {
          await getPurchases().cancel(invoice.id, reason)
          setConfirm(false)
          setAsking(false)
          toast.show('فاکتور ابطال شد و موجودی اصلاح شد.')
          reload()
        }}
        onCancel={() => setConfirm(false)}
      />
    </>
  )
}
