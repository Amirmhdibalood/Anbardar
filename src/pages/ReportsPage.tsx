import { useCallback, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Chip } from '../components/Chip'
import { EmptyState } from '../components/EmptyState'
import { Field } from '../components/Field'
import { JalaliDatePicker } from '../components/JalaliDatePicker'
import { PageHeader } from '../components/PageHeader'
import { Picker } from '../components/Picker'
import { PieChart, type ChartSlice } from '../components/PieChart'
import { useAsync } from '../hooks/useAsync'
import { useSettings } from '../hooks/useSettings'
import { expenseCategoryLabel } from '../models/expense'
import { getCatalog, getPurchases, getReports, getSales } from '../services/appContext'
import { costMethodLabel } from '../services/pricing'
import type { IncomeSpending, ProductProfitRow, ProfitLoss, StockAlerts } from '../services/reportService'
import { formatPersianDateTime } from '../utils/date'
import { formatMoney } from '../utils/money'
import { formatInteger } from '../utils/persian'
import {
  PERIOD_KEYS,
  PERIOD_LABELS,
  jalaliToParam,
  periodFromParams,
  resolvePeriod,
  type PeriodKey,
} from '../utils/period'
import { formatQuantityWithUnit } from '../utils/quantity'
import type { JalaliDate } from '../utils/jalali'
import styles from './ReportsPage.module.css'

type Tab = 'summary' | 'products' | 'sales' | 'purchases' | 'alerts'

const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: 'سود و زیان' },
  { id: 'products', label: 'کالاها' },
  { id: 'sales', label: 'فروش' },
  { id: 'purchases', label: 'خرید' },
  { id: 'alerts', label: 'هشدار موجودی' },
]

/** گزارش‌ها: سود و زیان، نمودار درآمد/هزینه، کالا، فروش، خرید، هشدار موجودی */
export default function ReportsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('t') as Tab | null) ?? 'summary'
  const spec = periodFromParams(params)
  const period = resolvePeriod(spec)

  const setTab = (t: Tab) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (t === 'summary') next.delete('t')
        else next.set('t', t)
        return next
      },
      { replace: true },
    )

  const setPeriodKey = (key: PeriodKey) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (key === 'month') next.delete('p')
        else next.set('p', key)
        if (key !== 'custom') {
          next.delete('from')
          next.delete('to')
        } else {
          next.set('from', jalaliToParam(period.firstDay))
          next.set('to', jalaliToParam(period.lastDay))
        }
        return next
      },
      { replace: true },
    )

  const setCustomDay = (which: 'from' | 'to', day: JalaliDate) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('p', 'custom')
        next.set(which, jalaliToParam(day))
        if (!next.get(which === 'from' ? 'to' : 'from')) next.set(which === 'from' ? 'to' : 'from', jalaliToParam(day))
        return next
      },
      { replace: true },
    )

  return (
    <div className={styles.page} data-testid="reports-page">
      <PageHeader title="گزارش‌ها" />
      <div className={styles.tabs} role="tablist" aria-label="بخش گزارش">
        {TABS.map((t) => (
          <Chip key={t.id} label={t.label} selected={tab === t.id} onClick={() => setTab(t.id)} />
        ))}
      </div>
      <Link to="/balances" className={styles.balancesLink} data-testid="balances-link">
        بدهکاران و بستانکاران ←
      </Link>

      {tab !== 'alerts' && (
        <>
          <div className={styles.presets}>
            {PERIOD_KEYS.map((k) => (
              <Chip key={k} label={PERIOD_LABELS[k]} selected={spec.key === k} onClick={() => setPeriodKey(k)} />
            ))}
          </div>
          {spec.key === 'custom' && (
            <div className={styles.range}>
              <div>
                <div className={styles.rangeLabel}>از تاریخ</div>
                <JalaliDatePicker id="rep-from" value={period.firstDay} onChange={(d) => setCustomDay('from', d)} title="از تاریخ" />
              </div>
              <span className={styles.rangeSep}>تا</span>
              <div>
                <div className={styles.rangeLabel}>تا تاریخ</div>
                <JalaliDatePicker id="rep-to" value={period.lastDay} onChange={(d) => setCustomDay('to', d)} title="تا تاریخ" />
              </div>
            </div>
          )}
          <p className={styles.hint}>{period.label}</p>
        </>
      )}

      {tab === 'summary' && <SummaryTab from={period.from} to={period.to} />}
      {tab === 'products' && <ProductsTab from={period.from} to={period.to} />}
      {tab === 'sales' && <InvoicesTab kind="sales" from={period.from} to={period.to} />}
      {tab === 'purchases' && <InvoicesTab kind="purchases" from={period.from} to={period.to} />}
      {tab === 'alerts' && <AlertsTab />}
    </div>
  )
}

