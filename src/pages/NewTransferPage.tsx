import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Field, QuantityInput, SelectInput } from '../components/Field'
import { PageHeader } from '../components/PageHeader'
import { ProductPicker } from '../components/invoice/ProductPicker'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import type { Product } from '../models/catalog'
import { getCatalog, getStock, getTransfers } from '../services/appContext'
import { toUserMessage, ValidationError } from '../utils/errors'
import { formatQuantityWithUnit, parseQuantityInput, QUANTITY_SCALE, quantityToInputText } from '../utils/quantity'
import styles from './Returns.module.css'

interface Line {
  product: Product
  quantity: string
}

export default function NewTransferPage() {
  const goBack = useGoBack('/transfers')
  const nav = useNavigate()
  const toast = useToast()
  const load = useCallback(() => getCatalog().warehouses.list(), [])
  const { data: warehouses, error, loading, reload } = useAsync(load)
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const from = fromId || warehouses?.[0]?.id || ''
  const to = toId || warehouses?.[1]?.id || warehouses?.[0]?.id || ''

  const stockLoad = useCallback(async () => {
    if (!from) return new Map<string, number>()
    const overview = await getStock().overview({ warehouseId: from })
    return new Map(overview.rows.map((r) => [r.product.id, r.quantity]))
  }, [from])
  const { data: stock } = useAsync(stockLoad)

  if (error && !warehouses) {
    return (
      <>
        <PageHeader title="انتقال جدید" onBack={goBack} />
        <EmptyState icon="alert" title="باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      </>
    )
  }
  if (loading || !warehouses) return <PageHeader title="انتقال جدید" onBack={goBack} />
  if (warehouses.length < 2) {
    return (
      <>
        <PageHeader title="انتقال جدید" onBack={goBack} />
        <EmptyState icon="grid" title="حداقل دو انبار لازم است" description="اول از بخش انبارها، انبار دومی بسازید." />
      </>
    )
  }

  const addProduct = (product: Product) => {
    setLines((prev) => (prev.some((l) => l.product.id === product.id) ? prev : [...prev, { product, quantity: quantityToInputText(QUANTITY_SCALE) }]))
    setPicker(false)
  }

  const submit = async () => {
    setFormError(null)
    if (from === to) {
      setFormError('انبار مبدأ و مقصد نباید یکی باشند.')
      return
    }
    const parsed: { productId: string; quantity: number }[] = []
    for (const line of lines) {
      const q = parseQuantityInput(line.quantity, line.product.unitAllowsFraction)
      if (!q.ok || q.value <= 0) {
        setFormError(`تعداد «${line.product.name}» معتبر نیست.`)
        return
      }
      const have = stock?.get(line.product.id) ?? 0
      if (q.value > have) {
        setFormError(`موجودی «${line.product.name}» در مبدأ کافی نیست.`)
        return
      }
      parsed.push({ productId: line.product.id, quantity: q.value })
    }
    if (!parsed.length) {
      setFormError('حداقل یک کالا اضافه کنید.')
      return
    }
    setBusy(true)
    try {
      const t = await getTransfers().create({ fromWarehouseId: from, toWarehouseId: to, lines: parsed })
      toast.show('انتقال ثبت شد.')
      nav(`/transfers/${t.id}`, { replace: true })
    } catch (e) {
      if (e instanceof ValidationError) setFormError(Object.values(e.fieldErrors)[0] ?? toUserMessage(e))
      else setFormError(toUserMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page} data-testid="transfer-form">
      <PageHeader title="انتقال جدید" onBack={goBack} />
      <div className={`${styles.card} ${styles.filters}`}>
        <Field label="از انبار" htmlFor="tr-from">
          <SelectInput id="tr-from" value={from} onChange={(e) => setFromId(e.target.value)}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="به انبار" htmlFor="tr-to">
          <SelectInput id="tr-to" value={to} onChange={(e) => setToId(e.target.value)}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>

      <div className={styles.card}>
        {lines.map((line) => (
          <div key={line.product.id} className={styles.row}>
            <div className={styles.head}>
              <strong>{line.product.name}</strong>
              <Button
                variant="ghost"
                small
                onClick={() => setLines((prev) => prev.filter((l) => l.product.id !== line.product.id))}
              >
                حذف
              </Button>
            </div>
            <div className={styles.meta}>
              <span>موجودی مبدأ: {formatQuantityWithUnit(stock?.get(line.product.id) ?? 0, line.product.unitName)}</span>
            </div>
            <Field label="تعداد" htmlFor={`tq-${line.product.id}`}>
              <QuantityInput
                id={`tq-${line.product.id}`}
                value={line.quantity}
                onChange={(v) => setLines((prev) => prev.map((l) => (l.product.id === line.product.id ? { ...l, quantity: v } : l)))}
                suffix={line.product.unitName}
              />
            </Field>
          </div>
        ))}
        <Button variant="secondary" icon="plus" onClick={() => setPicker(true)}>
          افزودن کالا
        </Button>
        {formError && (
          <p role="alert" style={{ color: 'var(--error)', fontSize: 13, marginTop: 8 }}>
            {formError}
          </p>
        )}
        <div className={styles.actions}>
          <Button variant="ghost" onClick={goBack} disabled={busy}>
            انصراف
          </Button>
          <Button onClick={submit} loading={busy} data-testid="transfer-save">
            ثبت انتقال
          </Button>
        </div>
      </div>

      {picker && from && (
        <ProductPicker
          warehouseId={from}
          exclude={new Set(lines.map((l) => l.product.id))}
          requireStock
          onPick={(p) => addProduct(p)}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  )
}
