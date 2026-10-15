import { useEffect, useState } from 'react'
import { ROLE_LABELS } from '../models/permissions'
import { getUsers } from '../services/appContext'
import { lastUserId } from '../services/session'
import type { UserRow } from '../services/userService'
import { toUserMessage } from '../utils/errors'
import { toEnglishDigits, toPersianDigits } from '../utils/persian'
import { Button } from './Button'
import { Field, TextInput } from './Field'
import { Icon } from './Icon'
import styles from './LockScreen.module.css'

/** صفحه ورود کاربر (فقط وقتی حالت چندکاربره روشن است) */
export function LockScreen() {
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [selected, setSelected] = useState<UserRow | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)

  useEffect(() => {
    void getUsers()
      .loginList()
      .then((list) => {
        setUsers(list)
        // آخرین کاربر واردشده (فقط شناسه در حافظه دستگاه؛ رمز هرگز ذخیره نمی‌شود)
        const last = lastUserId()
        const pre = list.length === 1 ? list[0] : list.find((u) => u.id === last)
        if (pre) setSelected(pre)
      })
  }, [])

  const submit = async () => {
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    try {
      await getUsers().login(selected.id, pin)
    } catch (e) {
      setError(toUserMessage(e))
      setPin('')
    } finally {
      setBusy(false)
    }
  }
  const press = (d: string) => setPin((p) => (p.length < 8 ? p + d : p))

  return (
    <div className={styles.screen} data-testid="lock-screen">
      <div className={styles.brand}>
        <span className={styles.logo}>
          <Icon name="shield" size={26} />
        </span>
        <h1>انباردار</h1>
        <p>{selected ? (forgot ? `بازیابی رمز ${selected.name}` : `ورود ${selected.name}`) : 'کاربر خود را انتخاب کنید'}</p>
      </div>
      {!selected && (
        <ul className={styles.users}>
          {users?.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => (setSelected(u), setForgot(false), setPin(''), setError(null))} data-testid="lock-user">
                <strong>{u.name}</strong>
                <span>{ROLE_LABELS[u.role]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && forgot && <ForgotPin user={selected} onBack={() => (setForgot(false), setPin(''), setError(null))} />}
      {selected && !forgot && (
        <form
          className={styles.pinForm}
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label htmlFor="lock-pin" className={styles.label}>
            رمز (۴ تا ۸ رقم)
          </label>
          <input
            id="lock-pin"
            className={styles.pin}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={toPersianDigits(pin)}
            onChange={(e) => setPin(toEnglishDigits(e.target.value).replace(/\D/g, '').slice(0, 8))}
            aria-invalid={!!error}
            autoFocus
          />
          {error && (
            <p className={styles.error} role="alert" data-testid="lock-error">
              {error}
            </p>
          )}
          <div className={styles.pad}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button type="button" key={d} onClick={() => press(d)}>
                {toPersianDigits(d)}
              </button>
            ))}
            <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="پاک کردن">
              ⌫
            </button>
            <button type="button" onClick={() => press('0')}>
              ۰
            </button>
            <button type="submit" className={styles.ok} aria-label="ورود" disabled={pin.length < 4 || busy}>
              <Icon name="check" size={20} />
            </button>
          </div>
          <Button type="submit" block loading={busy} disabled={pin.length < 4} data-testid="lock-submit">
            ورود
          </Button>
          <button type="button" className={styles.switch} onClick={() => (setForgot(true), setError(null))} data-testid="lock-forgot">
            رمز را فراموش کردم
          </button>
          {users && users.length > 1 && (
            <button type="button" className={styles.switch} onClick={() => (setSelected(null), setPin(''), setError(null))}>
              کاربر دیگر
            </button>
          )}
        </form>
      )}
    </div>
  )
}

/** «رمز را فراموش کردم»: دو سؤال بازیابی ← رمز تازه */
function ForgotPin({ user, onBack }: { user: UserRow; onBack: () => void }) {
  const [questions, setQuestions] = useState<{ q1: string; q2: string } | null | undefined>(undefined)
  const [a1, setA1] = useState('')
  const [a2, setA2] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void getUsers().recoveryQuestions(user.id).then(setQuestions)
  }, [user.id])
  const digits = (v: string) => toEnglishDigits(v).replace(/\D/g, '').slice(0, 8)
  const submit = async () => {
    if (busy) return
    if (!a1.trim() || !a2.trim()) return setError('جواب هر دو سؤال را بنویسید.')
    if (!/^\d{4,8}$/.test(pin)) return setError('رمز تازه باید ۴ تا ۸ رقم باشد.')
    if (pin !== pin2) return setError('تکرار رمز تازه یکی نیست.')
    setBusy(true)
    setError(null)
    try {
      await getUsers().recover(user.id, { a1, a2 }, pin)
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.forgot} data-testid="forgot-pin">
      {questions === null && (
        <p className={styles.notice} data-testid="forgot-none">
          برای «{user.name}» سؤال بازیابی ثبت نشده است. از «مالک» بخواهید از «بیشتر ← کاربران» رمز تازه بگذارد. اگر خودتان مالک هستید و رمز را فراموش کرده‌اید، تنها راه بازگرداندن آخرین پشتیبان است.
        </p>
      )}
      {questions && (
        <form className={styles.forgotForm} noValidate onSubmit={(e) => (e.preventDefault(), void submit())}>
          <p className={styles.notice}>به سؤال‌هایی که خودتان نوشته‌اید جواب بدهید، بعد رمز تازه بگذارید.</p>
          <Field label={questions.q1} required htmlFor="forgot-a1">
            <TextInput id="forgot-a1" value={a1} onChange={(e) => setA1(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={questions.q2} required htmlFor="forgot-a2">
            <TextInput id="forgot-a2" value={a2} onChange={(e) => setA2(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="رمز تازه (۴ تا ۸ رقم)" required htmlFor="forgot-pin">
            <TextInput id="forgot-pin" type="password" inputMode="numeric" dir="ltr" autoComplete="new-password" value={pin} onChange={(e) => setPin(digits(e.target.value))} />
          </Field>
          <Field label="تکرار رمز تازه" required htmlFor="forgot-pin2">
            <TextInput id="forgot-pin2" type="password" inputMode="numeric" dir="ltr" autoComplete="new-password" value={pin2} onChange={(e) => setPin2(digits(e.target.value))} />
          </Field>
          {error && (
            <p className={styles.error} role="alert" data-testid="forgot-error">
              {error}
            </p>
          )}
          <Button type="submit" block loading={busy} data-testid="forgot-submit">
            رمز تازه و ورود
          </Button>
        </form>
      )}
      <button type="button" className={styles.switch} onClick={onBack} data-testid="forgot-back">
        بازگشت به ورود با رمز
      </button>
    </div>
  )
}
