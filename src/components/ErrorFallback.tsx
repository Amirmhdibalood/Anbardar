import { Icon } from './Icon'
import styles from './ErrorFallback.module.css'

interface Props {
  onRetry?: () => void
}

/** صفحه خطای کلی: پیام انسانی و ساده، بدون هیچ جزئیات فنی */
export function ErrorFallback({ onRetry }: Props) {
  const goHome = () => {
    window.location.hash = '#/'
    window.location.reload()
  }
  return (
    <div className={styles.root} role="alert">
      <div className={styles.icon}>
        <Icon name="alert" size={32} />
      </div>
      <h1 className={styles.title}>مشکلی پیش آمد</h1>
      <p className={styles.text}>
        متأسفیم، برنامه نتوانست این بخش را نمایش دهد. اطلاعات شما سالم است و چیزی از بین نرفته است.
      </p>
      {onRetry && (
        <button type="button" className={styles.primary} onClick={onRetry}>
          تلاش دوباره
        </button>
      )}
      <button type="button" className={styles.secondary} onClick={goHome}>
        بازگشت به خانه
      </button>
    </div>
  )
}
