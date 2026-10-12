import { useCallback, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Button, ButtonLink } from '../components/Button'
import { Card } from '../components/Card'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { EmptyState } from '../components/EmptyState'
import { Field, MoneyInput, TextArea } from '../components/Field'
import { JalaliDatePicker } from '../components/JalaliDatePicker'
import { PageHeader } from '../components/PageHeader'
import { PartySheet } from '../components/PartySheet'
import { SegmentedControl } from '../components/SegmentedControl'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { IconButton } from '../components/Button'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { LEDGER_TYPE_LABELS, type LedgerEntry } from '../models/money'
import { partyRoleLabel } from '../models/party'
import { getCatalog, getMoney } from '../services/appContext'
import { draftDate, isFutureDay } from '../services/invoiceForm'
import { ValidationError, toUserMessage } from '../utils/errors'
import { formatPersianDateTime } from '../utils/date'
import { newId } from '../utils/id'
import { toJalali } from '../utils/jalali'
import { formatMoney } from '../utils/money'
import { parseIntegerInput, toPersianDigits } from '../utils/persian'
import { BalanceText } from './parties/PartiesPage'
import styles from './money/Money.module.css'

function entryLink(e: LedgerEntry): string | null {
  if (e.type === 'sale') return `/sales/${e.id}`
  if (e.type === 'purchase') return `/purchases/${e.id}`
  if (e.type === 'sale_return' || e.type === 'purchase_return') return null
  return `/money/${e.id}`
}

