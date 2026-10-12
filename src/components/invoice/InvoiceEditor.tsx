import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { Product, Warehouse } from '../../models/catalog'
import type { Customer, PartyInput, Supplier } from '../../models/party'
import { useAsync } from '../../hooks/useAsync'
import { getStock } from '../../services/appContext'
import { draftToInput, draftTotals, isFutureDay, lineError, mapServiceErrors, stepQuantity, type DraftInput, type InvoiceDraft, type LineDraft } from '../../services/invoiceForm'
import { toUserMessage } from '../../utils/errors'
import { toJalali } from '../../utils/jalali'
import { formatMoney } from '../../utils/money'
import { formatInteger } from '../../utils/persian'
import { formatQuantityWithUnit, quantityToInputText, QUANTITY_SCALE } from '../../utils/quantity'
import { Button } from '../Button'
import { ConfirmSheet } from '../ConfirmSheet'
import { Field, MoneyInput, QuantityInput, SelectInput, TextInput } from '../Field'
import { Icon } from '../Icon'
import { JalaliDatePicker } from '../JalaliDatePicker'
import { PageHeader } from '../PageHeader'
import { PartySheet } from '../PartySheet'
import { ProductPicker } from './ProductPicker'
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
  }))
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
    setDraft((d) => ({ ...d, lines: [...d.lines, { key, product, quantity: quantityToInputText(QUANTITY_SCALE), unitPrice: price ? formatInteger(price) : '', discount: '' }] }))
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
              <SelectInput id="inv-party" value={draft.partyId} onChange={(e) => update({ partyId: e.target.value })} invalid={!!errors['party']}>
                {activeParties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </SelectInput>
              <button type="button" className={styles.squareButton} aria-label={`${partyLabel} جدید`} title={`${partyLabel} جدید`} onClick={() => setNewParty(true)}>
                <Icon name="plus" size={19} />
              </button>
            </div>
          </Field>
          <Field label="انبار" htmlFor="inv-warehouse" error={errors['warehouse']}>
            <SelectInput id="inv-warehouse" value={draft.warehouseId} onChange={(e) => update({ warehouseId: e.target.value })} invalid={!!errors['warehouse']}>
              {activeWarehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </SelectInput>
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
          const p = errors[lineError(line.key, 'unitPrice')]
          const d = errors[lineError(line.key, 'discount')]
          const prod = errors[lineError(line.key, 'product')]
          const invalid = !!(q || p || d || prod)
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
              <div className={styles.lineGrid}>
                <Field label={`تعداد (${line.product.unitName})`} htmlFor={`q-${line.key}`} error={q}>
                  <div className={styles.stepper}>
                    <button type="button" aria-label="کم کردن" onClick={() => updateLine(line.key, { quantity: stepQuantity(line.quantity, line.product, -1) })}>
                      −
                    </button>
                    <QuantityInput id={`q-${line.key}`} value={line.quantity} onChange={(v) => updateLine(line.key, { quantity: v })} invalid={!!q} />
                    <button type="button" aria-label="زیاد کردن" onClick={() => updateLine(line.key, { quantity: stepQuantity(line.quantity, line.product, 1) })}>
                      +
                    </button>
                  </div>
                </Field>
                <Field label="قیمت واحد (تومان)" htmlFor={`p-${line.key}`} error={p} hint={props.priceHint?.(line.product)}>
                  <MoneyInput id={`p-${line.key}`} value={line.unitPrice} onChange={(v) => updateLine(line.key, { unitPrice: v })} invalid={!!p} placeholder="قیمت" />
                </Field>
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

        <div className={styles.discountCard}>
          <label htmlFor="inv-discount">تخفیف کل فاکتور</label>
          <div className={styles.discountInput}>
            <MoneyInput id="inv-discount" value={draft.discount} onChange={(v) => update({ discount: v })} invalid={!!errors['discount']} placeholder="۰" suffix="تومان" />
          </div>
        </div>
        {errors['discount'] && <p className={styles.lineError}>{errors['discount']}</p>}
        <p className={styles.discountHint}>{kind === 'purchase' ? 'تخفیف از مبلغی که می‌پردازید کم می‌شود و بهای کالاها را هم کم می‌کند.' : 'تخفیف از مبلغی که از مشتری می‌گیرید کم می‌شود.'}</p>

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
