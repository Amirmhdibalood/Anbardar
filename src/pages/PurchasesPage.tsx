import { useCallback } from 'react'
import { getPurchases } from '../services/appContext'
import type { InvoiceListFilter } from '../services/purchaseService'
import { InvoiceListView } from './invoices/InvoiceListView'

export default function PurchasesPage() {
  const load = useCallback(async (filter: InvoiceListFilter) => {
    const rows = await getPurchases().list(filter)
    return rows.map((r) => ({
      id: r.invoice.id,
      invoiceNumber: r.invoice.invoiceNumber,
      partyName: r.supplierName,
      itemCount: r.itemCount,
      totalAmount: r.invoice.totalAmount,
      invoiceDate: r.invoice.invoiceDate,
      status: r.invoice.status,
    }))
  }, [])
  return (
    <InvoiceListView
      title="فاکتورهای خرید"
      icon="truck"
      basePath="/purchases"
      newPath="/purchases/new"
      newLabel="ثبت خرید"
      emptyTitle="هنوز خریدی ثبت نشده"
      emptyDescription="با ثبت فاکتور خرید، موجودی انبار زیاد می‌شود و بهای کالاها برای محاسبه سود ثبت می‌شود."
      load={load}
    />
  )
}