function SummaryTab({ from, to }: { from: string; to: string }) {
  const { settings } = useSettings()
  const load = useCallback(async () => {
    const reports = getReports()
    const range = { from, to }
    const [pl, cash] = await Promise.all([reports.profitLoss(range, settings.costMethod), reports.incomeSpending(range)])
    return { pl, cash }
  }, [from, to, settings.costMethod])
  const { data, error, loading, reload } = useAsync(load)

  if (error && !data) return <EmptyState icon="alert" title="گزارش باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
  if (loading || !data) return <div className={styles.skeleton} aria-busy="true" />

  const { pl, cash } = data as { pl: ProfitLoss; cash: IncomeSpending }
  const pie: ChartSlice[] = [
    { key: 'income', label: 'درآمد فروش', amount: cash.income, tone: 'success' },
    { key: 'purchases', label: 'خرید کالا', amount: cash.purchases, tone: 'warning' },
    { key: 'opex', label: 'هزینه عملیاتی', amount: cash.expenseTotal, tone: 'error' },
  ]

  return (
    <>
      <div className={styles.card} data-testid="pl-summary">
        <div className={styles.cardTitle}>خلاصه سود و زیان</div>
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span>درآمد فروش</span>
            <strong className={styles.sales}>{formatMoney(pl.revenue)}</strong>
          </div>
          <div className={styles.metric}>
            <span>بهای تمام‌شده کالا (COGS)</span>
            <strong className={styles.cost}>{formatMoney(pl.cogs)}</strong>
          </div>
          <div className={`${styles.metric} ${pl.grossProfit >= 0 ? styles.positive : styles.negative}`}>
            <span>سود ناخالص</span>
            <strong>{formatMoney(pl.grossProfit)}</strong>
          </div>
          {(pl.shortage.cost > 0 || pl.waste.cost > 0 || pl.surplus.cost > 0) && (
            <>
              {pl.shortage.cost > 0 && (
                <div className={styles.metric}>
                  <span>کسری</span>
                  <strong className={styles.cost}>{formatMoney(pl.shortage.cost)}</strong>
                </div>
              )}
              {pl.waste.cost > 0 && (
                <div className={styles.metric}>
                  <span>ضایعات / خرابی</span>
                  <strong className={styles.cost}>{formatMoney(pl.waste.cost)}</strong>
                </div>
              )}
              {pl.surplus.cost > 0 && (
                <div className={styles.metric}>
                  <span>اضافه در شمارش</span>
                  <strong className={styles.sales}>{formatMoney(pl.surplus.cost)}</strong>
                </div>
              )}
            </>
          )}
          <div className={styles.metric}>
            <span>هزینه عملیاتی</span>
            <strong className={styles.cost}>{formatMoney(pl.expenseTotal)}</strong>
          </div>
          <div className={`${styles.metric} ${styles.grand} ${pl.netProfit >= 0 ? styles.positive : styles.negative}`}>
            <span>سود خالص</span>
            <strong data-testid="net-profit">{formatMoney(pl.netProfit)}</strong>
          </div>
        </div>
        <p className={styles.hint}>
          روش بها: {costMethodLabel(settings.costMethod)}. بهای تمام‌شده از هزینه ذخیره‌شده روی ردیف‌های فروش خوانده می‌شود و جدا از هزینه عملیاتی (اجاره و حقوق و …) و جدا از مبلغ خرید کالاست.
        </p>
        {pl.expenses.length > 0 && (
          <ul className={styles.catList} data-testid="opex-by-category">
            {pl.expenses.map((c) => (
              <li key={c.category}>
                <span>
                  {expenseCategoryLabel(c.category, true)} ({formatInteger(c.count)})
                </span>
                <strong>{formatMoney(c.amount, { withUnit: false })}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>درآمد در برابر هزینه (نقدی)</div>
        <PieChart slices={pie} />
        <p className={styles.hint}>
          سبز: دریافتی فروش · نارنجی: پرداختی خرید کالا · قرمز: هزینه عملیاتی. تراز نقدی این بازه:{' '}
          <strong className={cash.balance >= 0 ? styles.sales : styles.cost}>{formatMoney(cash.balance)}</strong>
        </p>
      </div>
    </>
  )
}

function ProductsTab({ from, to }: { from: string; to: string }) {
  const { settings } = useSettings()
  const load = useCallback(() => getReports().productProfit({ from, to }, settings.costMethod), [from, to, settings.costMethod])
  const { data, error, loading, reload } = useAsync(load)

  if (error && !data) return <EmptyState icon="alert" title="گزارش باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
  if (loading || !data) return <div className={styles.skeleton} aria-busy="true" />
  if (data.length === 0) {
    return <EmptyState compact icon="box" title="در این بازه فروشی نبوده" description="با ثبت فروش، سود هر کالا اینجا دیده می‌شود." />
  }

  return (
    <div className={styles.card} data-testid="product-profits">
      <div className={styles.cardTitle}>سود هر کالا</div>
      <p className={styles.hint}>خاکستری = بها · سبز = مبلغ فروش · کنارشان سود</p>
      {data.map((row: ProductProfitRow) => (
        <div key={row.productId} className={styles.productRow}>
          <div className={styles.productHead}>
            <strong>{row.product?.name ?? 'کالای حذف‌شده'}</strong>
            <span className={row.profit >= 0 ? styles.profitPos : styles.profitNeg}>{formatMoney(row.profit)}</span>
          </div>
          <div className={styles.productMeta}>
            <span className={styles.cost}>بها: {formatMoney(row.cost, { withUnit: false })}</span>
            <span className={styles.sales}>فروش: {formatMoney(row.sales, { withUnit: false })}</span>
            {row.product && <span>کد {row.product.code}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function InvoicesTab({ kind, from, to }: { kind: 'sales' | 'purchases'; from: string; to: string }) {
  const [partyId, setPartyId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const partiesLoad = useCallback(async () => {
    const catalog = getCatalog()
    const [parties, warehouses] = await Promise.all([
      kind === 'sales' ? catalog.customers.list() : catalog.suppliers.list(),
      catalog.warehouses.list(),
    ])
    return { parties, warehouses }
  }, [kind])
  const { data: meta } = useAsync(partiesLoad)

  const load = useCallback(async () => {
    const filter = { from, to, status: 'active' as const, limit: 200 }
    if (kind === 'sales') {
      const rows = await getSales().list(filter)
      return rows
        .filter((r) => (!partyId || r.invoice.customerId === partyId) && (!warehouseId || r.invoice.warehouseId === warehouseId))
        .map((r) => ({
          id: r.invoice.id,
          invoiceNumber: r.invoice.invoiceNumber,
          partyName: r.customerName,
          warehouseId: r.invoice.warehouseId,
          invoiceDate: r.invoice.invoiceDate,
          totalAmount: r.invoice.totalAmount,
          itemCount: r.itemCount,
        }))
    }
    const rows = await getPurchases().list(filter)
    return rows
      .filter((r) => (!partyId || r.invoice.supplierId === partyId) && (!warehouseId || r.invoice.warehouseId === warehouseId))
      .map((r) => ({
        id: r.invoice.id,
        invoiceNumber: r.invoice.invoiceNumber,
        partyName: r.supplierName,
        warehouseId: r.invoice.warehouseId,
        invoiceDate: r.invoice.invoiceDate,
        totalAmount: r.invoice.totalAmount,
        itemCount: r.itemCount,
      }))
  }, [kind, from, to, partyId, warehouseId])
  const { data, error, loading, reload } = useAsync(load)

  const base = kind === 'sales' ? '/sales' : '/purchases'
  const partyLabel = kind === 'sales' ? 'مشتری' : 'تأمین‌کننده'
  const whName = (id: string) => meta?.warehouses.find((w) => w.id === id)?.name ?? '—'

  return (
    <>
      <div className={`${styles.card} ${styles.filters}`}>
        <Field label={partyLabel} htmlFor={`rep-${kind}-party`}>
          <Picker id={`rep-${kind}-party`} title={partyLabel} value={partyId} onChange={setPartyId} options={[{ value: '', label: 'همه' }, ...(meta?.parties ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        </Field>
        <Field label="انبار" htmlFor={`rep-${kind}-wh`}>
          <Picker id={`rep-${kind}-wh`} title="انبار" value={warehouseId} onChange={setWarehouseId} options={[{ value: '', label: 'همه' }, ...(meta?.warehouses ?? []).map((w) => ({ value: w.id, label: w.name }))]} />
        </Field>
      </div>

      {error && !data ? (
        <EmptyState icon="alert" title="گزارش باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      ) : loading || !data ? (
        <div className={styles.skeleton} aria-busy="true" />
      ) : data.length === 0 ? (
        <EmptyState compact icon={kind === 'sales' ? 'cart' : 'truck'} title="فاکتوری در این بازه نیست" description="فیلتر یا بازه تاریخ را تغییر دهید." />
      ) : (
        <div className={styles.card} data-testid={`${kind}-report`}>
          <div className={styles.cardTitle}>
            {kind === 'sales' ? 'گزارش فروش' : 'گزارش خرید'} ({formatInteger(data.length)} فاکتور)
          </div>
          <ul className={styles.invList}>
            {data.map((row) => (
              <li key={row.id}>
                <Link to={`${base}/${row.id}`} className={styles.invRow}>
                  <span className={styles.invNum}>{formatInteger(row.invoiceNumber)}</span>
                  <span className={styles.invMain}>
                    <strong>{row.partyName}</strong>
                    <span>
                      {formatPersianDateTime(row.invoiceDate)} | {whName(row.warehouseId)} | {formatInteger(row.itemCount)} قلم
                    </span>
                  </span>
                  <span className={styles.invAmount}>{formatMoney(row.totalAmount, { withUnit: false })}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function AlertsTab() {
  const load = useCallback(() => getReports().stockAlerts(), [])
  const { data, error, loading, reload } = useAsync(load)

  if (error && !data) return <EmptyState icon="alert" title="هشدارها باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
  if (loading || !data) return <div className={styles.skeleton} aria-busy="true" />

  const alerts = data as StockAlerts
  const all = [...alerts.out, ...alerts.low]
  if (all.length === 0) {
    return (
      <EmptyState
        icon="check"
        title="موجودی‌ها در وضع خوبی‌اند"
        description="هیچ کالای ناموجود یا زیر نقطه سفارش نیست."
        action={
          <Button variant="secondary" onClick={() => (window.location.hash = '#/stock')}>
            رفتن به موجودی
          </Button>
        }
      />
    )
  }

  return (
    <div className={styles.card} data-testid="stock-alerts">
      <div className={styles.cardTitle}>هشدار موجودی</div>
      <p className={styles.hint}>
        {formatInteger(alerts.out.length)} ناموجود · {formatInteger(alerts.low.length)} زیر نقطه سفارش — لمس کنید تا به موجودی بروید.
      </p>
      {all.map((row) => (
        <Link key={row.product.id} to="/stock?f=low" className={styles.alertRow}>
          <span className={styles.alertMain}>
            <strong>{row.product.name}</strong>
            <span>
              {formatQuantityWithUnit(row.quantity, row.product.unitName)} | نقطه سفارش{' '}
              {formatQuantityWithUnit(row.product.reorderPoint, row.product.unitName)}
            </span>
          </span>
          <Badge tone={row.status === 'out' ? 'error' : 'warning'}>{row.status === 'out' ? 'ناموجود' : 'کم‌موجودی'}</Badge>
        </Link>
      ))}
    </div>
  )
}
