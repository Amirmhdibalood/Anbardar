import { useCallback, useState } from 'react'
import { useCan } from '../hooks/useSession'
import { useParams } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Button, ButtonLink } from '../components/Button'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { EmptyState } from '../components/EmptyState'
import { Field, TextArea } from '../components/Field'
import { InvoicePaymentCard } from '../components/invoice/InvoicePaymentCard'
import { PageHeader } from '../components/PageHeader'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { useSettings } from '../hooks/useSettings'
import { getSales } from '../services/appContext'
import { costMethodLabel, pickCost } from '../services/pricing'
import { formatPersianDateTime } from '../utils/date'
import { formatMoney } from '../utils/money'
import { toPersianDigits } from '../utils/persian'
import { formatQuantityWithUnit } from '../utils/quantity'
import styles from './invoices/Invoices.module.css'

/** جزئیات فاکتور فروش + ابطال (برگرداندن کالا به همان لایه‌ها) */
export default function SaleDetailPage() {
  const { id = '' } = useParams()
  const goBack = useGoBack('/sales')
  const toast = useToast()
  const { settings } = useSettings()
  const load = useCallback(() => getSales().detail(id), [id])
  const { data, error, loading, reload } = useAsync(load)
  const canCosts = useCan('costs.view')
  const canCancel = useCan('sales.cancel')
  const canReturn = useCan('returns.sale')
  const [asking, setAsking] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [reason, setReason] = useState('')

  if (error && data === undefined) {
    return (
      <>
        <PageHeader title="فاکتور فروش" onBack={goBack} />
        <EmptyState icon="alert" title="فاکتور باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      </>
    )
  }
  if (loading || data === undefined) return <PageHeader title="فاکتور فروش" onBack={goBack} />
  if (data === null) {
    return (
      <>
        <PageHeader title="فاکتور فروش" onBack={goBack} />
        <EmptyState icon="help" title="فاکتور پیدا نشد" description="این فاکتور وجود ندارد یا نشانی اشتباه است." action={<ButtonLink to="/sales">فهرست فروش‌ها</ButtonLink>} />
      </>
    )
  }

  const { invoice, items, customer, warehouse } = data
  const cancelled = invoice.status === 'cancelled'
  const lineSum = items.reduce((s, i) => s + i.lineTotal, 0)
  const costSum = items.reduce((s, i) => s + pickCost(i.costs, settings.costMethod), 0)
  const received = invoice.totalAmount
  const profit = received - costSum

  return (
    <>
      <PageHeader title={`فاکتور فروش ${toPersianDigits(invoice.invoiceNumber)}`} onBack={goBack} actions={cancelled ? <Badge tone="error">ابطال‌شده</Badge> : undefined} />
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
          کالاهای این فاکتور به انبار برگشت.
        </div>
      )}
      <div className={styles.card}>
        <dl className={styles.info}>
          <dt>مشتری</dt>
          <dd>{customer?.name ?? '—'}</dd>
          <dt>انبار</dt>
          <dd>{warehouse?.name ?? '—'}</dd>
          <dt>تاریخ</dt>
          <dd>{formatPersianDateTime(invoice.invoiceDate)}</dd>
        </dl>
      </div>
      <div className={styles.card}>
        {items.map((it) => {
          const cost = pickCost(it.costs, settings.costMethod)
          return (
            <div key={it.id} className={styles.item}>
              <div className={styles.itemHead}>
                <strong>{it.product?.name ?? 'کالای حذف‌شده'}</strong>
                <strong>{formatMoney(it.lineTotal)}</strong>
              </div>
              <div className={styles.itemMeta}>
                <span>
                  {it.unitId ? (
                    <>
                      {formatQuantityWithUnit(it.unitQuantity, it.unitName)} ({formatQuantityWithUnit(it.quantity, it.product?.unitName ?? '')})
                    </>
                  ) : (
                    formatQuantityWithUnit(it.quantity, it.product?.unitName ?? '')
                  )}{' '}
                  {it.priceMode === 'total' ? <>· مبلغ کل · هر {it.unitName} ≈ {formatMoney(it.unitPrice)}</> : <>× {formatMoney(it.unitPrice)}</>}
                </span>
                {it.discount > 0 && <span>تخفیف ردیف: {formatMoney(it.discount)}</span>}
              </div>
              {canCosts && (
                <div className={styles.itemMeta}>
                  <span>
                    بهای تمام‌شده ({costMethodLabel(settings.costMethod).split(' ')[0]}): {formatMoney(cost)}
                  </span>
                </div>
              )}
            </div>
          )
        })}
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
          <span>مبلغ فاکتور</span>
          <strong data-testid="invoice-total">{formatMoney(received)}</strong>
        </div>
        {canCosts && (
          <>
            <div>
              <span>بهای تمام‌شده</span>
              <strong>{formatMoney(costSum)}</strong>
            </div>
            <div>
              <span>سود این فاکتور</span>
              <strong data-testid="invoice-profit">{formatMoney(profit)}</strong>
            </div>
          </>
        )}
      </div>
      <InvoicePaymentCard kind="sales" invoiceId={invoice.id} partyId={invoice.customerId} systemParty={!!customer?.isSystem} cancelled={cancelled} />
      <div className={styles.actionStack}>
        <ButtonLink variant="secondary" icon="printer" block to={`/sales/${id}/print`}>
          چاپ / PDF فاکتور
        </ButtonLink>
      </div>
      {!cancelled && (
        <div className={styles.actionStack}>
          {canReturn && (
            <ButtonLink variant="secondary" icon="plus" block to={`/sales/${id}/return`}>
              برگشت کالا از این فاکتور
            </ButtonLink>
          )}
          {canCancel && (
            <Button variant="danger" icon="trash" block onClick={() => setAsking(true)}>
              ابطال فاکتور
            </Button>
          )}
        </div>
      )}

      <Sheet open={asking && !confirm} title="ابطال فاکتور فروش" onClose={() => setAsking(false)}>
        <div className={styles.sheetBody}>
          <p className={styles.muted}>با ابطال، کالاها به همان لایه‌های قبلی برمی‌گردند و فاکتور با نشان «ابطال‌شده» در فهرست می‌ماند. فاکتور حذف نمی‌شود.</p>
          <Field label="دلیل ابطال" htmlFor="cancel-reason" hint="اختیاری؛ مثلاً «اشتباه در تعداد»">
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
        message={`فاکتور فروش ${toPersianDigits(invoice.invoiceNumber)} ابطال می‌شود و این کار برگشت ندارد.`}
        confirmLabel="بله، ابطال شود"
        onConfirm={async () => {
          await getSales().cancel(invoice.id, reason)
          setConfirm(false)
          setAsking(false)
          toast.show('فاکتور ابطال شد و موجودی برگشت.')
          reload()
        }}
        onCancel={() => setConfirm(false)}
      />
    </>
  )
}
