import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Button, IconButton } from '../components/Button'
import { Chip } from '../components/Chip'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { EmptyState } from '../components/EmptyState'
import { Field, MoneyInput, SelectInput, TextArea, TextInput } from '../components/Field'
import { JalaliDatePicker } from '../components/JalaliDatePicker'
import { PageHeader } from '../components/PageHeader'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import {
  EXPENSE_CATEGORIES,
  expenseCategoryLabel,
  type Expense,
  type ExpenseCategory,
  type ExpenseStatus,
} from '../models/expense'
import { getExpenses } from '../services/appContext'
import { formatPersianDateTime } from '../utils/date'
import { toUserMessage, ValidationError } from '../utils/errors'
import { fromJalali, toJalali, type JalaliDate } from '../utils/jalali'
import { formatMoney } from '../utils/money'
import { parseIntegerInput } from '../utils/persian'
import styles from './ExpensesPage.module.css'

type View = { kind: 'new' } | { kind: 'detail'; id: string } | null

/** فهرست و ثبت هزینه‌های جاری (اجاره، حقوق، قبوض، حمل‌ونقل، سایر) */
export default function ExpensesPage() {
  const goBack = useGoBack('/more')
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const status = (params.get('s') as ExpenseStatus | null) ?? undefined
  const category = (params.get('c') as ExpenseCategory | null) ?? undefined
  const [view, setView] = useState<View>(null)

  const load = useCallback(() => getExpenses().list({ status, category, limit: 200 }), [status, category])
  const { data, error, loading, reload } = useAsync(load)

  const set = useCallback(
    (key: string, value: string | undefined) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (value) next.set(key, value)
          else next.delete(key)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  const filtered = !!status || !!category

  return (
    <div className={styles.page} data-testid="expenses-page">
      <PageHeader title="هزینه‌ها" onBack={goBack} actions={<IconButton icon="plus" label="ثبت هزینه" onClick={() => setView({ kind: 'new' })} />} />
      <div className={styles.chips}>
        <Chip label="همه" selected={!status} onClick={() => set('s', undefined)} />
        <Chip label="فعال" selected={status === 'active'} onClick={() => set('s', 'active')} />
        <Chip label="ابطال‌شده" selected={status === 'cancelled'} onClick={() => set('s', 'cancelled')} />
      </div>
      <div className={styles.chips}>
        <Chip label="همه دسته‌ها" selected={!category} onClick={() => set('c', undefined)} />
        {EXPENSE_CATEGORIES.map((c) => (
          <Chip key={c} label={expenseCategoryLabel(c, true)} selected={category === c} onClick={() => set('c', c)} />
        ))}
      </div>

      {error && !data ? (
        <EmptyState icon="alert" title="فهرست باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      ) : loading || !data ? (
        <div aria-busy="true" className={styles.skeleton} />
      ) : data.length === 0 ? (
        filtered ? (
          <EmptyState compact icon="search" title="هزینه‌ای پیدا نشد" description="فیلتر را تغییر دهید." />
        ) : (
          <EmptyState
            icon="wallet"
            title="هنوز هزینه‌ای ثبت نشده"
            description="اجاره، حقوق، قبوض و حمل‌ونقل را اینجا ثبت کنید تا در سود و زیان واقعی دیده شوند."
            action={<Button icon="plus" onClick={() => setView({ kind: 'new' })}>ثبت هزینه</Button>}
          />
        )
      ) : (
        <ul className={styles.list}>
          {data.map((expense) => (
            <li key={expense.id}>
              <button
                type="button"
                className={`${styles.row} ${expense.status === 'cancelled' ? styles.cancelled : ''}`}
                onClick={() => setView({ kind: 'detail', id: expense.id })}
              >
                <span className={styles.main}>
                  <strong>{expenseCategoryLabel(expense.category)}</strong>
                  <span>
                    {formatPersianDateTime(expense.expenseDate)}
                    {expense.note ? ` | ${expense.note}` : ''}
                  </span>
                </span>
                <span className={styles.amount}>
                  <strong>{formatMoney(expense.amount, { withUnit: false })}</strong>
                  {expense.status === 'cancelled' ? <Badge tone="error">ابطال‌شده</Badge> : <span>تومان</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {view?.kind === 'new' && (
        <ExpenseFormSheet
          onClose={() => setView(null)}
          onSaved={() => {
            toast.show('هزینه ثبت شد.')
            setView(null)
            reload()
          }}
        />
      )}
      {view?.kind === 'detail' && (
        <ExpenseDetailSheet
          id={view.id}
          onClose={() => setView(null)}
          onChanged={() => {
            reload()
            setView(null)
          }}
        />
      )}
    </div>
  )
}

function ExpenseFormSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const today = toJalali(new Date())
  const [category, setCategory] = useState<ExpenseCategory>('rent')
  const [date, setDate] = useState<JalaliDate>(today)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const future = useMemo(() => {
    const t = toJalali(new Date())
    return date.jy > t.jy || (date.jy === t.jy && (date.jm > t.jm || (date.jm === t.jm && date.jd > t.jd)))
  }, [date])

  const submit = async () => {
    setErrors({})
    const n = parseIntegerInput(amount)
    if (n === null || n <= 0) {
      setErrors({ amount: 'مبلغ را به‌صورت عدد صحیح تومان وارد کنید.' })
      return
    }
    setBusy(true)
    try {
      const expenseDate = fromJalali(date, 12, 0).toISOString()
      await getExpenses().create({ category, expenseDate, amount: n, note: note.trim() || null })
      onSaved()
    } catch (e) {
      if (e instanceof ValidationError) setErrors({ ...e.fieldErrors })
      else setErrors({ _: toUserMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={true} title="ثبت هزینه" onClose={onClose}>
      <div className={styles.form}>
        <Field label="دسته" htmlFor="ex-cat" required error={errors.category}>
          <SelectInput id="ex-cat" value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} invalid={!!errors.category}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {expenseCategoryLabel(c)}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="تاریخ" htmlFor="ex-date" hint={future ? 'تاریخ آینده انتخاب شده است.' : undefined}>
          <JalaliDatePicker id="ex-date" value={date} onChange={setDate} />
        </Field>
        <Field label="مبلغ" htmlFor="ex-amount" required error={errors.amount}>
          <MoneyInput id="ex-amount" value={amount} onChange={setAmount} suffix="تومان" invalid={!!errors.amount} placeholder="مثلاً ۵٬۰۰۰٬۰۰۰" />
        </Field>
        <Field label="یادداشت (اختیاری)" htmlFor="ex-note" error={errors.note}>
          <TextArea id="ex-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="مثلاً اجاره مهر" />
        </Field>
        {errors._ && (
          <p role="alert" style={{ color: 'var(--error)', fontSize: 13 }}>
            {errors._}
          </p>
        )}
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            انصراف
          </Button>
          <Button onClick={submit} loading={busy} data-testid="expense-save">
            ثبت هزینه
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

function ExpenseDetailSheet({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const load = useCallback(() => getExpenses().getById(id), [id])
  const { data, error, loading, reload } = useAsync(load)
  const [asking, setAsking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')

  if (loading || data === undefined) {
    return (
      <Sheet open={true} title="جزئیات هزینه" onClose={onClose}>
        <div className={styles.skeleton} aria-busy="true" />
      </Sheet>
    )
  }
  if (error || !data) {
    return (
      <Sheet open={true} title="جزئیات هزینه" onClose={onClose}>
        <EmptyState icon="alert" title="باز نشد" description={error ?? 'پیدا نشد.'} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      </Sheet>
    )
  }
  const expense: Expense = data
  const cancelled = expense.status === 'cancelled'

  return (
    <>
      <Sheet open={true} title="جزئیات هزینه" onClose={onClose}>
        {cancelled && (
          <div className={styles.cancelBox}>
            این هزینه ابطال شده است.
            {expense.cancelReason ? ` دلیل: ${expense.cancelReason}` : ''}
          </div>
        )}
        <dl className={styles.detail}>
          <dt>دسته</dt>
          <dd>{expenseCategoryLabel(expense.category)}</dd>
          <dt>تاریخ</dt>
          <dd>{formatPersianDateTime(expense.expenseDate)}</dd>
          <dt>مبلغ</dt>
          <dd>{formatMoney(expense.amount)}</dd>
          {expense.note && (
            <>
              <dt>یادداشت</dt>
              <dd>{expense.note}</dd>
            </>
          )}
        </dl>
        {!cancelled && (
          <div className={styles.actions}>
            <Button variant="danger" onClick={() => setAsking(true)}>
              ابطال هزینه
            </Button>
          </div>
        )}
      </Sheet>
      <Sheet open={asking && !confirming} title="ابطال هزینه" onClose={() => setAsking(false)}>
        <div className={styles.form}>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>مبلغ از گزارش سود و زیان حذف می‌شود. هزینه حذف نمی‌شود و به‌صورت ابطال‌شده می‌ماند.</p>
          <Field label="دلیل (اختیاری)" htmlFor="ex-cancel-reason">
            <TextInput id="ex-cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button variant="danger" block onClick={() => setConfirming(true)}>
            ادامه
          </Button>
        </div>
      </Sheet>
      <ConfirmSheet
        open={confirming}
        tone="danger"
        title="ابطال قطعی؟"
        message="این هزینه ابطال می‌شود و از سود و زیان خارج می‌گردد."
        confirmLabel="بله، ابطال شود"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          await getExpenses().cancel(id, reason.trim() || null)
          toast.show('هزینه ابطال شد.')
          setConfirming(false)
          setAsking(false)
          onChanged()
        }}
      />
    </>
  )
}
