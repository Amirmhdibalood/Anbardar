import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Chip } from '../components/Chip'
import { EmptyState } from '../components/EmptyState'
import { Field, MoneyInput, QuantityInput, SelectInput, TextInput } from '../components/Field'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { ProductTabs } from '../components/ProductTabs'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import type { Product, Warehouse } from '../models/catalog'
import { movementLabel, type StockLevel, type StockMovement, type StockStatus } from '../models/stock'
import { getCatalog, getStock } from '../services/appContext'
import type { AdjustKind, StockOverview, StockRow } from '../services/inventoryService'
import { formatPersianDateTime } from '../utils/date'
import { ValidationError, toUserMessage } from '../utils/errors'
import { formatInteger, parseIntegerInput, toPersianDigits } from '../utils/persian'
import { formatMoney, mulDivRound } from '../utils/money'
import { formatQuantity, parseQuantityInput, quantityParseMessage, quantityToInputText } from '../utils/quantity'
import styles from './StockPage.module.css'

interface Loaded {
  warehouses: Warehouse[]
  overview: StockOverview
}

type View = { kind: 'detail'; product: Product } | { kind: 'adjust'; product: Product; warehouseId: string } | null

const STATUS_LABEL: Record<StockStatus, string> = {
  ok: 'کافی',
  low: 'زیر نقطه سفارش',
  out: 'ناموجود',
}
const STATUS_TONE = { ok: 'accent', low: 'warning', out: 'error' } as const

/** موجودی کالاها به تفکیک انبار؛ مشاهده، اصلاح و ثبت موجودی اولیه */
export default function StockPage() {
  const [params, setParams] = useSearchParams()
  const warehouseId = params.get('w') ?? ''
  const query = params.get('q') ?? ''
  const attentionOnly = params.get('f') === 'low'
  const [text, setText] = useState(query)
  const [view, setView] = useState<View>(null)

  const update = useCallback(
    (changes: Record<string, string | null>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value)
            else next.delete(key)
          }
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (text.trim() !== query) update({ q: text.trim() || null })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [text, query, update])

  const load = useCallback(async (): Promise<Loaded> => {
    const [warehouses, overview] = await Promise.all([
      getCatalog().warehouses.list({ includeInactive: true }),
      getStock().overview({
        warehouseId: warehouseId || undefined,
        search: query,
        only: attentionOnly ? 'attention' : 'all',
      }),
    ])
    return { warehouses, overview }
  }, [warehouseId, query, attentionOnly])
  const { data, error, loading, reload } = useAsync(load)

  const filtering = query !== '' || attentionOnly

  return (
    <div className={styles.page}>
      <PageHeader title="موجودی" />
      <ProductTabs />

      {error && !data ? (
        <EmptyState icon="alert" title="موجودی باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      ) : loading && !data ? (
        <div aria-busy="true" aria-label="در حال بارگذاری">
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      ) : (
        data && (
          <>
            <div className={styles.filters}>
              <SelectInput aria-label="انبار" value={warehouseId} onChange={(e) => update({ w: e.target.value || null })}>
                <option value="">همه انبارها</option>
                {data.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {w.isActive ? '' : ' (غیرفعال)'}
                  </option>
                ))}
              </SelectInput>
              <label className={styles.search}>
                <Icon name="search" size={18} />
                <input
                  type="search"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="جستجوی نام یا کد کالا…"
                  aria-label="جستجوی کالا در موجودی"
                  autoComplete="off"
                />
              </label>
            </div>

            <div className={styles.chips} role="group" aria-label="فیلتر وضعیت موجودی">
              <Chip label="همه" selected={!attentionOnly} onClick={() => update({ f: null })} />
              <Chip label={`فقط کم‌موجودی (${formatInteger(data.overview.counts.attention)})`} selected={attentionOnly} onClick={() => update({ f: 'low' })} />
            </div>

            {data.overview.rows.length === 0 ? (
              data.overview.counts.all === 0 && !filtering ? (
                <EmptyState icon="box" title="کالای فعالی برای نمایش نیست" description="ابتدا از بخش «کالاها» یک کالا ثبت کنید؛ بعد موجودی آن اینجا دیده می‌شود." />
              ) : attentionOnly && query === '' ? (
                <EmptyState icon="check" title="همه چیز مرتب است" description="کالایی ناموجود یا زیر نقطه سفارش نیست." />
              ) : (
                <EmptyState
                  compact
                  icon="search"
                  title="کالایی پیدا نشد"
                  description="عبارت دیگری امتحان کنید یا فیلتر را بردارید."
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setText('')
                        update({ q: null, f: null })
                      }}
                    >
                      پاک کردن جستجو و فیلتر
                    </Button>
                  }
                />
              )
            ) : (
              <ul className={styles.list}>
                {data.overview.rows.map((row) => (
                  <li key={row.product.id}>
                    <StockCard row={row} onOpen={() => setView({ kind: 'detail', product: row.product })} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )
      )}

      {view?.kind === 'detail' && (
        <DetailSheet
          key={view.product.id}
          product={view.product}
          warehouses={data?.warehouses ?? []}
          onClose={() => setView(null)}
          onAdjust={(id) => setView({ kind: 'adjust', product: view.product, warehouseId: id })}
        />
      )}
      {view?.kind === 'adjust' && (
        <AdjustSheet
          key={`${view.product.id}-${view.warehouseId}`}
          product={view.product}
          warehouses={data?.warehouses ?? []}
          initialWarehouseId={view.warehouseId}
          onBack={() => setView({ kind: 'detail', product: view.product })}
          onSaved={() => {
            reload()
            setView({ kind: 'detail', product: view.product })
          }}
        />
      )}
    </div>
  )
}

