import { formatPersianDateTime } from '../utils/date'
import { formatMoney } from '../utils/money'
import { toPersianDigits } from '../utils/persian'
import { formatQuantityWithUnit } from '../utils/quantity'
import type { PurchaseDetail } from './purchaseService'
import type { SaleDetail } from './saleService'

/** مدل چاپی مشترک فاکتور (برای صفحه چاپ و PDF) */
export interface PrintableInvoice {
  kind: 'sale' | 'purchase'
  title: string
  fileName: string
  meta: { label: string; value: string }[]
  rows: { no: string; name: string; quantity: string; unitPrice: string; discount: string; total: string }[]
  totals: { label: string; value: string; strong?: boolean }[]
  note: string | null
  cancelled: boolean
}

type Detail = SaleDetail | PurchaseDetail

export function toPrintable(kind: 'sale' | 'purchase', d: Detail): PrintableInvoice {
  const inv = d.invoice
  const sale = kind === 'sale'
  const party = sale ? (d as SaleDetail).customer : (d as PurchaseDetail).supplier
  const no = toPersianDigits(inv.invoiceNumber)
  const meta = [
    { label: 'شماره فاکتور', value: no },
    { label: 'تاریخ', value: formatPersianDateTime(inv.invoiceDate) },
    { label: sale ? 'مشتری' : 'تأمین‌کننده', value: party?.name ?? '—' },
    { label: 'انبار', value: d.warehouse?.name ?? '—' },
  ]
  if (inv.reference) meta.push({ label: 'شماره مرجع', value: toPersianDigits(inv.reference) })
  const rows = d.items.map((it, i) => ({
    no: toPersianDigits(i + 1),
    name: it.product?.name ?? 'کالا',
    quantity: formatQuantityWithUnit(it.unitQuantity, it.unitName),
    unitPrice: it.priceMode === 'total' ? '—' : formatMoney(it.unitPrice, { withUnit: false }),
    discount: it.discount ? formatMoney(it.discount, { withUnit: false }) : '—',
    total: formatMoney(it.lineTotal, { withUnit: false }),
  }))
  const totals: PrintableInvoice['totals'] = [{ label: 'جمع ردیف‌ها', value: formatMoney(inv.subtotalAmount) }]
  if (inv.discount) totals.push({ label: 'تخفیف فاکتور', value: formatMoney(inv.discount) })
  totals.push({ label: 'مبلغ قابل پرداخت', value: formatMoney(inv.totalAmount), strong: true })
  if (!sale && (d as PurchaseDetail).invoice.landedTotal) {
    totals.push({ label: 'هزینه‌های جانبی (جدا از بدهی)', value: formatMoney((d as PurchaseDetail).invoice.landedTotal) })
  }
  return {
    kind,
    title: `${sale ? 'فاکتور فروش' : 'فاکتور خرید'} ${no}`,
    fileName: `anbardar-${sale ? 'sale' : 'purchase'}-${inv.invoiceNumber}.pdf`,
    meta,
    rows,
    totals,
    note: inv.note,
    cancelled: inv.status === 'cancelled',
  }
}
