import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, ButtonLink } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Field, QuantityInput } from '../components/Field'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { useLeaveConfirm } from '../hooks/useLeaveConfirm'
import { getReturns, getSales } from '../services/appContext'
import { toUserMessage, ValidationError } from '../utils/errors'
import { formatMoney } from '../utils/money'
import { formatQuantity, formatQuantityWithUnit, parseQuantityInput, quantityToInputText } from '../utils/quantity'
import { Picker } from '../components/Picker'
import { returnUnit } from '../services/returnForm'
import { toBaseQuantity } from '../utils/invoiceMath'
import styles from './Returns.module.css'

/** فرم برگشت از فاکتور فروش: انتخاب تعداد قابل برگشت هر ردیف */
export default function NewSaleReturnPage() {
  const { id = '' } = useParams()
  const goBack = useGoBack(`/sales/${id}`)
  const nav = useNavigate()
  const toast = useToast()
  const load = useCallback(async () => {
    const [invoice, returnable] = await Promise.all([getSales().detail(id), getReturns().saleReturnable(id)])
    return { invoice, returnable }
  }, [id])
  const { data, error, loading, reload } = useAsync(load)
  const [qtys, setQtys] = useState<Record<string, string>>({})
  /** واحد ورود هر ردیف: همان واحد فاکتور (line) یا واحد اصلی (base) */
  const [units, setUnits] = useState<Record<string, 'line' | 'base'>>({})
  const leave = useLeaveConfirm(Object.values(qtys).some((q) => q.trim() !== '' && q.trim() !== '0' && q.trim() !== '۰'), goBack)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const lines = useMemo(() => data?.returnable.filter((r) => r.remaining > 0) ?? [], [data])

  if (error && !data) {
    return (
      <>
        <PageHeader title="برگشت فروش" onBack={goBack} />
        <EmptyState icon="alert" title="باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      </>
    )
  }
  if (loading || !data) return <PageHeader title="برگشت فروش" onBack={goBack} />
  if (!data.invoice || data.invoice.invoice.status !== 'active') {
    return (
      <>
        <PageHeader title="برگشت فروش" onBack={goBack} />
        <EmptyState icon="help" title="فاکتور فعال نیست" description="فقط از فاکتور فروش فعال می‌توان برگشت ثبت کرد." action={<ButtonLink to={`/sales/${id}`}>جزئیات فاکتور</ButtonLink>} />
      </>
    )
  }

  const submit = async () => {
    setFormError(null)
    const parsed: { sourceItemId: string; quantity: number; unitId?: string | null }[] = []
    for (const row of lines) {
      const text = qtys[row.item.id] ?? ''
      if (!text.trim()) continue
      const ru = returnUnit(row, units[row.item.id])
      const q = parseQuantityInput(text, ru.allowsFraction)
      if (!q.ok) {
        setFormError('تعداد معتبر نیست.')
        return
      }
      const base = toBaseQuantity(q.value, ru.factor)
      if (base === null) {
        setFormError(`تعداد برگشت «${row.product?.name}» به واحد اصلی بیش از سه رقم اعشار می‌شود.`)
        return
      }
      if (base > row.remaining) {
        setFormError(`تعداد برگشت «${row.product?.name}» بیشتر از باقی‌مانده است.`)
        return
      }
      if (q.value > 0) parsed.push({ sourceItemId: row.item.id, quantity: q.value, unitId: ru.unitId })
    }
    if (!parsed.length) {
      setFormError('حداقل برای یک کالا تعداد برگشت وارد کنید.')
      return
    }
    setBusy(true)
    try {
      const ret = await getReturns().createSaleReturn({ salesInvoiceId: id, lines: parsed })
      toast.show('برگشت فروش ثبت شد.')
      nav(`/sales/${id}`, { replace: true })
      void ret
    } catch (e) {
      if (e instanceof ValidationError) setFormError(Object.values(e.fieldErrors)[0] ?? toUserMessage(e))
      else setFormError(toUserMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page} data-testid="sale-return-form">
      <PageHeader title="برگشت فروش" onBack={leave.back} />
      {leave.confirm}
      <p className={styles.hint}>کالایی که مشتری برگردانده را مشخص کنید. موجودی انبار زیاد می‌شود و بهای همان فروش روی لایه جدید می‌نشیند.</p>
      {lines.length === 0 ? (
        <EmptyState compact icon="check" title="چیزی برای برگشت نمانده" description="همه ردیف‌های این فاکتور قبلاً برگشت خورده‌اند." />
      ) : (
        <div className={styles.card}>
          {lines.map((row) => (
            <div key={row.item.id} className={styles.row}>
              <div className={styles.head}>
                <strong>{row.product?.name ?? 'کالا'}</strong>
                <span>{formatMoney(row.item.unitPrice)}</span>
              </div>
              <div className={styles.meta}>
                <span>
                  فروخته: {formatQuantityWithUnit(row.item.quantity, row.product?.unitName ?? '')}
                  {row.item.unitId ? ` (${formatQuantity(row.item.unitQuantity)} ${returnUnit(row, 'line').name})` : ''}
                </span>
                <span>قابل برگشت: {formatQuantityWithUnit(row.remaining, row.product?.unitName ?? '')}</span>
              </div>
              {row.item.unitId && (
                <Field label="واحد برگشت" htmlFor={`ru-${row.item.id}`}>
                  <Picker<'line' | 'base'>
                    id={`ru-${row.item.id}`}
                    title="واحد برگشت"
                    value={units[row.item.id] ?? 'line'}
                    onChange={(v) => setUnits((s) => ({ ...s, [row.item.id]: v }))}
                    options={[
                      { value: 'line', label: returnUnit(row, 'line').name, description: 'واحد فاکتور' },
                      { value: 'base', label: row.product?.unitName ?? '', description: 'واحد اصلی' },
                    ]}
                  />
                </Field>
              )}
              <Field label="تعداد برگشت" htmlFor={`rq-${row.item.id}`}>
                <QuantityInput
                  id={`rq-${row.item.id}`}
                  value={qtys[row.item.id] ?? ''}
                  onChange={(v) => setQtys((s) => ({ ...s, [row.item.id]: v }))}
                  placeholder={returnUnit(row, units[row.item.id]).factor === 1000 ? quantityToInputText(row.remaining) : '۰'}
                  suffix={returnUnit(row, units[row.item.id]).name}
                />
              </Field>
            </div>
          ))}
          {formError && (
            <p role="alert" style={{ color: 'var(--error)', fontSize: 13 }}>
              {formError}
            </p>
          )}
          <div className={styles.actions}>
            <Button variant="ghost" onClick={goBack} disabled={busy}>
              انصراف
            </Button>
            <Button onClick={submit} loading={busy} data-testid="sale-return-save">
              ثبت برگشت
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
