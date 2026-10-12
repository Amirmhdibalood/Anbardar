import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge } from '../../components/Badge'
import { Button, ButtonLink, IconLink } from '../../components/Button'
import { Chip } from '../../components/Chip'
import { EmptyState } from '../../components/EmptyState'
import { Icon, type IconName } from '../../components/Icon'
import { PageHeader } from '../../components/PageHeader'
import { useAsync } from '../../hooks/useAsync'
import { useGoBack } from '../../hooks/useGoBack'
import type { InvoiceStatus } from '../../models/invoice'
import { PAYMENT_STATUS_LABELS, type PaymentStatus } from '../../models/money'
import type { InvoiceListFilter } from '../../services/purchaseService'
import { formatPersianDateTime } from '../../utils/date'
import { formatMoney } from '../../utils/money'
import { formatInteger, toPersianDigits } from '../../utils/persian'
import products from '../ProductsPage.module.css'
import styles from './Invoices.module.css'

export interface InvoiceListRow {
  id: string
  invoiceNumber: number
  partyName: string
  itemCount: number
  totalAmount: number
  invoiceDate: string
  status: InvoiceStatus
  /** وضعیت پرداخت (فقط فاکتور فعال) */
  payment?: PaymentStatus
}

interface Props {
  title: string
  icon: IconName
  basePath: string
  newPath: string
  newLabel: string
  emptyTitle: string
  emptyDescription: string
  load: (filter: InvoiceListFilter) => Promise<InvoiceListRow[]>
}

const PAGE = 50

/** فهرست فاکتورها (خرید/فروش): جستجو (شماره، طرف حساب، شماره مرجع)، فیلتر وضعیت و «بیشتر» */
export function InvoiceListView({ title, icon, basePath, newPath, newLabel, emptyTitle, emptyDescription, load }: Props) {
  const goBack = useGoBack('/more')
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const status = (params.get('s') as InvoiceStatus | null) ?? undefined
  const [text, setText] = useState(search)
  const filterKey = `${search}|${status ?? ''}`
  const [limitState, setLimitState] = useState({ key: filterKey, value: PAGE })
  const limit = limitState.key === filterKey ? limitState.value : PAGE
  const loader = useCallback(() => load({ search, status, limit: limit + 1 }), [load, search, status, limit])
  const { data, error, loading, reload } = useAsync(loader)
  const set = useCallback(
    (key: string, value: string | undefined) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (value) next.set(key, value)
          else next.delete(key)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  // جستجو با تأخیر کوتاه به آدرس منتقل می‌شود تا هنگام تایپ سریع حرفی گم نشود
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (text.trim() !== search) set('q', text.trim() || undefined)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [text, search, set])
  const rows = data?.slice(0, limit) ?? []
  const filtered = !!search || !!status

  return (
    <div className={products.page}>
      <PageHeader title={title} onBack={goBack} actions={<IconLink icon="plus" label={newLabel} to={newPath} />} />
      <label className={products.search}>
        <Icon name="search" size={18} />
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="شماره فاکتور، نام یا شماره مرجع" aria-label="جستجوی فاکتور" />
      </label>
      <div className={products.chips}>
        <Chip label="همه" selected={!status} onClick={() => set('s', undefined)} />
        <Chip label="فعال" selected={status === 'active'} onClick={() => set('s', 'active')} />
        <Chip label="ابطال‌شده" selected={status === 'cancelled'} onClick={() => set('s', 'cancelled')} />
      </div>
      {error && !data ? (
        <EmptyState icon="alert" title="فهرست باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      ) : loading || !data ? (
        <div aria-busy="true" className={styles.skeleton} />
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState compact icon="search" title="فاکتوری پیدا نشد" description="جستجو یا فیلتر را تغییر دهید." />
        ) : (
          <EmptyState icon={icon} title={emptyTitle} description={emptyDescription} action={<ButtonLink to={newPath} icon="plus">{newLabel}</ButtonLink>} />
        )
      ) : (
        <ul className={styles.list}>
          {rows.map((r) => (
            <li key={r.id}>
              <Link to={`${basePath}/${r.id}`} className={`${styles.row} ${r.status === 'cancelled' ? styles.cancelled : ''}`}>
                <span className={styles.number}>{toPersianDigits(r.invoiceNumber)}</span>
                <span className={styles.main}>
                  <strong>{r.partyName}</strong>
                  <span>
                    {formatPersianDateTime(r.invoiceDate)} | {formatInteger(r.itemCount)} قلم
                  </span>
                </span>
                <span className={styles.amount}>
                  <strong>{formatMoney(r.totalAmount, { withUnit: false })}</strong>
                  {r.status === 'cancelled' ? (
                    <Badge tone="error">ابطال‌شده</Badge>
                  ) : r.payment && r.payment !== 'paid' ? (
                    <Badge tone="warning">{PAYMENT_STATUS_LABELS[r.payment]}</Badge>
                  ) : (
                    <span>تومان</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data && data.length > limit && (
        <Button variant="secondary" block onClick={() => setLimitState({ key: filterKey, value: limit + PAGE })}>
          نمایش بیشتر
        </Button>
      )}
    </div>
  )
}