function StockCard({ row, onOpen }: { row: StockRow; onOpen: () => void }) {
  const { product, quantity, status } = row
  const reorder = product.reorderPoint
  // نوار: نیمه پر = نقطه سفارش؛ دو برابر نقطه سفارش (یا بیشتر) = پر
  const ratio = reorder > 0 ? Math.max(0, Math.min(1, quantity / (reorder * 2))) : 0
  return (
    <button type="button" className={`${styles.card} ${status !== 'ok' ? styles.attention : ''}`} onClick={onOpen} aria-label={`موجودی ${product.name}`}>
      <span className={styles.top}>
        <span className={styles.titleBlock}>
          <strong className={styles.name}>{product.name}</strong>
          <span className={styles.code}>
            <bdi>{toPersianDigits(product.code)}</bdi>
          </span>
        </span>
        <span className={styles.qty}>
          <strong className={status === 'ok' ? '' : styles[status]}>{formatQuantity(quantity)}</strong>
          <span>{product.unitName}</span>
        </span>
      </span>
      {reorder > 0 && (
        <span className={styles.bar} aria-hidden="true">
          <span className={`${styles.fill} ${status === 'ok' ? '' : styles.fillBad}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
        </span>
      )}
      <span className={styles.bottom}>
        <span className={styles.reorder}>{reorder > 0 ? `نقطه سفارش: ${formatQuantity(reorder)} ${product.unitName}` : 'نقطه سفارش تعیین نشده'}</span>
        <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
      </span>
    </button>
  )
}

function DetailSheet({ product, warehouses, onClose, onAdjust }: { product: Product; warehouses: Warehouse[]; onClose: () => void; onAdjust: (warehouseId: string) => void }) {
  const load = useCallback(async () => {
    const stock = getStock()
    const [levels, movements] = await Promise.all([stock.levelsForProduct(product.id), stock.recentMovements(product.id, 8)])
    return { levels, movements }
  }, [product.id])
  const { data, error } = useAsync(load)
  const levelOf = (id: string): StockLevel | undefined => data?.levels.find((l) => l.warehouseId === id)
  const names = new Map(warehouses.map((w) => [w.id, w.name]))
  // انبارهای فعال همیشه نمایش داده می‌شوند (حتی با موجودی صفر)؛ انبار غیرفعال فقط اگر موجودی دارد
  const shown = warehouses.filter((w) => w.isActive || (levelOf(w.id)?.quantity ?? 0) !== 0)

  return (
    <Sheet open title={product.name} onClose={onClose}>
      <div className={styles.sheetBody}>
        <p className={styles.sheetSub}>
          کد <bdi>{toPersianDigits(product.code)}</bdi> | واحد {product.unitName}
        </p>
        {error && <p className={styles.errorText}>{error}</p>}
        <h3 className={styles.sectionTitle}>موجودی هر انبار</h3>
        <ul className={styles.levels}>
          {shown.map((w) => {
            const qty = levelOf(w.id)?.quantity ?? 0
            return (
              <li key={w.id} className={styles.levelRow}>
                <span className={styles.levelName}>
                  {w.name}
                  {!w.isActive && <Badge>غیرفعال</Badge>}
                </span>
                <strong className={styles.levelQty}>
                  {formatQuantity(qty)} {product.unitName}
                </strong>
                {w.isActive && product.isActive && (
                  <Button small variant="secondary" onClick={() => onAdjust(w.id)} aria-label={`اصلاح موجودی در ${w.name}`}>
                    اصلاح
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
        <h3 className={styles.sectionTitle}>آخرین تغییرات</h3>
        {data && data.movements.length === 0 ? (
          <p className={styles.muted}>هنوز تغییری ثبت نشده. با «اصلاح» می‌توانید موجودی اولیه را وارد کنید.</p>
        ) : (
          <ul className={styles.moves}>
            {(data?.movements ?? []).map((m) => (
              <MovementRow key={m.id} movement={m} unit={product.unitName} warehouseName={names.get(m.warehouseId) ?? ''} showWarehouse={warehouses.length > 1} />
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  )
}

function MovementRow({ movement: m, unit, warehouseName, showWarehouse }: { movement: StockMovement; unit: string; warehouseName: string; showWarehouse: boolean }) {
  const positive = m.quantityDelta > 0
  return (
    <li className={styles.move}>
      <span className={styles.moveMain}>
        <strong>{movementLabel(m.movementType)}</strong>
        <span className={styles.moveMeta}>
          {formatPersianDateTime(m.occurredAt)}
          {showWarehouse && warehouseName ? ` | ${warehouseName}` : ''}
          {m.note ? ` | ${m.note}` : ''}
          {m.costs && (m.movementType === 'shortage' || m.movementType === 'waste') ? ` | بها: ${formatMoney(m.costs.fifo)}` : ''}
        </span>
      </span>
      <span className={`${styles.delta} ${positive ? styles.plus : styles.minus}`} dir="ltr">
        {positive ? '+' : '−'}
        {formatQuantity(Math.abs(m.quantityDelta))} {unit}
      </span>
    </li>
  )
}

const ADJUST_KINDS: { value: AdjustKind; label: string; hint: string }[] = [
  { value: 'count', label: 'شمارش', hint: 'عدد واقعی شمارش‌شده را بزنید. اگر بیشتر باشد با بهای میانگین فعلی اضافه می‌شود و اگر کمتر باشد «کسری» ثبت می‌شود.' },
  { value: 'opening', label: 'موجودی اولیه', hint: 'برای شروع کار با برنامه: موجودی فعلی و بهای خرید هر واحد را بزنید.' },
  { value: 'shortage', label: 'کسری', hint: 'کالای گم‌شده، سرقت‌شده یا کسری شمارش. از قدیمی‌ترین خریدها کم می‌شود و بهایش جدا نگه داشته می‌شود.' },
  { value: 'waste', label: 'ضایعات / خرابی', hint: 'کالای خراب، شکسته یا تاریخ‌گذشته. از قدیمی‌ترین خریدها کم می‌شود و بهایش جدا نگه داشته می‌شود.' },
]

function AdjustSheet({
  product,
  warehouses,
  initialWarehouseId,
  onBack,
  onSaved,
}: {
  product: Product
  warehouses: Warehouse[]
  initialWarehouseId: string
  onBack: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [warehouseId, setWarehouseId] = useState(initialWarehouseId)
  const [kind, setKind] = useState<AdjustKind>('count')
  const [value, setValue] = useState('')
  const [unitCostText, setUnitCostText] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const loadInfo = useCallback(async () => {
    const stock = getStock()
    const [levels, suggested] = await Promise.all([stock.levelsForProduct(product.id), stock.suggestedUnitCost(product.id)])
    return { current: levels.find((l) => l.warehouseId === warehouseId)?.quantity ?? 0, suggested }
  }, [product.id, warehouseId])
  const { data: info } = useAsync(loadInfo)
  const current = info?.current
  // پیش‌فرض بهای موجودی اولیه: قیمت واحد آخرین خرید (کاربر می‌تواند عوض کند)
  const unitCostValue = unitCostText ?? (info?.suggested ? formatInteger(info.suggested) : '')

  const isTotal = kind === 'count' || kind === 'opening'
  const parsed = parseQuantityInput(value, product.unitAllowsFraction)
  const entered = value.trim() !== ''
  const delta = parsed.ok && entered && current !== undefined ? (isTotal ? parsed.value - current : -parsed.value) : null
  const unitCost = parseIntegerInput(unitCostValue)
  const kindInfo = ADJUST_KINDS.find((k) => k.value === kind) ?? ADJUST_KINDS[0]
  const qtyLabel = kind === 'count' ? 'عدد شمارش‌شده (موجودی جدید)' : kind === 'opening' ? 'موجودی جدید' : kind === 'shortage' ? 'مقدار کسری' : 'مقدار ضایعات / خرابی'

  let summary: { text: string; down: boolean } | null = null
  if (delta !== null && delta !== 0) {
    const amount = `${formatQuantity(Math.abs(delta))} ${product.unitName}`
    if (delta > 0 && kind === 'opening') {
      summary = { text: `${amount} با بهای کل ${formatMoney(unitCost === null ? 0 : mulDivRound(delta, unitCost, 1000))} اضافه می‌شود.`, down: false }
    } else if (delta > 0) {
      summary = { text: `${amount} به موجودی اضافه می‌شود (با بهای میانگین فعلی کالا).`, down: false }
    } else {
      const label = kind === 'waste' ? 'ضایعات / خرابی' : 'کسری'
      summary = { text: `${amount} از موجودی کم و به‌عنوان «${label}» ثبت می‌شود.`, down: true }
    }
  }

  const save = async () => {
    const next: Record<string, string> = {}
    if (!entered) next['quantity'] = isTotal ? 'موجودی جدید را وارد کنید (برای صفر بودن، عدد ۰).' : 'مقدار را وارد کنید.'
    else if (!parsed.ok) next['quantity'] = quantityParseMessage(parsed.reason, isTotal ? 'موجودی' : 'مقدار', product.unitName)
    if (kind === 'opening' && unitCost === null) next['unitCost'] = 'بهای هر واحد را به تومان وارد کنید (اگر رایگان بوده ۰).'
    setErrors(next)
    if (Object.keys(next).length > 0 || !parsed.ok) return
    setSaving(true)
    try {
      await getStock().adjust({ productId: product.id, warehouseId, kind, quantity: parsed.value, unitCost: kind === 'opening' ? (unitCost ?? undefined) : undefined, note })
      toast.show(kind === 'opening' ? 'موجودی اولیه ثبت شد.' : kind === 'count' ? 'شمارش ثبت شد.' : kind === 'shortage' ? 'کسری ثبت شد.' : 'ضایعات ثبت شد.')
      onSaved()
    } catch (e) {
      if (e instanceof ValidationError) {
        const fe = e.fieldErrors
        setErrors(Object.keys(fe).length ? fe : { quantity: e.userMessage })
      } else setErrors({ quantity: toUserMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open title={`اصلاح موجودی «${product.name}»`} onClose={onBack}>
      <form
        className={styles.sheetBody}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Field label="انبار" htmlFor="adj-warehouse">
          <SelectInput
            id="adj-warehouse"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value)
              setErrors({})
            }}
          >
            {warehouses
              .filter((w) => w.isActive)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
          </SelectInput>
        </Field>
        <p className={styles.currentLine}>
          موجودی فعلی: <strong>{current === undefined ? '…' : `${formatQuantity(current)} ${product.unitName}`}</strong>
        </p>
        <div className={styles.kinds} role="radiogroup" aria-label="نوع ثبت">
          {ADJUST_KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              className={`${styles.kind} ${kind === k.value ? styles.kindOn : ''}`}
              onClick={() => {
                setKind(k.value)
                setErrors({})
              }}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className={styles.kindHint}>{kindInfo?.hint}</p>
        <Field label={qtyLabel} required htmlFor="adj-qty" error={errors['quantity']} hint={product.unitAllowsFraction ? 'تا سه رقم اعشار مجاز است.' : `واحد «${product.unitName}» فقط عدد صحیح می‌پذیرد.`}>
          <QuantityInput
            id="adj-qty"
            value={value}
            onChange={(v) => {
              setValue(v)
              setErrors((e) => ({ ...e, quantity: '' }))
            }}
            suffix={product.unitName}
            invalid={!!errors['quantity']}
            placeholder={isTotal ? quantityToInputText(current ?? 0) || '۰' : '۰'}
          />
        </Field>
        {kind === 'opening' && (
          <Field label="بهای خرید هر واحد" required htmlFor="adj-cost" error={errors['unitCost']} hint={info?.suggested ? 'پیش‌فرض: قیمت آخرین خرید این کالا.' : undefined}>
            <MoneyInput
              id="adj-cost"
              value={unitCostValue}
              onChange={(v) => {
                setUnitCostText(v)
                setErrors((e) => ({ ...e, unitCost: '' }))
              }}
              suffix={`تومان / ${product.unitName}`}
              invalid={!!errors['unitCost']}
              placeholder="۰"
            />
          </Field>
        )}
        {summary && (
          <p className={`${styles.summary} ${summary.down ? styles.summaryDown : ''}`} role="status">
            <Icon name={summary.down ? 'alert' : 'info'} size={16} />
            {summary.text}
          </p>
        )}
        <Field label="توضیح (اختیاری)" htmlFor="adj-note" error={errors['note']}>
          <TextInput
            id="adj-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={kind === 'waste' ? 'مثلاً شکستگی در جابه‌جایی' : 'مثلاً شمارش پایان ماه'}
            maxLength={200}
            autoComplete="off"
            invalid={!!errors['note']}
          />
        </Field>
        <div className={styles.actions}>
          <Button type="submit" block loading={saving}>
            ثبت
          </Button>
          <Button variant="secondary" block onClick={onBack}>
            بازگشت
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
