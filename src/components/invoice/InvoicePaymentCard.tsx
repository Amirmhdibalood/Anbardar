import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../../hooks/useAsync'
import type { InvoiceKind } from '../../models/invoice'
import { MONEY_KIND_LABELS, PAYMENT_STATUS_LABELS } from '../../models/money'
import { getMoney } from '../../services/appContext'
import { formatPersianDateTime } from '../../utils/date'
import { formatMoney } from '../../utils/money'
import { toPersianDigits } from '../../utils/persian'
import { Badge } from '../Badge'
import { ButtonLink } from '../Button'
import styles from '../../pages/invoices/Invoices.module.css'

interface Props {
  kind: InvoiceKind
  invoiceId: string
  partyId: string
  /** طرف سیستمی (نقدی/متفرقه) همیشه کامل پرداخت می‌کند */
  systemParty: boolean
  cancelled: boolean
}

/** وضعیت پرداخت فاکتور: پرداخت‌شده، مانده و اسناد مرتبط (همیشه از اسناد محاسبه می‌شود) */
export function InvoicePaymentCard({ kind, invoiceId, partyId, systemParty, cancelled }: Props) {
  const load = useCallback(async () => {
    const [settlement, docs] = await Promise.all([getMoney().invoiceSettlement(kind, invoiceId), getMoney().documentsForInvoice(kind, invoiceId)])
    return { settlement, docs }
  }, [kind, invoiceId])
  const { data } = useAsync(load)
  if (!data?.settlement || cancelled) return null
  const { settlement: s, docs } = data
  const paidWord = kind === 'sales' ? 'دریافت‌شده' : 'پرداخت‌شده'
  const tone = s.status === 'paid' ? 'success' : s.status === 'partial' ? 'warning' : 'error'

  return (
    <div className={`${styles.card} ${styles.totals}`} data-testid="invoice-payment">
      <div>
        <span>وضعیت پرداخت</span>
        <Badge tone={tone}>{PAYMENT_STATUS_LABELS[s.status]}</Badge>
      </div>
      {s.returned > 0 && (
        <div>
          <span>برگشت‌ها</span>
          <strong>{formatMoney(s.returned)}</strong>
        </div>
      )}
      <div>
        <span>{paidWord}</span>
        <strong data-testid="invoice-paid">{formatMoney(s.settled)}</strong>
      </div>
      <div className={styles.grand}>
        <span>مانده</span>
        <strong data-testid="invoice-remaining">{formatMoney(s.remaining)}</strong>
      </div>
      {docs
        .filter((d) => d.document.status === 'active')
        .map(({ document: d, amount }) => (
          <div key={d.id}>
            <Link to={`/money/${d.id}`}>
              {MONEY_KIND_LABELS[d.kind]} {toPersianDigits(d.docNumber)} | {formatPersianDateTime(d.docDate)}
            </Link>
            <span>{formatMoney(amount)}</span>
          </div>
        ))}
      {s.remaining > 0 && !systemParty && (
        <ButtonLink icon="wallet" block to={`/money/new?kind=${kind === 'sales' ? 'receipt' : 'payment'}&party=${partyId}&invoice=${invoiceId}&lock=1`}>
          {kind === 'sales' ? 'ثبت دریافت برای این فاکتور' : 'ثبت پرداخت برای این فاکتور'}
        </ButtonLink>
      )}
    </div>
  )
}
