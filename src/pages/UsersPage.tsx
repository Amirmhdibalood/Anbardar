import { useCallback, useState } from 'react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { EmptyState } from '../components/EmptyState'
import { Field, TextInput } from '../components/Field'
import { HelpTip } from '../components/HelpTip'
import { PageHeader } from '../components/PageHeader'
import { RecoverySetupSheet } from '../components/RecoverySetupSheet'
import { SegmentedControl } from '../components/SegmentedControl'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { useCan, useSession } from '../hooks/useSession'
import { ROLE_HINTS, ROLE_LABELS, ROLES, type Role } from '../models/permissions'
import { getUsers } from '../services/appContext'
import type { UserRow } from '../services/userService'
import { formatPersianDateTime } from '../utils/date'
import { toUserMessage, ValidationError } from '../utils/errors'
import { toEnglishDigits } from '../utils/persian'
import styles from './UsersPage.module.css'

const roleOptions = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))

type Recovery = { userId: string; name: string; pin: string }
type Editing = { mode: 'new' } | { mode: 'edit'; user: UserRow } | { mode: 'pin'; user: UserRow }

/** کاربران و دسترسی‌ها (فقط مالک) */
export default function UsersPage() {
  const goBack = useGoBack('/more')
  const toast = useToast()
  const { usersOn, actor } = useSession()
  const allowed = useCan('users.manage')
  const load = useCallback(() => (usersOn && allowed ? getUsers().list() : Promise.resolve([] as UserRow[])), [usersOn, allowed])
  const { data: users, reload, error } = useAsync(load)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [disableAsk, setDisableAsk] = useState(false)
  const [recovery, setRecovery] = useState<Recovery | null>(null)

  return (
    <>
      <PageHeader
        title="کاربران و دسترسی‌ها"
        onBack={goBack}
        actions={<HelpTip title="کاربران و نقش‌ها" text="با روشن کردن کاربران، هر کس با رمز خودش وارد می‌شود و فقط کارهای مجاز نقشش را می‌تواند انجام دهد. همه کارها با نام کاربر در «گزارش فعالیت‌ها» ثبت می‌شود. مالک: همه‌چیز. مدیر: کارهای روزانه، ابطال و گزارش. فروشنده: فروش و دریافت، بدون دیدن سود. انباردار: کالا، خرید و موجودی." />}
      />
      {!allowed && <EmptyState icon="shield" title="دسترسی ندارید" description="مدیریت کاربران فقط با حساب «مالک» ممکن است." />}
      {!usersOn && (
        <Card>
          <div className={styles.intro} data-testid="users-off">
            <strong>الان برنامه بدون ورود کار می‌کند</strong>
            <p>اگر چند نفر با این گوشی کار می‌کنند، کاربران را روشن کنید. اول خودتان را به‌عنوان «مالک» با یک رمز ۴ تا ۸ رقمی تعریف کنید؛ بعد بقیه را اضافه کنید.</p>
            <Button block icon="users" onClick={() => setEditing({ mode: 'new' })} data-testid="users-enable">
              روشن کردن کاربران
            </Button>
          </div>
        </Card>
      )}
      {usersOn && error && <p className={styles.error}>{error}</p>}
      {usersOn && allowed && users && (
        <>
          <ul className={styles.list} data-testid="users-list">
            {users.map((u) => (
              <li key={u.id} className={styles.row} data-active={u.isActive}>
                <div className={styles.who}>
                  <strong>
                    {u.name}
                    {u.id === actor?.userId && <span className={styles.me}> (شما)</span>}
                  </strong>
                  <span>{u.lastLoginAt ? `آخرین ورود: ${formatPersianDateTime(u.lastLoginAt)}` : 'هنوز وارد نشده'}</span>
                </div>
                <Badge tone={u.isActive ? (u.role === 'owner' ? 'success' : 'neutral') : 'error'}>{u.isActive ? ROLE_LABELS[u.role] : 'غیرفعال'}</Badge>
                <div className={styles.actions}>
                  {u.isActive && (
                    <>
                      <button type="button" onClick={() => setEditing({ mode: 'edit', user: u })}>نقش/نام</button>
                      <button type="button" onClick={() => setEditing({ mode: 'pin', user: u })}>تغییر رمز</button>
                    </>
                  )}
                  {u.id !== actor?.userId && (
                    <button
                      type="button"
                      onClick={() =>
                        void getUsers()
                          .setActive(u.id, !u.isActive)
                          .then(() => (toast.show(u.isActive ? 'کاربر غیرفعال شد.' : 'کاربر فعال شد.'), reload()))
                          .catch((e) => toast.show(toUserMessage(e)))
                      }
                    >
                      {u.isActive ? 'غیرفعال' : 'فعال'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Button block icon="plus" onClick={() => setEditing({ mode: 'new' })} data-testid="user-add">
            کاربر جدید
          </Button>
          <Button block variant="ghost" onClick={() => setDisableAsk(true)}>
            خاموش کردن کاربران (بدون ورود)
          </Button>
        </>
      )}
      <UserSheet editing={editing} first={!usersOn} onClose={() => setEditing(null)} onDone={(msg, rec) => (setEditing(null), toast.show(msg), reload(), rec && setRecovery(rec))} />
      {recovery && (
        <RecoverySetupSheet
          open
          afterPin
          userId={recovery.userId}
          userName={recovery.name}
          knownPin={recovery.pin}
          onClose={(saved) => (setRecovery(null), saved ? toast.show('سؤال‌های بازیابی ذخیره شد.') : toast.show('سؤال بازیابی تنظیم نشد؛ بعداً از «بیشتر» تنظیم کنید.'))}
        />
      )}
      <ConfirmSheet
        open={disableAsk}
        title="کاربران خاموش شوند؟"
        message="همه کاربران غیرفعال می‌شوند و برنامه دوباره بدون رمز باز می‌شود. گزارش فعالیت‌های قبلی می‌ماند."
        confirmLabel="خاموش کن"
        tone="danger"
        onCancel={() => setDisableAsk(false)}
        onConfirm={async () => {
          try {
            await getUsers().disableUsers()
            setDisableAsk(false)
            toast.show('کاربران خاموش شد.')
          } catch (e) {
            toast.show(toUserMessage(e))
          }
        }}
      />
    </>
  )
}

function UserSheet({ editing, first, onClose, onDone }: { editing: Editing | null; first: boolean; onClose: () => void; onDone: (msg: string, recovery?: Recovery) => void }) {
  const user = editing && editing.mode !== 'new' ? editing.user : null
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('seller')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState<Editing | null>(null)
  if (editing !== key) {
    setKey(editing)
    setName(user?.name ?? '')
    setRole(first ? 'owner' : (user?.role ?? 'seller'))
    setPin('')
    setPin2('')
    setErrors({})
  }
  const needPin = editing?.mode === 'new' || editing?.mode === 'pin'
  const save = async () => {
    if (busy || !editing) return
    const errs: Record<string, string> = {}
    if (needPin && !/^\d{4,8}$/.test(pin)) errs.pin = 'رمز باید ۴ تا ۸ رقم باشد.'
    else if (needPin && pin !== pin2) errs.pin2 = 'تکرار رمز یکی نیست.'
    if (editing.mode !== 'pin' && !name.trim()) errs.name = 'نام کاربر را وارد کنید.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      if (editing.mode === 'new') {
        const u = await getUsers().create({ name, role, pin })
        onDone(first ? 'کاربران روشن شد؛ شما «مالک» هستید.' : 'کاربر اضافه شد.', { userId: u.id, name: u.name, pin })
      } else if (editing.mode === 'edit') {
        await getUsers().update(editing.user.id, { name, role })
        onDone('کاربر ویرایش شد.')
      } else {
        await getUsers().resetPin(editing.user.id, pin)
        onDone('رمز تغییر کرد.', { userId: editing.user.id, name: editing.user.name, pin })
      }
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fieldErrors)
      else setErrors({ form: toUserMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  const digits = (v: string) => toEnglishDigits(v).replace(/\D/g, '').slice(0, 8)
  const title = editing?.mode === 'pin' ? `تغییر رمز ${user?.name}` : editing?.mode === 'edit' ? 'ویرایش کاربر' : first ? 'تعریف مالک' : 'کاربر جدید'
  return (
    <Sheet open={!!editing} title={title} onClose={onClose}>
      <form className={styles.form} noValidate onSubmit={(e) => (e.preventDefault(), void save())} data-testid="user-form">
        {editing?.mode !== 'pin' && (
          <Field label="نام" required htmlFor="user-name" error={errors.name}>
            <TextInput id="user-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" invalid={!!errors.name} />
          </Field>
        )}
        {editing?.mode !== 'pin' && !first && (
          <div>
            <SegmentedControl<Role> label="نقش" value={role} onChange={setRole} options={roleOptions} />
            <p className={styles.hint}>{ROLE_HINTS[role]}</p>
            {errors.role && <p className={styles.error}>{errors.role}</p>}
          </div>
        )}
        {first && <p className={styles.hint}>اولین کاربر «مالک» است و همه دسترسی‌ها را دارد.</p>}
        {needPin && (
          <>
            <Field label="رمز (۴ تا ۸ رقم)" required htmlFor="user-pin" error={errors.pin}>
              <TextInput id="user-pin" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} autoComplete="new-password" invalid={!!errors.pin} dir="ltr" />
            </Field>
            <Field label="تکرار رمز" required htmlFor="user-pin2" error={errors.pin2}>
              <TextInput id="user-pin2" type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(digits(e.target.value))} autoComplete="new-password" invalid={!!errors.pin2} dir="ltr" />
            </Field>
          </>
        )}
        {errors.form && <p className={styles.error}>{errors.form}</p>}
        <Button type="submit" block loading={busy} data-testid="user-save">
          ذخیره
        </Button>
      </form>
    </Sheet>
  )
}