/** صفحه حساب یک طرف: مانده، گردش (فاکتورها، برگشت‌ها، دریافت/پرداخت) و ثبت سند */
export default function PartyLedgerPage() {
  const { id = '' } = useParams()
  const goBack = useGoBack('/more/parties')
  const navigate = useNavigate()
  const toast = useToast()
  const load = useCallback(async () => {
    const party = await getCatalog().parties.getById(id)
    if (!party) return null
    const [ledger, balance, plan] = await Promise.all([getMoney().ledger(id), getMoney().balanceOf(id), getMoney().settlePlan(id)])
    return { party, ledger, balance, plan }
  }, [id])
  const { data, error, loading, reload } = useAsync(load)
  const [editing, setEditing] = useState(false)
  const [opening, setOpening] = useState(false)
  const [confirm, setConfirm] = useState<'deactivate' | 'delete' | null>(null)
  const [settling, setSettling] = useState(false)
  const [settleRequest, setSettleRequest] = useState(newId)

  if (error && data === undefined) {
    return (
      <>
        <PageHeader title="حساب طرف" onBack={goBack} />
        <EmptyState icon="alert" title="حساب باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      </>
    )
  }
  if (loading || data === undefined) return <PageHeader title="حساب طرف" onBack={goBack} />
  if (data === null) {
    return (
      <>
        <PageHeader title="حساب طرف" onBack={goBack} />
        <EmptyState icon="help" title="طرف حساب پیدا نشد" description="این طرف حساب وجود ندارد یا حذف شده است." action={<ButtonLink to="/more/parties">فهرست طرف حساب‌ها</ButtonLink>} />
      </>
    )
  }

  const { party, ledger, balance, plan } = data
  const rows = [...ledger].reverse()

  return (
    <>
      <PageHeader title={party.name} onBack={goBack} actions={party.isSystem ? undefined : <IconButton icon="edit" label="ویرایش" onClick={() => setEditing(true)} />} />
      <Card>
        <div className={styles.summary} data-testid="party-balance">
          <span className={styles.meta}>
            {partyRoleLabel(party)}
            {party.phone ? ` | ${toPersianDigits(party.phone)}` : ''}
            {!party.isActive ? ' | غیرفعال' : ''}
          </span>
          <span className={styles.big}>
            <BalanceText balance={balance} />
          </span>
          <span className={styles.meta}>
            {balance > 0 ? 'این مبلغ را باید از او بگیرید.' : balance < 0 ? 'این مبلغ را باید به او بدهید (یا از خرید/فروش بعدی کم شود).' : 'حساب صاف است.'}
          </span>
        </div>
      </Card>

      {party.isSystem ? (
        <p className={styles.meta} style={{ margin: '12px 2px' }}>
          «{party.name}» برای فروش/خرید نقدی و بی‌نام است و حساب نسیه ندارد؛ فاکتورهای آن همیشه کامل پرداخت می‌شوند.
        </p>
      ) : (
        <div className={styles.actions}>
          <ButtonLink icon="wallet" to={`/money/new?kind=receipt&party=${party.id}`}>
            دریافت از او
          </ButtonLink>
          <ButtonLink variant="secondary" icon="wallet" to={`/money/new?kind=payment&party=${party.id}`}>
            پرداخت به او
          </ButtonLink>
          <Button variant="secondary" icon="plus" onClick={() => setOpening(true)}>
            مانده اول دوره
          </Button>
          {plan && party.isActive && (
            <Button variant="secondary" icon="check" onClick={() => setSettling(true)} data-testid="settle-balance">
              {plan.kind === 'payment' ? `پس دادن طلب او (${formatMoney(plan.amount)})` : `دریافت مانده (${formatMoney(plan.amount)})`}
            </Button>
          )}
        </div>
      )}

      <h2 className={styles.sectionTitle}>گردش حساب</h2>
      {rows.length === 0 ? (
        <EmptyState compact icon="file" title="هنوز گردشی ندارد" description="فاکتورها، برگشت‌ها و دریافت/پرداخت‌های این طرف اینجا با مانده هر مرحله دیده می‌شوند." />
      ) : (
        <Card>
          <ul className={styles.list} data-testid="ledger">
            {rows.map((e) => {
              const link = entryLink(e)
              const cancelled = e.status === 'cancelled'
              const body = (
                <>
                  <span className={styles.rowMain}>
                    <strong>
                      {LEDGER_TYPE_LABELS[e.type]} {toPersianDigits(e.number)}
                    </strong>
                    <span className={styles.meta}>
                      {formatPersianDateTime(e.date)}
                      {e.source && e.source !== 'manual' ? ' | خودکار' : ''}
                    </span>
                  </span>
                  {cancelled && <Badge tone="error">ابطال‌شده</Badge>}
                  <span className={styles.rowEnd}>
                    <span className={`${e.delta > 0 ? styles.plus : styles.minus} ${cancelled ? styles.struck : ''}`}>
                      {e.delta > 0 ? 'بدهکار ' : 'بستانکار '}
                      {formatMoney(Math.abs(e.delta))}
                    </span>
                    <span className={styles.meta}>مانده: {balanceShort(e.balance)}</span>
                  </span>
                </>
              )
              return (
                <li key={`${e.type}-${e.id}`}>
                  {link ? (
                    <button type="button" className={styles.row} onClick={() => navigate(link)}>
                      {body}
                    </button>
                  ) : (
                    <div className={styles.row}>{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {editing && (
        <PartySheet
          label="طرف حساب"
          party={party}
          roles
          onClose={() => setEditing(false)}
          onSave={(input) => getCatalog().parties.update(party.id, input)}
          onSaved={() => {
            toast.show('تغییرات ذخیره شد.')
            setEditing(false)
            reload()
          }}
          extra={
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => setConfirm('deactivate')}>
                {party.isActive ? 'غیرفعال کردن' : 'فعال کردن'}
              </Button>
              <Button variant="danger" icon="trash" onClick={() => setConfirm('delete')}>
                حذف
              </Button>
            </div>
          }
        />
      )}
      <ConfirmSheet
        open={confirm !== null}
        tone={confirm === 'delete' ? 'danger' : 'warning'}
        title={confirm === 'delete' ? 'حذف طرف حساب؟' : party.isActive ? 'غیرفعال شود؟' : 'فعال شود؟'}
        message={
          confirm === 'delete'
            ? 'فقط طرفی که هیچ فاکتور یا سندی ندارد حذف می‌شود. در غیر این صورت غیرفعالش کنید تا سابقه بماند.'
            : party.isActive
              ? 'در فرم‌های جدید پیشنهاد نمی‌شود، ولی حساب و سابقه‌اش می‌ماند.'
              : 'دوباره در فرم‌ها پیشنهاد می‌شود.'
        }
        confirmLabel={confirm === 'delete' ? 'بله، حذف شود' : 'بله'}
        onConfirm={async () => {
          if (confirm === 'delete') {
            await getCatalog().parties.remove(party.id)
            toast.show('طرف حساب حذف شد.')
            navigate('/more/parties', { replace: true })
            return
          }
          await getCatalog().parties.setActive(party.id, !party.isActive)
          setConfirm(null)
          setEditing(false)
          reload()
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmSheet
        open={settling && !!plan}
        tone="warning"
        title={plan?.kind === 'payment' ? 'تسویه بستانکاری' : 'دریافت مانده'}
        message={
          plan
            ? plan.kind === 'payment'
              ? `یک سند پرداخت نقدی ${formatMoney(plan.amount, { withUnit: true })} به «${party.name}» ثبت می‌شود و حساب صاف می‌شود.`
              : `یک سند دریافت نقدی ${formatMoney(plan.amount, { withUnit: true })} از «${party.name}» ثبت می‌شود و حساب صاف می‌شود.`
            : ''
        }
        confirmLabel="بله، ثبت شود"
        onConfirm={async () => {
          await getMoney().settleBalance(party.id, { requestId: settleRequest })
          setSettling(false)
          setSettleRequest(newId())
          toast.show('حساب تسویه شد.')
          reload()
        }}
        onCancel={() => setSettling(false)}
      />
      {opening && (
        <OpeningSheet
          partyId={party.id}
          onClose={() => setOpening(false)}
          onSaved={() => {
            toast.show('مانده اول دوره ثبت شد.')
            setOpening(false)
            reload()
          }}
        />
      )}
    </>
  )
}

function balanceShort(b: number): string {
  if (b === 0) return 'تسویه'
  return `${formatMoney(Math.abs(b))} ${b > 0 ? 'بد' : 'بس'}`
}

function OpeningSheet({ partyId, onClose, onSaved }: { partyId: string; onClose: () => void; onSaved: () => void }) {
  const [requestId] = useState(newId)
  const [amount, setAmount] = useState('')
  const [side, setSide] = useState<'debit' | 'credit'>('debit')
  const [day, setDay] = useState(() => toJalali(new Date()))
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (saving) return
    const value = parseIntegerInput(amount)
    if (!value || value <= 0) return setErrors({ amount: 'مبلغ را وارد کنید.' })
    if (isFutureDay(day)) return setErrors({ docDate: 'تاریخ نمی‌تواند در آینده باشد.' })
    setSaving(true)
    setErrors({})
    try {
      await getMoney().createOpening({ partyId, amount: value, side, docDate: draftDate(day), note, requestId })
      onSaved()
    } catch (e) {
      setErrors(e instanceof ValidationError ? { ...e.fieldErrors } : { form: toUserMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open title="مانده اول دوره" onClose={onClose}>
      <form className={styles.sheetBody} noValidate onSubmit={(e) => (e.preventDefault(), void save())}>
        <p className={styles.meta}>حسابی که قبل از شروع کار با برنامه داشتید. مثل بقیه اسناد ثبت می‌شود و فقط با ابطال قابل اصلاح است.</p>
        <Field label="مبلغ" required htmlFor="opening-amount" error={errors['amount']}>
          <MoneyInput id="opening-amount" value={amount} onChange={setAmount} invalid={!!errors['amount']} suffix="تومان" />
        </Field>
        <SegmentedControl
          label="نوع مانده"
          options={[
            { value: 'debit', label: 'او به من بدهکار است' },
            { value: 'credit', label: 'من به او بدهکارم' },
          ]}
          value={side}
          onChange={setSide}
        />
        <Field label="تاریخ" htmlFor="opening-date" error={errors['docDate']}>
          <JalaliDatePicker id="opening-date" value={day} onChange={setDay} />
        </Field>
        <Field label="توضیحات" htmlFor="opening-note" error={errors['note']}>
          <TextArea id="opening-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
        {errors['form'] && (
          <p className={styles.error} role="alert">
            {errors['form']}
          </p>
        )}
        <Button type="submit" block loading={saving}>
          ثبت مانده
        </Button>
      </form>
    </Sheet>
  )
}
