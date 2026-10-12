import { Outlet } from 'react-router-dom'
import styles from './layouts.module.css'

/** چیدمان تمام‌صفحه بدون نوار پایین، برای فرم‌های ثبت سند */
export function FullScreenLayout() {
  return (
    <div className={styles.app}>
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  )
}
