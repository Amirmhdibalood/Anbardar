import { useState, type ReactNode } from 'react'
import type { Party, PartyInput } from '../models/party'
import { ValidationError, toUserMessage } from '../utils/errors'
import { parseIntegerInput } from '../utils/persian'
import { Button } from './Button'
import { Field, MoneyInput, Switch, TextArea, TextInput } from './Field'
import { SegmentedControl } from './SegmentedControl'
import { Sheet } from './Sheet'
import styles from './PartySheet.module.css'

export interface OpeningDraft {
  amount: number
  side: 'debit' | 'credit'
}

interface Props {
  /** «مشتری»، «تأمین‌کننده» یا «طرف حساب» */
  label: string
  party: Party | null
  onClose: () => void
  onSave: (input: PartyInput, opening: OpeningDraft | null) => Promise<Party>
  onSaved: (party: Party) => void
  /** نمایش انتخاب نقش (مشتری / تأمین‌کننده)؛ فقط در صفحه طرف حساب‌ها */
  roles?: boolean
  /** پیش‌فرض نقش برای طرف جدید */
  defaultRoles?: { isCustomer: boolean; isSupplier: boolean }
  /** دکمه‌های مدیریت (غیرفعال/حذف) زیر فرم */
  extra?: ReactNode
}

/** برگه ایجاد/ویرایش طرف حساب؛ هم در صفحه فهرست و هم داخل فرم فاکتور استفاده می‌شود */
export function PartySheet({ label, party, onClose, onSave, onSaved, extra, roles, defaultRoles }: Props) {
  const [name, setName] = useState(party?.name ?? '')
  const [phone, setPhone] = useState(party?.phone ?? '')
  const [address, setAddress] = useState(party?.address ?? '')
  const [description, setDescription] = useState(party?.description ?? '')
  const [isCustomer, setIsCustomer] = useState(party?.isCustomer ?? defaultRoles?.isCustomer ?? true)
  const [isSupplier, setIsSupplier] = useState(party?.isSupplier ?? defaultRoles?.isSupplier ?? false)
  const [openingText, setOpeningText] = useState('')
  const [openingSide, setOpeningSide] = useState<'debit' | 'credit'>('debit')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const locked = !!party?.isSystem

  const save = async () => {
    if (saving) return
    const opening = openingText.trim() ? parseIntegerInput(openingText) : 0
    if (opening === null || /[.٫]/.test(openingText)) {
      setErrors({ opening: 'مانده اول دوره باید عدد صحیح (تومان) باشد.' })
      return
    }
    setSaving(true)
    setErrors({})
    try {
      onSaved(await onSave({ name, phone, address, description, isCustomer, isSupplier }, opening > 0 ? { amount: opening, side: openingSide } : null))
    } catch (e) {
      setErrors(e instanceof ValidationError ? { ...e.fieldErrors } : { form: toUserMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open title={party ? `ویرایش ${label}` : `${label} جدید`} onClose={onClose}>
      <form
        className={styles.body}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Field label={`نام ${label}`} required htmlFor="party-name" error={errors['name']}>
          <TextInput id="party-name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors['name']} autoComplete="off" maxLength={120} />
        </Field>
        {roles && !locked && (
          <div className={styles.roles} data-testid="party-roles">
            <Switch checked={isCustomer} onChange={setIsCustomer} label="مشتری است" description="به او می‌فروشید" />
            <Switch checked={isSupplier} onChange={setIsSupplier} label="تأمین‌کننده است" description="از او خرید می‌کنید" />
            {errors['role'] && (
              <p className={styles.error} role="alert">
                {errors['role']}
              </p>
            )}
          </div>
        )}
        <Field label="شماره تماس" htmlFor="party-phone" error={errors['phone']}>
          <TextInput id="party-phone" value={phone} onChange={(e) => setPhone(e.target.value)} invalid={!!errors['phone']} inputMode="tel" dir="ltr" autoComplete="off" maxLength={20} />
        </Field>
        <Field label="آدرس" htmlFor="party-address" error={errors['address']}>
          <TextInput id="party-address" value={address} onChange={(e) => setAddress(e.target.value)} invalid={!!errors['address']} autoComplete="off" />
        </Field>
        <Field label="توضیحات" htmlFor="party-description" error={errors['description']}>
          <TextArea id="party-description" value={description} onChange={(e) => setDescription(e.target.value)} invalid={!!errors['description']} />
        </Field>
        {roles && !party && (
          <div className={styles.roles}>
            <Field label="مانده اول دوره (اختیاری)" htmlFor="party-opening" error={errors['opening'] ?? errors['amount']} hint="اگر از قبل حساب باز دارید. بعداً هم از صفحه حساب او قابل ثبت است.">
              <MoneyInput id="party-opening" value={openingText} onChange={setOpeningText} invalid={!!errors['opening']} placeholder="۰" suffix="تومان" />
            </Field>
            {openingText.trim() !== '' && (
              <SegmentedControl
                label="نوع مانده"
                options={[
                  { value: 'debit', label: 'او به من بدهکار است' },
                  { value: 'credit', label: 'من به او بدهکارم' },
                ]}
                value={openingSide}
                onChange={setOpeningSide}
              />
            )}
          </div>
        )}
        {errors['form'] && (
          <p className={styles.error} role="alert">
            {errors['form']}
          </p>
        )}
        <Button type="submit" block loading={saving}>
          {party ? 'ذخیره' : `افزودن ${label}`}
        </Button>
        {extra}
      </form>
    </Sheet>
  )
}
