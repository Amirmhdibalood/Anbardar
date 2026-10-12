import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { InvoiceEditor } from '../components/invoice/InvoiceEditor'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/Toast'
import { SETTING_KEYS } from '../database/seed'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { MISC_SUPPLIER_ID } from '../models/party'
import { getApp, getCatalog, getPurchases } from '../services/appContext'
import { toPersianDigits } from '../utils/persian'

/** ثبت فاکتور خرید: موجودی انبار انتخاب‌شده زیاد می‌شود و هر ردیف یک لایه بها می‌سازد */
export default function NewPurchasePage() {
  const navigate = useNavigate()
  const toast = useToast()
  const goBack = useGoBack('/purchases')
  const load = useCallback(async () => {
    const catalog = getCatalog()
    const [suppliers, warehouses, defaultWarehouseId] = await Promise.all([
      catalog.suppliers.list({ includeInactive: true }),
      catalog.warehouses.list(),
      getApp().repos.settings.getValue(SETTING_KEYS.defaultWarehouseId),
    ])
    // «متفرقه» اول فهرست
    suppliers.sort((a, b) => Number(b.isSystem) - Number(a.isSystem))
    const warehouseId = warehouses.find((w) => w.id === defaultWarehouseId)?.id ?? warehouses[0]?.id ?? ''
    return { suppliers, warehouses, warehouseId }
  }, [])
  const { data, error, reload } = useAsync(load)

  if (error && !data) {
    return (
      <>
        <PageHeader title="ثبت خرید" onBack={goBack} />
        <EmptyState icon="alert" title="فرم خرید باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      </>
    )
  }
  if (!data) return <PageHeader title="ثبت خرید" onBack={goBack} />

  return (
    <InvoiceEditor
      kind="purchase"
      title="ثبت خرید"
      partyLabel="تأمین‌کننده"
      parties={data.suppliers}
      defaultPartyId={MISC_SUPPLIER_ID}
      warehouses={data.warehouses}
      defaultWarehouseId={data.warehouseId}
      showReference
      createParty={(input) => getCatalog().suppliers.create(input)}
      suggestPrice={(p) => getPurchases().lastPurchasePrice(p.id)}
      submitLabel="ثبت خرید"
      totalLabel="مبلغ پرداختی"
      onBack={goBack}
      onSubmit={async (input) => {
        const { invoice } = await getPurchases().create({ ...input, supplierId: input.partyId })
        toast.show(`فاکتور خرید ${toPersianDigits(invoice.invoiceNumber)} ثبت شد.`)
        navigate(`/purchases/${invoice.id}`, { replace: true })
      }}
    />
  )
}
