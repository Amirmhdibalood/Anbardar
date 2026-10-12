import { useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { InvoiceEditor } from '../components/invoice/InvoiceEditor'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/Toast'
import { SETTING_KEYS } from '../database/seed'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { useSettings } from '../hooks/useSettings'
import { getApp, getCatalog, getSales } from '../services/appContext'
import { salePriceModeLabel, suggestSaleUnitPrice } from '../services/pricing'
import { toPersianDigits } from '../utils/persian'
import styles from '../components/invoice/Invoice.module.css'

/** ثبت فاکتور فروش: موجودی کم می‌شود، لایه‌ها با FIFO مصرف می‌شوند و بها به سه روش ذخیره می‌شود */
export default function NewSalePage() {
  const navigate = useNavigate()
  const toast = useToast()
  const goBack = useGoBack('/')
  const { settings } = useSettings()
  const load = useCallback(async () => {
    const catalog = getCatalog()
    const [customers, warehouses, defaultWarehouseId, defaultCustomerId] = await Promise.all([
      catalog.customers.list({ includeInactive: true }),
      catalog.warehouses.list(),
      getApp().repos.settings.getValue(SETTING_KEYS.defaultWarehouseId),
      getApp().repos.settings.getValue(SETTING_KEYS.defaultCustomerId),
    ])
    customers.sort((a, b) => Number(b.isSystem) - Number(a.isSystem))
    const warehouseId = warehouses.find((w) => w.id === defaultWarehouseId)?.id ?? warehouses[0]?.id ?? ''
    const customerId = customers.find((c) => c.id === defaultCustomerId)?.id ?? customers[0]?.id ?? ''
    return { customers, warehouses, warehouseId, customerId }
  }, [])
  const { data, error, reload } = useAsync(load)

  if (error && !data) {
    return (
      <>
        <PageHeader title="ثبت فروش" onBack={goBack} />
        <EmptyState icon="alert" title="فرم فروش باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      </>
    )
  }
  if (!data) return <PageHeader title="ثبت فروش" onBack={goBack} />

  return (
    <InvoiceEditor
      kind="sale"
      title="ثبت فروش"
      partyLabel="مشتری"
      parties={data.customers}
      defaultPartyId={data.customerId}
      warehouses={data.warehouses}
      defaultWarehouseId={data.warehouseId}
      checkStock
      createParty={(input) => getCatalog().customers.create(input)}
      suggestPrice={(p) => suggestSaleUnitPrice(getApp().db, p, settings)}
      priceHint={() => `پیشنهاد: ${salePriceModeLabel(settings.salePriceMode)}`}
      lineExtra={() => (
        <p className={styles.discountHint}>
          <Link to="/more/price-calculator">ماشین‌حساب قیمت</Link> برای محاسبه حداقل قیمت فروش با درصد سود.
        </p>
      )}
      submitLabel="ثبت فروش"
      totalLabel="جمع فاکتور"
      onBack={goBack}
      onSubmit={async (input) => {
        const { invoice } = await getSales().create({ ...input, customerId: input.partyId })
        toast.show(`فاکتور فروش ${toPersianDigits(invoice.invoiceNumber)} ثبت شد.`)
        navigate(`/sales/${invoice.id}`, { replace: true })
      }}
    />
  )
}
