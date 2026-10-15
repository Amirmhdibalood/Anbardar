import { useState } from 'react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Field, Switch, TextInput } from '../../components/Field'
import { Sheet } from '../../components/Sheet'
import { useToast } from '../../components/Toast'
import { useSession } from '../../hooks/useSession'
import { getUsers } from '../../services/appContext'
import { toUserMessage } from '../../utils/errors'
import { toEnglishDigits } from '../../utils/persian'
import styles from '../SettingsPage.module.css'

/** روشن/خاموش کردن صفحه ورود (فقط مالک، وقتی کاربران روشن است) */
export function LoginSettings() {
  const { usersOn, loginOn, actor } = useSession()
  const toast = useToast()
  const [ask, setAsk] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!usersOn || actor?.role !== 'owner') return null

  const close = () => (setAsk(false), setPin(''), setError(null))
  const turnOff = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await getUsers().setLoginRequired(false, pin)
      close()
      toast.show('ورود خاموش شد؛ برنامه از این به بعد مستقیم و به‌نام مالک باز می‌شود.')
    } catch (e) {
      setError(toUserMessage(e))
      setPin('')
    } finally {
      setBusy(false)
    }
  }
  const turnOn = async () => {
    try {
      await getUsers().setLoginRequired(true)
      toast.show('ورود روشن شد؛ دفعه بعد هر کس با رمز خودش وارد می‌شود.')
    } catch (e) {
      toast.show(toUserMessage(e))
    }
  }

  return (
    <Card className={styles.group}>
      <h2 className={styles.heading}>ورود به برنامه</h2>
      <div data-testid="login-setting">
        <Switch
          checked={loginOn}
          onChange={(on) => (on ? void turnOn() : setAsk(true))}
          label="ورود با رمز"
          description={
            loginOn
              ? 'هر بار باز کردن برنامه، کاربر انتخاب و رمز وارد می‌شود.'
              : 'خاموش: برنامه بدون صفحه ورود و انتخاب کاربر باز می‌شود و همه کارها به‌نام «مالک» ثبت می‌شود.'
          }
        />
      </div>
      <Sheet open={ask} title="خاموش کردن ورود" onClose={close}>
        <form className={styles.sheetForm} noValidate onSubmit={(e) => (e.preventDefault(), void turnOff())} data-testid="login-off-form">
          <p className={styles.hint}>
            با خاموش کردن ورود، هر کسی که گوشی را باز کند با دسترسی کامل «مالک» کار می‌کند. کاربران و گزارش فعالیت‌ها می‌مانند و هر وقت خواستید می‌توانید ورود را دوباره روشن کنید. برای تأیید، رمز مالک ({actor.name}) را وارد کنید.
          </p>
          <Field label="رمز مالک" required htmlFor="login-off-pin" error={error ?? undefined}>
            <TextInput id="login-off-pin" type="password" inputMode="numeric" dir="ltr" autoComplete="off" value={pin} onChange={(e) => setPin(toEnglishDigits(e.target.value).replace(/\D/g, '').slice(0, 8))} invalid={!!error} />
          </Field>
          <Button type="submit" variant="danger" block loading={busy} disabled={pin.length < 4} data-testid="login-off-confirm">
            خاموش کردن ورود
          </Button>
          <Button variant="secondary" block onClick={close} disabled={busy}>
            انصراف
          </Button>
        </form>
      </Sheet>
    </Card>
  )
}
