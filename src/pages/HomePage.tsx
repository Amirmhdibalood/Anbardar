import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../components/Badge'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Icon } from '../components/Icon'
import { Section } from '../components/Section'
import { useAsync } from '../hooks/useAsync'
import { useDashboard } from '../hooks/useDashboard'
import { useMoney } from '../hooks/useMoney'
import { PAYMENT_STATUS_LABELS } from '../models/money'
import { getCheques, getSales } from '../services/appContext'
import { daysUntil } from '../models/cheque'
import { getBackupInfo } from '../services/backupService'
import { MONEY_UNIT, formatMoney } from '../utils/money'
import { formatPersianDate, formatPersianDateTime } from '../utils/date'
import { formatInteger, toPersianDigits } from '../utils/persian'
import { TopTools } from '../components/TopTools'
import styles from './HomePage.module.css'
import list from './money/Money.module.css'

export default function HomePage() {
  const summary = useDashboard()
  const money = useMoney()
  const loadBackup = useCallback(() => getBackupInfo(), [])
  const { data: backup } = useAsync(loadBackup)
  const loadRecent = useCallback(() => getSales().list({ limit: 5 }), [])
  const { data: recent } = useAsync(loadRecent)
  // چک‌های در جریان با سررسید تا ۷ روز آینده (و سررسیدگذشته‌ها)
  const loadDue = useCallback(() => getCheques().dueUntil(new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()), [])
  const { data: due } = useAsync(loadDue)
  const overdue = (due ?? []).filter((c) => daysUntil(c.dueDate) < 0).length

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <p className={styles.date}>{formatPersianDate()}</p>
          <h1 className={styles.hello}>سلام 👋</h1>
        </div>
        <TopTools />
      </header>

      {backup?.reminderEnabled && backup.isStale && (
        <Link to="/more/backup" className={styles.backupBanner} role="status">
          <Icon name="shield" size={18} />
          <span>از اطلاعات فروشگاه نسخه پشتیبان بگیرید تا در صورت نیاز بتوانید بازیابی کنید.</span>
        </Link>
      )}

      {due && due.length > 0 && (
        <Link to="/cheques" className={`${styles.backupBanner} ${styles.chequeBanner}`} role="status" data-testid="cheque-banner">
          <Icon name="file" size={18} />
          <span>
            {toPersianDigits(due.length)} چک تا یک هفته آینده سررسید دارد{overdue > 0 ? ` (${toPersianDigits(overdue)} مورد گذشته)` : ''} · جمع {formatMoney(due.reduce((a, c) => a + c.amount, 0), { withUnit: true })}
          </span>
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
          {recent && recent.length > 0 ? (
            <ul className={list.list} data-testid="recent-sales">
              {recent.map(({ invoice, customerName, payment }) => (
                <li key={invoice.id}>
                  <Link to={`/sales/${invoice.id}`} className={list.row}>
                    <span className={list.rowMain}>
                      <strong>
                        فاکتور {toPersianDigits(invoice.invoiceNumber)} | {customerName}
                      </strong>
                      <span className={list.meta}>{formatPersianDateTime(invoice.invoiceDate)}</span>
                    </span>
                    {invoice.status === 'cancelled' ? <Badge tone="error">ابطال‌شده</Badge> : payment && payment !== 'paid' ? <Badge tone="warning">{PAYMENT_STATUS_LABELS[payment]}</Badge> : null}
                    <span className={invoice.status === 'cancelled' ? list.struck : undefined}>{formatMoney(invoice.totalAmount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : recent ? (
            <EmptyState compact icon="file" title="هنوز فروشی ثبت نشده" description="با اولین فروش، فهرست آخرین فاکتورها اینجا نمایش داده می‌شود." />
          ) : null}
          {recent && recent.length > 0 && (
            <Link to="/sales" className={list.row} style={{ justifyContent: 'center', borderTop: '1px solid var(--border)' }}>
              همه فروش‌ها
            </Link>
          )}
        </Card>
      </Section>
    </>
  )
}
