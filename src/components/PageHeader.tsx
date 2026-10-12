import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import styles from './PageHeader.module.css'

interface Props {
  title: string
  /** مسیر دکمه بازگشت؛ اگر نباشد دکمه نمایش داده نمی‌شود */
  backTo?: string
  /** به‌جای لینک، تابع بازگشت (مثلاً بازگشت به تاریخچه با حفظ فیلتر) */
  onBack?: () => void
  actions?: ReactNode
}

export function PageHeader({ title, backTo, onBack, actions }: Props) {
  return (
    <header className={styles.root}>
      {onBack && (
        <button type="button" onClick={onBack} className={styles.back} aria-label="بازگشت">
          <Icon name="arrowRight" size={18} />
        </button>
      )}
      {!onBack && backTo && (
        <Link to={backTo} className={styles.back} aria-label="بازگشت">
          <Icon name="arrowRight" size={18} />
        </Link>
      )}
      <h1 className={styles.title}>{title}</h1>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  )
}
