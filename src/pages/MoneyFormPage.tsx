import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Field, MoneyInput, SelectInput, TextArea } from '../components/Field'
import { JalaliDatePicker } from '../components/JalaliDatePicker'
import { PageHeader } from '../components/PageHeader'
import { SegmentedControl } from '../components/SegmentedControl'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { MONEY_METHOD_LABELS, type MoneyMethod } from '../models/money'
import { compareFa } from '../utils/collate'
import { getCatalog, getMoney } from '../services/appContext'
import { draftDate, isFutureDay } from '../services/invoiceForm'
import { suggestOldestFirst, type OpenInvoice } from '../services/moneyService'
import { ValidationError, toUserMessage } from '../utils/errors'
import { formatPersianDate } from '../utils/date'
import { newId } from '../utils/id'
import { toJalali } from '../utils/jalali'
import { formatMoney } from '../utils/money'
import { formatMoneyTyping } from '../services/productForm'
import { parseIntegerInput, toPersianDigits } from '../utils/persian'
import styles from './money/Money.module.css'

type Kind = 'receipt' | 'payment'
const METHODS = Object.keys(MONEY_METHOD_LABELS) as MoneyMethod[]
const money = (text: string) => (text.trim() ? parseIntegerInput(text) : 0)
const typed = (n: number) => (n > 0 ? formatMoneyTyping(String(n)) : '')

