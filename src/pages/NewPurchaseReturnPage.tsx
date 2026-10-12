import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, ButtonLink } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Field, QuantityInput } from '../components/Field'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { getPurchases, getReturns } from '../services/appContext'
import { toUserMessage, ValidationError } from '../utils/errors'
import { formatMoney } from '../utils/money'
import { formatQuantityWithUnit, parseQuantityInput, quantityToInputText } from '../utils/quantity'
import styles from './Returns.module.css'

export default function NewPurchaseReturnPage() {
  const { id = '' } = useParams()
  const goBack = useGoBack(`/purchases/${id}`)
  const nav = useNavigate()
  const toast = useToast()
  const load = useCallback(async () => {
    const [invoice, returnable] = await Promise.all([getPurchases().detail(id), getReturns().purchaseReturnable(id)])
    return { invoice, returnable }
  }, [id])
  const { data, error, loading, reload } = useAsync(load)
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const lines = useMemo(() => data?.returnable.filter((r) => r.remaining > 0) ?? [], [data])

  if (error && !data) {
    return (
      <>
        <PageHeader title="برگشت خرید" onBack={goBack} />
        <EmptyState icon="alert" title="باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      </>
    )
  }
  if (loading || !data) return <PageHeader title="برگشت خرید" onBack={goBack} />
  if (!data.invoice || data.invoice.invoice.status !== 'active') {
    return (
      <>
        <PageHeader title="برگشت خرید" onBack={goBack} />
        <EmptyState icon="help" title="فاکتور فعال نیست" description="فقط از فاکتور خرید فعال می‌توان برگشت ثبت کرد." action={<ButtonLink to={`/purchases/${id}`}>جزئیات فاکتور</ButtonLink>} />
      </>
    )
  }

  const submit = async () => {
    setFormError(null)
    const parsed: { sourceItemId: string; quantity: number }[] = []
    for (const row of lines) {
      const text = qtys[row.item.id] ?? ''
      if (!text.trim()) continue
      const q = parseQuantityInput(text, row.product?.unitAllowsFraction ?? true)
      if (!q.ok) {
        setFormError('تعداد معتبر نیست.')
        return
      }
      if (q.value > row.remaining) {
        setFormError(`تعداد برگشت «${row.product?.name}» بیشتر از باقی‌مانده است.`)
        return
      }
      if (q.value > 0) parsed.push({ sourceItemId: row.item.id, quantity: q.value })
    }
    if (!parsed.length) {
      setFormError('حداقل برای یک کالا تعداد برگشت وارد کنید.')
      return
    }
    setBusy(true)
    try {
      await getReturns().createPurchaseReturn({ purchaseInvoiceId: id, lines: parsed })
      toast.show('برگشت خرید ثبت شد.')
      nav(`/purchases/${id}`, { replace: true })
    } catch (e) {
      if (e instanceof ValidationError) setFormError(Object.values(e.fieldErrors)[0] ?? toUserMessage(e))
      else setFormError(toUserMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page} data-testid="purchase-return-form">
      <PageHeader title="برگشت خرید" onBack={goBack} />
      <p className={styles.hint}>کالایی که به تأمین‌کننده برمی‌گردانید را مشخص کنید. از لایه همان خرید (در صورت موجود بودن) کم می‌شود.</p>
      {lines.length === 0 ? (
        <EmptyState compact icon="check" title="چیزی برای برگشت نمانده" description="همه ردیف‌ها قبلاً برگشت خورده‌اند یا موجودی کافی نیست." />
      ) : (
        <div className={styles.card}>
          {lines.map((row) => (
            <div key={row.item.id} className={styles.row}>
              <div className={styles.head}>
                <strong>{row.product?.name ?? 'کالا'}</strong>
                <span>{formatMoney(row.item.unitPrice)}</span>
              </div>
              <div className={styles.meta}>
                <span>خریده: {formatQuantityWithUnit(row.item.quantity, row.product?.unitName ?? '')}</span>
                <span>قابل برگشت: {formatQuantityWithUnit(row.remaining, row.product?.unitName ?? '')}</span>
              </div>
              <Field label="تعداد برگشت" htmlFor={`pq-${row.item.id}`}>
                <QuantityInput
                  id={`pq-${row.item.id}`}
                  value={qtys[row.item.id] ?? ''}
                  onChange={(v) => setQtys((s) => ({ ...s, [row.item.id]: v }))}
                  placeholder={quantityToInputText(row.remaining)}
                  suffix={row.product?.unitName}
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
            <Button onClick={submit} loading={busy} data-testid="purchase-return-save">
              ثبت برگشت
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
