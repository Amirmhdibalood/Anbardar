import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from './Icon'
import styles from './Button.module.css'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  icon?: IconName
  block?: boolean
  small?: boolean
  loading?: boolean
  children: ReactNode
}

export function Button({ variant = 'primary', icon, block, small, loading, disabled, children, type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[variant]} ${block ? styles.block : ''} ${small ? styles.small : ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon && <Icon name={icon} size={18} />}
      {loading ? 'لطفاً صبر کنید…' : children}
    </button>
  )
}

/** دکمه آیکنی کوچک (مثلاً در هدر صفحه) */
export function IconButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.iconButton} aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} size={19} />
    </button>
  )
}

/** لینک آیکنی هم‌شکل IconButton */
export function IconLink({ icon, label, to }: { icon: IconName; label: string; to: string }) {
  return (
    <Link to={to} className={styles.iconButton} aria-label={label} title={label}>
      <Icon name={icon} size={19} />
    </Link>
  )
}

/** لینک با ظاهر دکمه */
export function ButtonLink({ to, variant = 'primary', icon, block, children }: { to: string; variant?: 'primary' | 'secondary'; icon?: IconName; block?: boolean; children: ReactNode }) {
  return (
    <Link to={to} className={`${styles.button} ${styles[variant]} ${block ? styles.block : ''}`}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </Link>
  )
}
