import { NotificationBell } from './NotificationBell'
import styles from './NotificationBell.module.css'
import { ThemeLamp } from './ThemeLamp'

/** گوشه بالا-چپ صفحه‌های اصلی: زنگ اعلان کنار چراغ تم */
export function TopTools() {
  return (
    <div className={styles.tools}>
      <NotificationBell />
      <ThemeLamp />
    </div>
  )
}
