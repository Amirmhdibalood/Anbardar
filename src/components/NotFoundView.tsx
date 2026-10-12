import { Link } from 'react-router-dom'
import { EmptyState } from './EmptyState'
import styles from './NotFoundView.module.css'

export function NotFoundView() {
  return (
    <div className={styles.root}>
      <EmptyState
        icon="help"
        title="صفحه پیدا نشد"
        description="این صفحه وجود ندارد یا جابه‌جا شده است."
        action={
          <Link to="/" className={styles.button}>
            بازگشت به خانه
          </Link>
        }
      />
    </div>
  )
}
