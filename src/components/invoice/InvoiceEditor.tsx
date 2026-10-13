import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { Product, Warehouse } from '../../models/catalog'
import type { Customer, PartyInput, Supplier } from '../../models/party'
import { useAsync } from '../../hooks/useAsync'
import { getStock } from '../../services/appContext'
import { draftToInput, draftTotals, isFutureDay, lineError, lineUnit, loadPriceMode, mapServiceErrors, savePriceMode, stepQuantity, type ChargeDraft, type DraftInput, type InvoiceDraft, type LineDraft } from '../../services/invoiceForm'
import type { LandedMethod, PriceMode } from '../../models/invoice'
import { SegmentedControl } from '../SegmentedControl'
import { toPersianDigits } from '../../utils/persian'
import { toUserMessage } from '../../utils/errors'
import { toJalali } from '../../utils/jalali'
import { formatMoney } from '../../utils/money'
import { formatInteger } from '../../utils/persian'
import { formatQuantityWithUnit, parseQuantityInput, quantityToInputText, QUANTITY_SCALE } from '../../utils/quantity'
import { Button } from '../Button'
import { ConfirmSheet } from '../ConfirmSheet'
import { Field, MoneyInput, QuantityInput, TextInput } from '../Field'
import { Icon } from '../Icon'
import { JalaliDatePicker } from '../JalaliDatePicker'
import { Picker } from '../Picker'
import { PageHeader } from '../PageHeader'
import { PartySheet } from '../PartySheet'
import { ProductPicker } from './ProductPicker'
import { PaymentSection } from './PaymentSection'
import styles from './Invoice.module.css'

type Party = Customer | Supplier

export interface InvoiceEditorProps {
  kind: 'purchase' | 'sale'
  title: string
  partyLabel: 'مشتری' | 'تأمین‌کننده'
  parties: Party[]
  defaultPartyId: string
  warehouses: Warehouse[]
  defaultWarehouseId: string
  /** شماره فاکتور فروشنده (فقط خرید) */
  showReference?: boolean
  createParty: (input: PartyInput) => Promise<Party>
  /** قیمت پیشنهادی هنگام افزودن کالا (null = خالی) */
  suggestPrice: (product: Product) => Promise<number | null>
  /** متن راهنمای زیر قیمت هر ردیف (مثلاً منبع پیشنهاد) */
  priceHint?: (product: Product) => string | undefined
  /** محتوای اضافه زیر هر ردیف (مثلاً بها و سود در فروش) */
  lineExtra?: (line: LineDraft, warehouseId: string) => ReactNode
  submitLabel: string
  totalLabel: string
  onSubmit: (input: DraftInput) => Promise<void>
  onBack: () => void
  /** فروش: کالای ناموجود قابل انتخاب نیست و تعداد بیش از موجودی هشدار دارد */
  checkStock?: boolean
}

let keySeq = 0

