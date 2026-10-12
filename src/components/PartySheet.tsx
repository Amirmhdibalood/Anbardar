import { useState, type ReactNode } from 'react'
import type { Customer, PartyInput, Supplier } from '../models/party'
import { ValidationError, toUserMessage } from '../utils/errors'
import { Button } from './Button'
import { Field, TextArea, TextInput } from './Field'
import { Sheet } from './Sheet'
import styles from './PartySheet.module.css'

type Party = Customer | Supplier

interface Props {
  /** «مشتری» یا «تأمین‌کننده» */
  label: 'مشتری' | 'تأمین‌کننده'
  party: Party | null
  onClose: () => void
  onSave: (input: PartyInput) => Promise<Party>
  onSaved: (party: Party) => void
  /** دکمه‌های مدیریت (غیرفعال/حذف) زیر فرم */
  extra?: ReactNode
}

/** برگه ایجاد/ویرایش طرف حساب (مشتری یا تأمین‌کننده)؛ هم در صفحه فهرست و هم داخل فرم فاکتور استفاده می‌شود */
export function PartySheet({ label, party, onClose, onSave, onSaved, extra }: Props) {
  const [name, setName] = useState(party?.name ?? '')
  const [phone, setPhone] = useState(party?.phone ?? '')
  const [address, setAddress] = useState(party?.address ?? '')
  const [description, setDescription] = useState(party?.description ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    setErrors({})
    try {
      onSaved(await onSave({ name, phone, address, description }))
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
        <Field label="شماره تماس" htmlFor="party-phone" error={errors['phone']}>
          <TextInput id="party-phone" value={phone} onChange={(e) => setPhone(e.target.value)} invalid={!!errors['phone']} inputMode="tel" dir="ltr" autoComplete="off" maxLength={20} />
        </Field>
        <Field label="آدرس" htmlFor="party-address" error={errors['address']}>
          <TextInput id="party-address" value={address} onChange={(e) => setAddress(e.target.value)} invalid={!!errors['address']} autoComplete="off" />
        </Field>
        <Field label="توضیحات" htmlFor="party-description" error={errors['description']}>
          <TextArea id="party-description" value={description} onChange={(e) => setDescription(e.target.value)} invalid={!!errors['description']} />
        </Field>
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
