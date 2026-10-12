import { useCallback } from 'react'
import { getSales } from '../services/appContext'
import type { InvoiceListFilter } from '../services/purchaseService'
import { InvoiceListView } from './invoices/InvoiceListView'

export default function SalesPage() {
  const load = useCallback(async (filter: InvoiceListFilter) => {
    const rows = await getSales().list(filter)
    return rows.map((r) => ({
      id: r.invoice.id,
      invoiceNumber: r.invoice.invoiceNumber,
      partyName: r.customerName,
      itemCount: r.itemCount,
      totalAmount: r.invoice.totalAmount,
      invoiceDate: r.invoice.invoiceDate,
      status: r.invoice.status,
    }))
  }, [])
  return (
    <InvoiceListView
      title="فاکتورهای فروش"
      icon="cart"
      basePath="/sales"
      newPath="/sales/new"
      newLabel="ثبت فروش"
      emptyTitle="هنوز فروشی ثبت نشده"
      emptyDescription="با ثبت فاکتور فروش، موجودی کم می‌شود و بهای تمام‌شده برای گزارش سود ذخیره می‌شود."
      load={load}
    />
  )
}
