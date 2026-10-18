import { useId, useLayoutEffect, useRef, type ComponentPropsWithRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { formatMoneyTyping, formatPercentTyping, formatQuantityTyping } from '../services/productForm'
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

export function TextInput({ invalid, ...rest }: ComponentPropsWithRef<'input'> & InvalidProps) {
  return <input className={cls(invalid)} aria-invalid={invalid || undefined} {...rest} />
}

export function TextArea({ invalid, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & InvalidProps) {
  return <textarea className={`${cls(invalid)} ${styles.textarea}`} aria-invalid={invalid || undefined} {...rest} />
}

interface TypedProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'>, InvalidProps {
  value: string
  onChange: (value: string) => void
  /** متن ثابت انتهای فیلد، مثل «تومان» یا نام واحد */
  suffix?: string
}

export type NumberMode = 'money' | 'quantity' | 'percent'

const FORMATTERS: Record<NumberMode, (text: string) => string> = {
  money: formatMoneyTyping,
  quantity: formatQuantityTyping,
  percent: formatPercentTyping,
}
/** نویسه‌های «معنادار» (رقم و جداکننده اعشار) برای نگه داشتن جای مکان‌نما بعد از قالب‌بندی */
const SIGNIFICANT = /[0-9۰-۹٠-٩٫./]/

interface NumberProps extends TypedProps {
  mode: NumberMode
}

/**
 * فیلد عددی مشترک همه برنامه: ارقام فارسی، جداکننده هزارگان زنده هنگام تایپ، مکان‌نمای درست
 * (حتی وقت ویرایش وسط عدد) و اعشار برای تعداد/درصد. پسوند (تومان/واحد) جای عدد را نمی‌گیرد.
 */
export function NumberInput({ mode, value, onChange, suffix, invalid, className, ...rest }: NumberProps) {
  const ref = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)
  const format = FORMATTERS[mode]
  const shown = format(value)
  useLayoutEffect(() => {
    const el = ref.current
    if (caret.current === null || !el || document.activeElement !== el) return
    // مکان‌نما بعد از همان تعداد رقم معنادار قبلی
    let count = caret.current
    let pos = 0
    while (pos < shown.length && count > 0) {
      if (SIGNIFICANT.test(shown[pos]!)) count--
      pos++
    }
    caret.current = null
    el.setSelectionRange(pos, pos)
  })
  return (
    <div className={styles.suffixWrap}>
      <input
        ref={ref}
        className={`${cls(invalid)} ${styles.numeric} ${suffix ? styles.withSuffix : ''} ${className ?? ''}`}
        inputMode={mode === 'money' ? 'numeric' : 'decimal'}
        autoComplete="off"
        dir="ltr"
        value={shown}
        onChange={(e) => {
          const raw = e.target.value
          const at = e.target.selectionStart ?? raw.length
          caret.current = [...raw.slice(0, at)].filter((c) => SIGNIFICANT.test(c)).length
          onChange(format(raw))
        }}
        aria-invalid={invalid || undefined}
        data-number={mode}
        {...rest}
      />
      {suffix && <span className={styles.suffix}>{suffix}</span>}
    </div>
  )
}

/** فیلد مبلغ (تومان، عدد صحیح) */
export function MoneyInput(props: TypedProps) {
  return <NumberInput mode="money" {...props} />
}

/** فیلد تعداد: ارقام فارسی، هزارگان و «٫» برای اعشار */
export function QuantityInput(props: TypedProps) {
  return <NumberInput mode="quantity" {...props} />
}

/** فیلد درصد: ارقام فارسی و «٫» برای اعشار */
export function PercentInput(props: TypedProps) {
  return <NumberInput mode="percent" {...props} />
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