/** فرم مشترک ثبت فاکتور (خرید/فروش) مطابق طرح «ثبت فروش» */
export function InvoiceEditor(props: InvoiceEditorProps) {
  const { kind, partyLabel, warehouses } = props
  const [parties, setParties] = useState(props.parties)
  const [draft, setDraft] = useState<InvoiceDraft>(() => ({
    partyId: props.defaultPartyId,
    warehouseId: props.defaultWarehouseId,
    day: toJalali(new Date()),
    reference: '',
    discount: '',
    note: '',
    lines: [],
    payMode: 'full',
    paid: '',
    ...(props.kind === 'purchase' ? { charges: [], landedMethod: 'value' as LandedMethod } : {}),
  }))
  /** قیمت پیشنهادی هر ردیف به ازای «واحد پایه» (برای تبدیل هنگام عوض کردن واحد) */
  const [basePrices, setBasePrices] = useState<Record<string, number | null>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [picker, setPicker] = useState(false)
  const [newParty, setNewParty] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [openDiscounts, setOpenDiscounts] = useState<ReadonlySet<string>>(new Set())

  const loadStock = useCallback(async () => {
    const overview = await getStock().overview({ warehouseId: draft.warehouseId })
    return new Map(overview.rows.map((r) => [r.product.id, r.quantity]))
  }, [draft.warehouseId])
  const { data: stock } = useAsync(loadStock)

  const totals = useMemo(() => draftTotals(draft), [draft])
  const future = isFutureDay(draft.day)
  const exclude = useMemo(() => new Set(draft.lines.map((l) => l.product.id)), [draft.lines])

  const update = (patch: Partial<InvoiceDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }))
    setErrors((e) => {
      const next = { ...e }
      for (const f of Object.keys(patch)) delete next[lineError(key, f as 'quantity')]
      return next
    })
  }

  const addProduct = async (product: Product) => {
    setPicker(false)
    const key = `l${++keySeq}`
    const price = await props.suggestPrice(product).catch(() => null)
    setBasePrices((b) => ({ ...b, [key]: price }))
    const priceMode: PriceMode = kind === 'purchase' ? loadPriceMode() : 'unit'
    setDraft((d) => ({
      ...d,
      lines: [...d.lines, { key, product, quantity: quantityToInputText(QUANTITY_SCALE), unitPrice: price ? formatInteger(price) : '', discount: '', unitId: null, priceMode, amount: '' }],
    }))
    setErrors((e) => {
      const next = { ...e }
      delete next['items']
      return next
    })
  }

  const submit = async () => {
    setFormError(null)
    const result = draftToInput(draft)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setSaving(true)
    try {
      await props.onSubmit(result.input)
    } catch (e) {
      const mapped = mapServiceErrors(e, draft)
      if (mapped) setErrors(mapped)
      setFormError(toUserMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const changeUnit = (line: LineDraft, unitId: string) => {
    const next = { ...line, unitId: unitId === line.product.unitId ? null : unitId }
    const u = lineUnit(next)
    const base = basePrices[line.key]
    const patch: Partial<LineDraft> = { unitId: next.unitId }
    // قیمت پیشنهادی را به واحد جدید تبدیل کن (اگر کاربر قیمت را دستی عوض نکرده باشد هم فقط پیشنهاد است)
    if (base != null) patch.unitPrice = formatInteger(Math.round((base * u.factor) / 1000))
    if (!u.allowsFraction) {
      const r = parseQuantityInput(line.quantity, true)
      const whole = r.ok ? Math.round(r.value / QUANTITY_SCALE) : 1
      patch.quantity = quantityToInputText(Math.max(1, whole) * QUANTITY_SCALE)
    }
    updateLine(line.key, patch)
  }
  const changeMode = (line: LineDraft, mode: PriceMode) => {
    savePriceMode(mode)
    const t = totals.lineGross[line.key]
    const patch: Partial<LineDraft> = { priceMode: mode }
    // مقدار فعلی را به حالت جدید ببر تا کاربر چیزی از دست ندهد
    if (mode === 'total' && t != null && t > 0 && !line.amount) patch.amount = formatInteger(t)
    if (mode === 'unit' && totals.lineUnitPrices[line.key] != null && line.unitPrice.trim() === '') patch.unitPrice = formatInteger(totals.lineUnitPrices[line.key]!)
    updateLine(line.key, patch)
  }
  const charges = draft.charges ?? []
  const updateCharge = (key: string, patch: Partial<ChargeDraft>) => {
    update({ charges: charges.map((c) => (c.key === key ? { ...c, ...patch } : c)) })
    setErrors((e) => {
      const next = { ...e }
      for (const f of Object.keys(patch)) delete next[`charge:${key}:${f}`]
      return next
    })
  }

  const back = () => (draft.lines.length > 0 ? setConfirmLeave(true) : props.onBack())
  const activeWarehouses = warehouses.filter((w) => w.isActive || w.id === draft.warehouseId)
  const activeParties = parties.filter((p) => p.isActive || p.id === draft.partyId)

  return (
    <>
      <PageHeader title={props.title} onBack={back} />
      <form
        className={styles.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className={styles.top}>
          <Field label={partyLabel} htmlFor="inv-party" error={errors['party']}>
            <div className={styles.partyRow}>
              <Picker
                id="inv-party"
                title={partyLabel}
                value={draft.partyId}
                onChange={(v) => update({ partyId: v })}
                invalid={!!errors['party']}
                options={activeParties.map((p) => ({ value: p.id, label: p.name, description: p.isSystem ? 'نقدی' : p.phone ? toPersianDigits(p.phone) : undefined }))}
                addLabel={`${partyLabel} جدید`}
                onAdd={() => setNewParty(true)}
              />
              <button type="button" className={styles.squareButton} aria-label={`${partyLabel} جدید`} title={`${partyLabel} جدید`} onClick={() => setNewParty(true)}>
                <Icon name="plus" size={19} />
              </button>
            </div>
          </Field>
          <Field label="انبار" htmlFor="inv-warehouse" error={errors['warehouse']}>
            <Picker
              id="inv-warehouse"
              title="انبار"
              value={draft.warehouseId}
              onChange={(v) => update({ warehouseId: v })}
              invalid={!!errors['warehouse']}
              options={activeWarehouses.map((w) => ({ value: w.id, label: w.name }))}
              emptyText="انبار فعالی وجود ندارد."
            />
          </Field>
        </div>
        <div className={props.showReference ? styles.two : undefined}>
          <Field label="تاریخ فاکتور" htmlFor="inv-date">
            <JalaliDatePicker id="inv-date" value={draft.day} onChange={(day) => update({ day })} title="تاریخ فاکتور" />
          </Field>
          {props.showReference && (
            <Field label="شماره فاکتور فروشنده" htmlFor="inv-ref" error={errors['reference']}>
              <TextInput id="inv-ref" value={draft.reference} onChange={(e) => update({ reference: e.target.value })} placeholder="اختیاری" autoComplete="off" maxLength={60} />
            </Field>
          )}
        </div>
        {future && (
          <p className={styles.warnLine} role="status">
            <Icon name="alert" size={15} /> تاریخ انتخاب‌شده بعد از امروز است. اگر اشتباه است، تاریخ را درست کنید.
          </p>
        )}

        {draft.lines.map((line) => {
          const q = errors[lineError(line.key, 'quantity')]
          const total = line.priceMode === 'total'
          const p = errors[lineError(line.key, total ? 'amount' : 'unitPrice')] ?? errors[lineError(line.key, 'unitPrice')]
          const d = errors[lineError(line.key, 'discount')]
          const prod = errors[lineError(line.key, 'product')] ?? errors[lineError(line.key, 'unit')]
          const invalid = !!(q || p || d || prod)
          const unit = lineUnit(line)
          const subUnits = (line.product.subUnits ?? []).filter((u) => u.isActive)
          const gross = totals.lineGross[line.key]
          const perUnit = totals.lineUnitPrices[line.key]
          const counterpart = total
            ? perUnit != null
              ? `هر ${unit.name} ≈ ${formatMoney(perUnit)} تومان`
              : undefined
            : kind === 'purchase' && gross != null && gross > 0
              ? `جمع: ${formatMoney(gross)} تومان`
              : undefined
          const lineTotal = totals.lineTotals[line.key]
          const inStock = stock?.get(line.product.id) ?? 0
          const showDiscount = openDiscounts.has(line.key) || line.discount !== '' || !!d
          return (
            <div key={line.key} className={`${styles.line} ${invalid ? styles.lineInvalid : ''}`} data-line={line.product.name}>
              <div className={styles.lineHead}>
                <strong className={styles.lineName}>{line.product.name}</strong>
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`حذف ${line.product.name}`}
                  onClick={() => setDraft((dr) => ({ ...dr, lines: dr.lines.filter((l) => l.key !== line.key) }))}
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
              {(subUnits.length > 0 || kind === 'purchase') && (
                <div className={styles.lineOptions}>
                  {subUnits.length > 0 && (
                    <Field label="واحد" htmlFor={`u-${line.key}`}>
                      <Picker
                        id={`u-${line.key}`}
                        title={`واحد «${line.product.name}»`}
                        value={unit.id}
                        onChange={(v) => changeUnit(line, v)}
                        options={[
                          { value: line.product.unitId, label: line.product.unitName, description: 'واحد اصلی' },
                          ...subUnits.map((u) => ({ value: u.unitId, label: u.unitName, description: `${formatQuantityWithUnit(u.factor, line.product.unitName)}` })),
                        ]}
                      />
                    </Field>
                  )}
                  {kind === 'purchase' && (
                    <div className={styles.modeSwitch} data-testid={`mode-${line.key}`}>
                      <SegmentedControl<PriceMode>
                        label="نوع قیمت"
                        value={line.priceMode ?? 'unit'}
                        onChange={(m) => changeMode(line, m)}
                        options={[
                          { value: 'unit', label: 'قیمت واحد' },
                          { value: 'total', label: 'مبلغ کل' },
                        ]}
                      />
                    </div>
                  )}
                </div>
              )}
              <div className={styles.lineGrid}>
                <Field label={`تعداد (${unit.name})`} htmlFor={`q-${line.key}`} error={q}>
                  <div className={styles.stepper}>
                    <button type="button" aria-label="کم کردن" onClick={() => updateLine(line.key, { quantity: stepQuantity(line.quantity, line.product, -1, unit.allowsFraction) })}>
                      −
                    </button>
                    <QuantityInput id={`q-${line.key}`} value={line.quantity} onChange={(v) => updateLine(line.key, { quantity: v })} invalid={!!q} />
                    <button type="button" aria-label="زیاد کردن" onClick={() => updateLine(line.key, { quantity: stepQuantity(line.quantity, line.product, 1, unit.allowsFraction) })}>
                      +
                    </button>
                  </div>
                </Field>
                {total ? (
                  <Field label="مبلغ کل ردیف (تومان)" htmlFor={`a-${line.key}`} error={p} hint={counterpart}>
                    <MoneyInput id={`a-${line.key}`} value={line.amount ?? ''} onChange={(v) => updateLine(line.key, { amount: v })} invalid={!!p} placeholder="مبلغ کل" />
                  </Field>
                ) : (
                  <Field label={`قیمت هر ${unit.name} (تومان)`} htmlFor={`p-${line.key}`} error={p} hint={counterpart ?? props.priceHint?.(line.product)}>
                    <MoneyInput id={`p-${line.key}`} value={line.unitPrice} onChange={(v) => updateLine(line.key, { unitPrice: v })} invalid={!!p} placeholder="قیمت" />
                  </Field>
                )}
              </div>
              {showDiscount ? (
                <Field label="تخفیف این ردیف (تومان)" htmlFor={`d-${line.key}`} error={d}>
                  <MoneyInput id={`d-${line.key}`} value={line.discount} onChange={(v) => updateLine(line.key, { discount: v })} invalid={!!d} placeholder="۰" suffix="تومان" />
                </Field>
              ) : (
                <button type="button" className={styles.linkButton} onClick={() => setOpenDiscounts((s) => new Set(s).add(line.key))}>
                  + تخفیف برای این ردیف
                </button>
              )}
              {prod && <p className={styles.lineError}>{prod}</p>}
              <div className={styles.lineFoot}>
                <span className={props.checkStock && inStock <= 0 ? styles.out : undefined}>موجودی این انبار: {formatQuantityWithUnit(inStock, line.product.unitName)}</span>
                <span>
                  جمع ردیف: <strong>{lineTotal == null ? '—' : formatMoney(lineTotal)}</strong>
                </span>
              </div>
              {props.lineExtra?.(line, draft.warehouseId)}
            </div>
          )
        })}

        <button type="button" className={`${styles.addLine} ${errors['items'] ? styles.addLineInvalid : ''}`} onClick={() => setPicker(true)}>
          <Icon name="plus" size={18} /> افزودن کالا
        </button>
        {errors['items'] && (
          <p className={styles.lineError} role="alert">
            {errors['items']}
          </p>
        )}

        {kind === 'purchase' && (
          <div className={styles.chargesCard} data-testid="charges">
            <div className={styles.chargesHead}>
              <strong>هزینه‌های جانبی</strong>
              <span>حمل، بیمه، باربری… — به بهای کالا اضافه می‌شود، نه به بدهی تأمین‌کننده</span>
            </div>
            {charges.map((c, i) => (
              <div key={c.key} className={styles.chargeRow}>
                <Field label={`عنوان ${toPersianDigits(i + 1)}`} htmlFor={`ct-${c.key}`} error={errors[`charge:${c.key}:title`]}>
                  <TextInput id={`ct-${c.key}`} value={c.title} onChange={(e) => updateCharge(c.key, { title: e.target.value })} placeholder="مثلاً کرایه حمل" maxLength={60} autoComplete="off" />
                </Field>
                <Field label="مبلغ (تومان)" htmlFor={`ca-${c.key}`} error={errors[`charge:${c.key}:amount`]}>
                  <MoneyInput id={`ca-${c.key}`} value={c.amount} onChange={(v) => updateCharge(c.key, { amount: v })} invalid={!!errors[`charge:${c.key}:amount`]} placeholder="۰" />
                </Field>
                <button type="button" className={styles.remove} aria-label={`حذف هزینه ${toPersianDigits(i + 1)}`} onClick={() => update({ charges: charges.filter((x) => x.key !== c.key) })}>
                  <Icon name="x" size={16} />
                </button>
              </div>
            ))}
            {charges.length > 0 && (
              <Field label="تسهیم بین کالاها" htmlFor="inv-landed">
                <Picker<LandedMethod>
                  id="inv-landed"
                  title="روش تسهیم هزینه‌ها"
                  value={draft.landedMethod ?? 'value'}
                  onChange={(v) => update({ landedMethod: v })}
                  options={[
                    { value: 'value', label: 'به نسبت ارزش', description: 'کالای گران‌تر سهم بیشتری می‌گیرد (پیشنهادی)' },
                    { value: 'quantity', label: 'به نسبت تعداد', description: 'بر اساس تعداد به واحد اصلی هر کالا' },
                  ]}
                />
              </Field>
            )}
            <button type="button" className={styles.linkButton} onClick={() => update({ charges: [...charges, { key: `c${++keySeq}`, title: '', amount: '' }] })}>
              + افزودن هزینه جانبی
            </button>
          </div>
        )}

        <div className={styles.discountCard}>
          <label htmlFor="inv-discount">تخفیف کل فاکتور</label>
          <div className={styles.discountInput}>
            <MoneyInput id="inv-discount" value={draft.discount} onChange={(v) => update({ discount: v })} invalid={!!errors['discount']} placeholder="۰" suffix="تومان" />
          </div>
        </div>
        {errors['discount'] && <p className={styles.lineError}>{errors['discount']}</p>}
        <p className={styles.discountHint}>{kind === 'purchase' ? 'تخفیف از مبلغی که می‌پردازید کم می‌شود و بهای کالاها را هم کم می‌کند.' : 'تخفیف از مبلغی که از مشتری می‌گیرید کم می‌شود.'}</p>

        <PaymentSection
          kind={kind}
          party={parties.find((p) => p.id === draft.partyId) ?? null}
          payMode={draft.payMode ?? 'full'}
          paid={draft.paid ?? ''}
          total={totals.total}
          error={errors['paidAmount']}
          onChange={(patch) => {
            update(patch)
            setErrors((e) => {
              const next = { ...e }
              delete next['paidAmount']
              return next
            })
          }}
        />

        {formError && (
          <div className={styles.errorBox} role="alert">
            <strong>
              <Icon name="alert" size={17} /> ثبت انجام نشد
            </strong>
            <p>{formError}</p>
          </div>
        )}
        <div className={styles.noticeBox}>
          <strong>
            <Icon name="info" size={17} /> توجه
          </strong>
          <p>پس از ثبت، فاکتور قابل ویرایش نیست؛ فقط می‌توانید آن را ابطال کنید.</p>
        </div>

        <div className={styles.footer}>
          {totals.discount > 0 && (
            <div className={styles.subRow}>
              <span>جمع ردیف‌ها {formatMoney(totals.subtotal)}</span>
              <span>تخفیف {formatMoney(totals.discount)}</span>
            </div>
          )}
          {totals.landedTotal > 0 && (
            <div className={styles.subRow}>
              <span>هزینه‌های جانبی {formatMoney(totals.landedTotal)}</span>
              <span>جزو مبلغ قابل پرداخت نیست</span>
            </div>
          )}
          <div className={styles.totalRow}>
            <span>{props.totalLabel}</span>
            <strong data-testid="invoice-total">{formatMoney(totals.total)}</strong>
          </div>
          <Button type="submit" block loading={saving}>
            {props.submitLabel}
          </Button>
        </div>
      </form>

      {picker && <ProductPicker warehouseId={draft.warehouseId} exclude={exclude} requireStock={props.checkStock} onPick={(p) => void addProduct(p)} onClose={() => setPicker(false)} />}
      {newParty && (
        <PartySheet
          label={partyLabel}
          party={null}
          onClose={() => setNewParty(false)}
          onSave={props.createParty}
          onSaved={(party) => {
            setParties((list) => [...list, party])
            update({ partyId: party.id })
            setNewParty(false)
          }}
        />
      )}
      <ConfirmSheet
        open={confirmLeave}
        title="خروج بدون ثبت؟"
        message="کالاهایی که وارد کرده‌اید ذخیره نمی‌شوند."
        confirmLabel="بله، خارج شو"
        onConfirm={async () => props.onBack()}
        onCancel={() => setConfirmLeave(false)}
      />
    </>
  )
}
