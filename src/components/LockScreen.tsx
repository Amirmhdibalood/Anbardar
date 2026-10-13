import { useEffect, useState } from 'react'
import { ROLE_LABELS } from '../models/permissions'
import { getUsers } from '../services/appContext'
import type { UserRow } from '../services/userService'
import { toUserMessage } from '../utils/errors'
import { toEnglishDigits, toPersianDigits } from '../utils/persian'
import { Button } from './Button'
import { Icon } from './Icon'
import styles from './LockScreen.module.css'

/** صفحه ورود کاربر (فقط وقتی حالت چندکاربره روشن است) */
export function LockScreen() {
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [selected, setSelected] = useState<UserRow | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void getUsers()
      .loginList()
      .then((list) => {
        setUsers(list)
        if (list.length === 1) setSelected(list[0]!)
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
        <p>{selected ? `ورود ${selected.name}` : 'کاربر خود را انتخاب کنید'}</p>
      </div>
      {!selected && (
        <ul className={styles.users}>
          {users?.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => (setSelected(u), setPin(''), setError(null))} data-testid="lock-user">
                <strong>{u.name}</strong>
                <span>{ROLE_LABELS[u.role]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
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
