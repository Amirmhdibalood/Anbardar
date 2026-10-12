import { useCallback, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { BottomNav } from '../components/BottomNav'
import { RegisterSheet } from '../components/RegisterSheet'
import styles from './layouts.module.css'

/** چیدمان اصلی: محتوای قابل اسکرول + نوار ناوبری پایین با دکمه مرکزی «ثبت» */
export function AppLayout() {
  const [sheetOpen, setSheetOpen] = useState(false)
  const close = useCallback(() => setSheetOpen(false), [])

  return (
    <div className={styles.app}>
      <main className={styles.content}>
        <Outlet />
      </main>
      <BottomNav onRegister={() => setSheetOpen(true)} />
      <RegisterSheet open={sheetOpen} onClose={close} />
    </div>
  )
}
