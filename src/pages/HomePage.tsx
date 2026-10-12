import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { Section } from '../components/Section'
import { useAsync } from '../hooks/useAsync'
import { useDashboard } from '../hooks/useDashboard'
import { useMoney } from '../hooks/useMoney'
import { getBackupInfo } from '../services/backupService'
import { MONEY_UNIT } from '../utils/money'
import { formatPersianDate } from '../utils/date'
import { formatInteger } from '../utils/persian'
import styles from './HomePage.module.css'

export default function HomePage() {
  const summary = useDashboard()
  const money = useMoney()
  const loadBackup = useCallback(() => getBackupInfo(), [])
  const { data: backup } = useAsync(loadBackup)

  return (
    <>
      <header className={styles.header}>
        <p className={styles.date}>{formatPersianDate()}</p>
        <h1 className={styles.hello}>سلام 👋</h1>
      </header>

      {backup?.reminderEnabled && backup.isStale && (
        <Link to="/more/backup" className={styles.backupBanner} role="status">
          <Icon name="shield" size={18} />
          <span>از اطلاعات فروشگاه نسخه پشتیبان بگیرید تا در صورت نیاز بتوانید بازیابی کنید.</span>
        </Link>
      )}

      <div className={styles.actions}>
        <Link to="/sales/new" className={`${styles.action} ${styles.primary}`}>
          <Icon name="cart" size={26} />
          ثبت فروش
        </Link>
        <Link to="/purchases/new" className={styles.action}>
          <Icon name="truck" size={26} />
          ثبت خرید
        </Link>
      </div>

      <div className={styles.stats}>
        <Card className={styles.stat}>
          <span className={styles.statLabel}>تعداد کالاها</span>
          <strong className={styles.statValue}>{formatInteger(summary.productCount)}</strong>
        </Card>
        <Card className={`${styles.stat} ${styles.statWide}`}>
          <span className={styles.statLabel}>فروش امروز</span>
          <strong className={styles.statValue}>{money(summary.todaySales, { withUnit: false })}</strong>
          <span className={styles.unit}>{MONEY_UNIT}</span>
        </Card>
        <Link to="/stock?f=low" className={styles.statLink} aria-label="کالاهای کم‌موجودی">
          <Card className={styles.stat}>
            <span className={styles.statLabel}>کم‌موجودی</span>
            <strong className={`${styles.statValue} ${summary.lowStockCount > 0 ? styles.warn : ''}`}>{formatInteger(summary.lowStockCount)}</strong>
          </Card>
        </Link>
      </div>

      <Link to="/balances" className={styles.balanceCard} aria-label="بدهکاران و بستانکاران" data-testid="home-balances">
        <Card className={styles.balanceInner}>
          <div className={styles.balanceCol}>
            <span className={styles.statLabel}>طلب از بدهکاران{summary.debtorCount > 0 ? ` (${formatInteger(summary.debtorCount)} نفر)` : ''}</span>
            <strong className={`${styles.statValue} ${styles.receivable}`}>{money(summary.receivable, { withUnit: false })}</strong>
          </div>
          <div className={styles.balanceCol}>
            <span className={styles.statLabel}>بدهی به بستانکاران{summary.creditorCount > 0 ? ` (${formatInteger(summary.creditorCount)} نفر)` : ''}</span>
            <strong className={`${styles.statValue} ${styles.payable}`}>{money(summary.payable, { withUnit: false })}</strong>
          </div>
          <Icon name="chevronLeft" size={18} />
        </Card>
      </Link>

      <Section title="فروش‌های اخیر">
        <Card>
          <EmptyState compact icon="file" title="هنوز فروشی ثبت نشده" description="با اولین فروش، فهرست آخرین فاکتورها اینجا نمایش داده می‌شود." />
        </Card>
      </Section>
    </>
  )
}
