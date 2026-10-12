import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { formatMoneyTyping, formatQuantityTyping } from '../services/productForm'
import { Icon } from './Icon'
import styles from './Field.module.css'

interface FieldProps {
  label: string
  /** نشان «اجباری» کنار برچسب */
  required?: boolean
  hint?: string
  error?: string
  /** شناسه کنترل داخل فرزند (باید همان id باشد که به کنترل داده‌اید) */
  htmlFor: string
  children: ReactNode
}

/** برچسب + کنترل + راهنما/خطای زیر آن */
export function Field({ label, required, hint, error, htmlFor, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor} className={styles.label}>
        {label}
        {required && <span className={styles.required} aria-hidden="true"> *</span>}
      </label>
      {children}
      {error ? (
        <p className={styles.error} id={`${htmlFor}-error`} role="alert">
          <Icon name="alert" size={14} />
          {error}
        </p>
      ) : (
        hint && <p className={styles.hint}>{hint}</p>
      )}
    </div>
  )
}

const cls = (invalid?: boolean) => `${styles.control} ${invalid ? styles.invalid : ''}`

interface InvalidProps {
  invalid?: boolean
}

export function TextInput({ invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & InvalidProps) {
  return <input className={cls(invalid)} aria-invalid={invalid || undefined} {...rest} />
}

export function TextArea({ invalid, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & InvalidProps) {
  return <textarea className={`${cls(invalid)} ${styles.textarea}`} aria-invalid={invalid || undefined} {...rest} />
}

export function SelectInput({ invalid, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & InvalidProps) {
  return (
    <div className={styles.selectWrap}>
      <select className={`${cls(invalid)} ${styles.select}`} aria-invalid={invalid || undefined} {...rest}>
        {children}
      </select>
      <Icon name="chevronLeft" size={16} className={styles.selectArrow} />
    </div>
  )
}

interface TypedProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'>, InvalidProps {
  value: string
  onChange: (value: string) => void
  /** متن ثابت انتهای فیلد، مثل «تومان» یا نام واحد */
  suffix?: string
}

/** فیلد مبلغ: فقط رقم، جداکننده هزارگان و ارقام فارسی هنگام تایپ */
export function MoneyInput({ value, onChange, suffix, invalid, ...rest }: TypedProps) {
  return (
    <div className={styles.suffixWrap}>
      <input
        className={`${cls(invalid)} ${styles.numeric}`}
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(formatMoneyTyping(e.target.value))}
        aria-invalid={invalid || undefined}
        {...rest}
      />
      {suffix && <span className={styles.suffix}>{suffix}</span>}
    </div>
  )
}

/** فیلد تعداد: ارقام فارسی و «٫» برای اعشار */
export function QuantityInput({ value, onChange, suffix, invalid, ...rest }: TypedProps) {
  return (
    <div className={styles.suffixWrap}>
      <input
        className={`${cls(invalid)} ${styles.numeric}`}
        inputMode="decimal"
        autoComplete="off"
        dir="ltr"
        value={value}
        onChange={(e) => onChange(formatQuantityTyping(e.target.value))}
        aria-invalid={invalid || undefined}
        {...rest}
      />
      {suffix && <span className={styles.suffix}>{suffix}</span>}
    </div>
  )
}

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
}

export function Switch({ checked, onChange, label, description }: SwitchProps) {
  const id = useId()
  return (
    <div className={styles.switchRow}>
      <div className={styles.switchText}>
        <span id={id} className={styles.switchLabel}>{label}</span>
        {description && <span className={styles.hint}>{description}</span>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={id} className={`${styles.switch} ${checked ? styles.switchOn : ''}`} onClick={() => onChange(!checked)}>
        <span className={styles.knob} />
      </button>
    </div>
  )
}