/** ثبت دریافت (از مشتری) یا پرداخت (به تأمین‌کننده)، با تخصیص اختیاری به فاکتورهای باز */
export default function MoneyFormPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [kind, setKind] = useState<Kind>(params.get('kind') === 'payment' ? 'payment' : 'receipt')
  const [partyId, setPartyId] = useState(params.get('party') ?? '')
  const invoiceParam = params.get('invoice')
  const goBack = useGoBack(partyId ? `/parties/${partyId}` : '/money')
  // شناسه یکتای فرم: دو بار زدن «ثبت» یا تکرار درخواست فقط یک سند می‌سازد
  const [requestId] = useState(newId)
  const [amount, setAmount] = useState('')
  const [day, setDay] = useState(() => toJalali(new Date()))
  const [method, setMethod] = useState<MoneyMethod>('cash')
  const [note, setNote] = useState('')
  const [alloc, setAlloc] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const loadParties = useCallback(() => getCatalog().parties.list(), [])
  const parties = useAsync(loadParties)
  const invoiceKind = kind === 'receipt' ? 'sales' : 'purchase'
  const loadOpen = useCallback(async (): Promise<OpenInvoice[]> => (partyId ? getMoney().openInvoices(invoiceKind, partyId) : []), [partyId, invoiceKind])
  const open = useAsync(loadOpen)

  // از دکمه «ثبت دریافت» فاکتور: مبلغ و تخصیص = مانده همان فاکتور
  const [prefilled, setPrefilled] = useState(false)
  if (!prefilled && invoiceParam && open.data) {
    setPrefilled(true)
    const inv = open.data.find((i) => i.id === invoiceParam)
    if (inv) {
      setAmount(typed(inv.settlement.remaining))
      setAlloc({ [inv.id]: typed(inv.settlement.remaining) })
    }
  }

  const choices = useMemo(() => {
    const role = kind === 'receipt' ? 'isCustomer' : 'isSupplier'
    return (parties.data ?? []).filter((p) => !p.isSystem).sort((a, b) => Number(b[role]) - Number(a[role]) || compareFa(a.name, b.name))
  }, [parties.data, kind])

  const total = money(amount)
  const allocSum = Object.values(alloc).reduce((s, t) => s + (money(t) ?? 0), 0)

  const suggest = () => {
    if (!open.data || !total) return
    const next: Record<string, string> = {}
    for (const a of suggestOldestFirst(open.data, total)) next[a.invoiceId] = typed(a.amount)
    setAlloc(next)
  }

  const save = async () => {
    if (saving) return
    const errs: Record<string, string> = {}
    if (!partyId) errs['partyId'] = 'طرف حساب را انتخاب کنید.'
    if (!total || total <= 0) errs['amount'] = 'مبلغ را وارد کنید.'
    if (isFutureDay(day)) errs['docDate'] = 'تاریخ نمی‌تواند در آینده باشد.'
    const allocations = Object.entries(alloc).flatMap(([invoiceId, t]) => {
      const v = money(t)
      if (v === null) errs['allocations'] = 'مبلغ تخصیص باید عدد صحیح باشد.'
      return v ? [{ invoiceId, amount: v }] : []
    })
    if (total && allocSum > total) errs['allocations'] = 'جمع تخصیص‌ها از مبلغ سند بیشتر است.'
    for (const a of allocations) {
      const inv = open.data?.find((i) => i.id === a.invoiceId)
      if (inv && a.amount > inv.settlement.remaining) errs['allocations'] = `تخصیص فاکتور ${toPersianDigits(inv.number)} از مانده آن بیشتر است.`
    }
    if (Object.keys(errs).length) return setErrors(errs)
    setSaving(true)
    setErrors({})
    try {
      const doc = await getMoney().create({ kind, partyId, amount: total!, docDate: draftDate(day), method, note, allocations, requestId })
      toast.show(kind === 'receipt' ? 'دریافت ثبت شد.' : 'پرداخت ثبت شد.')
      navigate(`/money/${doc.id}`, { replace: true })
    } catch (e) {
      setErrors(e instanceof ValidationError ? { ...e.fieldErrors } : { form: toUserMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  const title = kind === 'receipt' ? 'دریافت جدید' : 'پرداخت جدید'
  if (parties.data && choices.length === 0) {
    return (
      <>
        <PageHeader title={title} onBack={goBack} />
        <EmptyState icon="users" title="طرف حسابی ندارید" description="اول مشتری یا تأمین‌کننده را در «طرف حساب‌ها» اضافه کنید." action={<Button onClick={() => navigate('/more/parties')}>طرف حساب‌ها</Button>} />
      </>
    )
  }

  return (
    <>
      <PageHeader title={title} onBack={goBack} />
      <form className={styles.form} noValidate onSubmit={(e) => (e.preventDefault(), void save())} data-testid="money-form">
        <SegmentedControl
          label="نوع سند"
          options={[
            { value: 'receipt', label: 'دریافت (از او گرفتم)' },
            { value: 'payment', label: 'پرداخت (به او دادم)' },
          ]}
          value={kind}
          onChange={(k) => (setKind(k), setAlloc({}))}
        />
        <Field label="طرف حساب" required htmlFor="money-party" error={errors['partyId']}>
          <SelectInput id="money-party" value={partyId} onChange={(e) => (setPartyId(e.target.value), setAlloc({}))} invalid={!!errors['partyId']}>
            <option value="">انتخاب کنید</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="مبلغ" required htmlFor="money-amount" error={errors['amount']}>
          <MoneyInput id="money-amount" value={amount} onChange={setAmount} invalid={!!errors['amount']} suffix="تومان" />
        </Field>
        <Field label="روش" htmlFor="money-method">
          <SelectInput id="money-method" value={method} onChange={(e) => setMethod(e.target.value as MoneyMethod)}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {MONEY_METHOD_LABELS[m]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="تاریخ" htmlFor="money-date" error={errors['docDate']}>
          <JalaliDatePicker id="money-date" value={day} onChange={setDay} />
        </Field>

        {partyId && open.data && (
          <Card>
            <div className={styles.alloc} data-testid="allocations">
              <strong>تسویه فاکتورهای باز {kind === 'receipt' ? 'فروش' : 'خرید'} (اختیاری)</strong>
              {open.data.length === 0 ? (
                <span className={styles.meta}>فاکتور بازی ندارد. کل مبلغ به حساب او (علی‌الحساب) ثبت می‌شود.</span>
              ) : (
                <>
                  <span className={styles.meta}>هر مقدار را که تخصیص ندهید علی‌الحساب می‌ماند و از مانده کل حساب کم می‌شود.</span>
                  <Button type="button" variant="secondary" disabled={!total} onClick={suggest}>
                    پیشنهاد: قدیمی‌ترین اول
                  </Button>
                  {open.data.map((inv) => (
                    <div key={inv.id} className={styles.allocRow}>
                      <span>
                        فاکتور {toPersianDigits(inv.number)} | {formatPersianDate(new Date(inv.date))}
                        <br />
                        <span className={styles.meta}>مانده: {formatMoney(inv.settlement.remaining)}</span>
                      </span>
                      <MoneyInput
                        aria-label={`تخصیص به فاکتور ${toPersianDigits(inv.number)}`}
                        value={alloc[inv.id] ?? ''}
                        onChange={(v) => setAlloc((m) => ({ ...m, [inv.id]: v }))}
                        placeholder="۰"
                      />
                    </div>
                  ))}
                  <div className={styles.allocFoot}>
                    <span>تخصیص‌یافته: {formatMoney(allocSum)}</span>
                    <span>علی‌الحساب: {formatMoney(Math.max(0, (total ?? 0) - allocSum))}</span>
                  </div>
                </>
              )}
              {errors['allocations'] && (
                <p className={styles.error} role="alert">
                  {errors['allocations']}
                </p>
              )}
            </div>
          </Card>
        )}

        <Field label="توضیحات" htmlFor="money-note" error={errors['note']}>
          <TextArea id="money-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="مثلاً شماره چک یا کارت" />
        </Field>
        {errors['form'] && (
          <p className={styles.error} role="alert">
            {errors['form']}
          </p>
        )}
        <Button type="submit" block loading={saving}>
          {kind === 'receipt' ? 'ثبت دریافت' : 'ثبت پرداخت'}
        </Button>
      </form>
    </>
  )
}
