import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BACK_BUTTON_SIDE } from '../config/ui'
import { Icon } from './Icon'
import styles from './PageHeader.module.css'
import { ThemeLamp } from './ThemeLamp'

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
  const ref = useRef<HTMLElement>(null)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    let el = ref.current?.parentElement ?? null
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement
    const target: HTMLElement | Window = el ?? window
    const read = () => setScrolled((el ? el.scrollTop : window.scrollY) > 4)
    read()
    target.addEventListener('scroll', read, { passive: true })
    return () => target.removeEventListener('scroll', read)
  }, [])
  const icon = <Icon name={left ? 'chevronLeft' : 'arrowRight'} size={left ? 20 : 18} />
  const back = onBack ? (
    <button type="button" onClick={onBack} className={styles.back} aria-label="بازگشت" data-back-button>
      {icon}
    </button>
  ) : backTo ? (
    <Link to={backTo} className={styles.back} aria-label="بازگشت" data-back-button>
      {icon}
    </Link>
  ) : (
    /* صفحه‌های اصلی (بدون بازگشت): چراغ تم در همان جای دکمه بازگشت */
    <ThemeLamp />
  )

  return (
    <header ref={ref} className={styles.root} data-scrolled={scrolled}>
      {!left && back}
      <h1 className={styles.title}>{title}</h1>
      {actions && <div className={styles.actions}>{actions}</div>}
      {left && back}
    </header>
  )
}
