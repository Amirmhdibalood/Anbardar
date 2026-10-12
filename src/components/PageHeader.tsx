import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BACK_BUTTON_SIDE } from '../config/ui'
import { Icon } from './Icon'
import styles from './PageHeader.module.css'

interface Props {
  title: string
  /** مسیر دکمه بازگشت؛ اگر نباشد دکمه نمایش داده نمی‌شود */
  backTo?: string
  /** به‌جای لینک، تابع بازگشت (مثلاً بازگشت به تاریخچه با حفظ فیلتر یا تأیید خروج از فرم) */
  onBack?: () => void
  actions?: ReactNode
}

/**
 * سربرگ صفحه: عنوان سمت راست؛ دکمه بازگشت در سمت BACK_BUTTON_SIDE.
 * دکمه بازگشت `data-back-button` دارد تا دکمه بازگشت سخت‌افزاری اندروید همان رفتار را اجرا کند.
 */
export function PageHeader({ title, backTo, onBack, actions }: Props) {
  const left = BACK_BUTTON_SIDE === 'left'
  const icon = <Icon name={left ? 'chevronLeft' : 'arrowRight'} size={left ? 20 : 18} />
  const back = onBack ? (
    <button type="button" onClick={onBack} className={styles.back} aria-label="بازگشت" data-back-button>
      {icon}
    </button>
  ) : backTo ? (
    <Link to={backTo} className={styles.back} aria-label="بازگشت" data-back-button>
      {icon}
    </Link>
  ) : null

  return (
    <header className={styles.root}>
      {!left && back}
      <h1 className={styles.title}>{title}</h1>
      {actions && <div className={styles.actions}>{actions}</div>}
      {left && back}
    </header>
  )
}
