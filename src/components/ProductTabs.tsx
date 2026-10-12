import { NavLink } from 'react-router-dom'
import styles from './ProductTabs.module.css'

/** تب‌های بالای صفحه «کالاها» و «موجودی»؛ هر دو بخش از یک تب پایین دیده می‌شوند */
export function ProductTabs() {
  return (
    <nav className={styles.tabs} aria-label="بخش‌های کالا">
      <NavLink to="/products" end className={({ isActive }) => `${styles.tab} ${isActive ? styles.on : ''}`}>
        کالاها
      </NavLink>
      <NavLink to="/stock" className={({ isActive }) => `${styles.tab} ${isActive ? styles.on : ''}`}>
        موجودی
      </NavLink>
    </nav>
  )
}
