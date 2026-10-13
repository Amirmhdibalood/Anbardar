import { useCallback, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { getPurchases, getSales } from '../services/appContext'
import { toPrintable } from '../services/invoiceDocument'
import { toUserMessage } from '../utils/errors'
import styles from './InvoicePrintPage.module.css'

/** نمای چاپی فاکتور (فروش/خرید) + چاپ مرورگر + PDF */
export default function InvoicePrintPage() {
  const { id = '' } = useParams()
  const { pathname } = useLocation()
  const kind = pathname.startsWith('/purchases') ? 'purchase' : 'sale'
  const goBack = useGoBack(kind === 'sale' ? `/sales/${id}` : `/purchases/${id}`)
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const d = kind === 'sale' ? await getSales().detail(id) : await getPurchases().detail(id)
    return d ? toPrintable(kind, d) : null
  }, [id, kind])
  const { data: doc, error } = useAsync(load)

  const pdf = async () => {
    if (!doc || busy) return
    setBusy(true)
    try {
      const { shareInvoicePdf } = await import('../services/invoiceExport')
      const r = await shareInvoicePdf(doc)
      if (r === 'downloaded') toast.show('فایل PDF فاکتور دانلود شد.')
    } catch (e) {
      toast.show(toUserMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (error || doc === null) {
    return (
      <>
        <PageHeader title="چاپ فاکتور" onBack={goBack} />
        <EmptyState icon="alert" title="فاکتور پیدا نشد" description={error ?? 'این فاکتور وجود ندارد.'} />
      </>
    )
  }
  return (
    <div className={styles.screen}>
      <div className={styles.noPrint}>
        <PageHeader title="چاپ و PDF فاکتور" onBack={goBack} />
        <div className={styles.toolbar}>
          <Button icon="share" loading={busy} onClick={() => void pdf()} data-testid="invoice-pdf">
            PDF و اشتراک
          </Button>
          <Button variant="secondary" icon="printer" onClick={() => window.print()} data-testid="invoice-print">
            چاپ
          </Button>
        </div>
      </div>
      {doc && (
        <article className={styles.paper} data-testid="invoice-print-paper">
          <header className={styles.head}>
            <h1>{doc.title}</h1>
            <span className={styles.brand}>انباردار</span>
          </header>
          {doc.cancelled && <p className={styles.cancelled}>این فاکتور ابطال شده است</p>}
          <dl className={styles.meta}>
            {doc.meta.map((m) => (
              <div key={m.label}>
                <dt>{m.label}</dt>
                <dd>{m.value}</dd>
              </div>
            ))}
          </dl>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th className={styles.name}>کالا</th>
                <th>تعداد</th>
                <th>فی (تومان)</th>
                <th>تخفیف</th>
                <th>مبلغ (تومان)</th>
              </tr>
            </thead>
            <tbody>
              {doc.rows.map((r) => (
                <tr key={r.no}>
                  <td>{r.no}</td>
                  <td className={styles.name}>{r.name}</td>
                  <td>{r.quantity}</td>
                  <td>{r.unitPrice}</td>
                  <td>{r.discount}</td>
                  <td>{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className={styles.totals}>
            {doc.totals.map((t) => (
              <div key={t.label} data-strong={t.strong ?? false}>
                <dt>{t.label}</dt>
                <dd>{t.value}</dd>
              </div>
            ))}
          </dl>
          {doc.note && <p className={styles.note}>توضیح: {doc.note}</p>}
        </article>
      )}
    </div>
  )
}
