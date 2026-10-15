import { useEffect, useState } from 'react'
import { getUsers } from '../services/appContext'
import { toUserMessage, ValidationError } from '../utils/errors'
import { toEnglishDigits } from '../utils/persian'
import { Button } from './Button'
import { Field, TextInput } from './Field'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import styles from './RecoverySetupSheet.module.css'

interface Props {
  open: boolean
  userId: string
  userName: string
  /** رمزی که همین الان ساخته/عوض شد؛ اگر نباشد رمز فعلی پرسیده می‌شود */
  knownPin?: string
  /** true = بلافاصله بعد از ساخت رمز (دکمه «فعلاً نه» با هشدار) */
  afterPin?: boolean
  onClose: (saved: boolean) => void
}

const EXAMPLES = ['نام اولین معلم دبستان؟', 'نام کوچه‌ای که در کودکی در آن بودید؟', 'غذای مورد علاقه مادرتان؟']

/** ثبت/ویرایش دو سؤال بازیابی رمز (پاسخ‌ها فقط به‌صورت هش ذخیره می‌شوند) */
export function RecoverySetupSheet({ open, userId, userName, knownPin, afterPin, onClose }: Props) {
  const [q1, setQ1] = useState('')
  const [a1, setA1] = useState('')
  const [q2, setQ2] = useState('')
  const [a2, setA2] = useState('')
  const [pin, setPin] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [warn, setWarn] = useState(false)
  useEffect(() => {
    if (!open) return
    let live = true
    void getUsers()
      .recoveryQuestions(userId)
      .then((q) => {
        if (live && q) {
          setQ1(q.q1)
          setQ2(q.q2)
        }
      })
    return () => {
      live = false
    }
  }, [open, userId])
  const close = (saved: boolean) => {
    setQ1('')
    setQ2('')
    setA1('')
    setA2('')
    setPin('')
    setErrors({})
    setWarn(false)
    onClose(saved)
  }

  const save = async () => {
    if (busy) return
    const errs: Record<string, string> = {}
    if (!knownPin && !/^\d{4,8}$/.test(pin)) errs.pin = 'رمز فعلی را وارد کنید.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      await getUsers().setRecovery(userId, knownPin ?? pin, { q1, a1, q2, a2 })
      close(true)
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fieldErrors)
      else setErrors({ form: toUserMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title={warn ? 'بدون سؤال بازیابی ادامه می‌دهید؟' : `سؤال‌های بازیابی ${userName}`} onClose={() => (warn ? setWarn(false) : afterPin ? setWarn(true) : close(false))}>
      {warn ? (
        <div className={styles.body} data-testid="recovery-skip-warning">
          <div className={styles.warning}>
            <Icon name="alert" size={18} />
            <p>بدون این دو سؤال، اگر رمز فراموش شود قابل بازیابی نیست و فقط «مالک» می‌تواند رمز را عوض کند. اگر رمز مالک فراموش شود، تنها راه بازگرداندن پشتیبان است.</p>
          </div>
          <Button block onClick={() => setWarn(false)} data-testid="recovery-back">
            تنظیم سؤال‌ها
          </Button>
          <Button block variant="secondary" onClick={() => close(false)} data-testid="recovery-skip-confirm">
            فعلاً نه، بعداً از «بیشتر» تنظیم می‌کنم
          </Button>
        </div>
      ) : (
        <form className={styles.body} noValidate onSubmit={(e) => (e.preventDefault(), void save())} data-testid="recovery-form">
          <div className={styles.info}>
            <Icon name="shield" size={18} />
            <p>
              اگر روزی رمز را فراموش کنید، با جواب دادن به این دو سؤال رمز تازه می‌گذارید. سؤال و جواب را خودتان بنویسید؛ جوابی انتخاب کنید که فقط شما بدانید و یادتان بماند. جواب‌ها رمزنگاری می‌شوند و
              هیچ‌جا نمایش داده نمی‌شوند (فاصله، ی/ي و ارقام فارسی/انگلیسی فرقی نمی‌کند).
            </p>
          </div>
          {!knownPin && (
            <Field label="رمز فعلی" required htmlFor="rec-pin" error={errors.pin}>
              <TextInput id="rec-pin" type="password" inputMode="numeric" dir="ltr" autoComplete="off" value={pin} onChange={(e) => setPin(toEnglishDigits(e.target.value).replace(/\D/g, '').slice(0, 8))} invalid={!!errors.pin} />
            </Field>
          )}
          <Field label="سؤال اول" required htmlFor="rec-q1" error={errors.q1}>
            <TextInput id="rec-q1" value={q1} onChange={(e) => setQ1(e.target.value)} maxLength={120} placeholder={EXAMPLES[0]} autoComplete="off" invalid={!!errors.q1} />
          </Field>
          <Field label="جواب سؤال اول" required htmlFor="rec-a1" error={errors.a1}>
            <TextInput id="rec-a1" value={a1} onChange={(e) => setA1(e.target.value)} maxLength={120} autoComplete="off" invalid={!!errors.a1} />
          </Field>
          <Field label="سؤال دوم" required htmlFor="rec-q2" error={errors.q2}>
            <TextInput id="rec-q2" value={q2} onChange={(e) => setQ2(e.target.value)} maxLength={120} placeholder={EXAMPLES[1]} autoComplete="off" invalid={!!errors.q2} />
          </Field>
          <Field label="جواب سؤال دوم" required htmlFor="rec-a2" error={errors.a2}>
            <TextInput id="rec-a2" value={a2} onChange={(e) => setA2(e.target.value)} maxLength={120} autoComplete="off" invalid={!!errors.a2} />
          </Field>
          {errors.form && (
            <p className={styles.error} role="alert">
              {errors.form}
            </p>
          )}
          <Button type="submit" block loading={busy} data-testid="recovery-save">
            ذخیره سؤال‌ها
          </Button>
          {afterPin && (
            <Button block variant="ghost" onClick={() => setWarn(true)} data-testid="recovery-skip">
              فعلاً نه
            </Button>
          )}
        </form>
      )}
    </Sheet>
  )
}
