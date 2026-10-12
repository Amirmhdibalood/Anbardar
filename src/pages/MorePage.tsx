import { Link } from 'react-router-dom'
import { Card } from '../components/Card'
import { Icon, type IconName } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { toPersianDigits } from '../utils/persian'
import styles from './MorePage.module.css'

const ITEMS: { to: string; label: string; icon: IconName }[] = [
  { to: '/sales', label: 'فاکتورهای فروش', icon: 'cart' },
  { to: '/purchases', label: 'فاکتورهای خرید', icon: 'truck' },
  { to: '/more/price-calculator', label: 'ماشین‌حساب قیمت', icon: 'chart' },
  { to: '/more/expenses', label: 'هزینه‌ها', icon: 'wallet' },
  { to: '/transfers', label: 'انتقال بین انبارها', icon: 'grid' },
  { to: '/more/customers', label: 'مشتریان', icon: 'users' },
  { to: '/more/suppliers', label: 'تأمین‌کنندگان', icon: 'briefcase' },
  { to: '/more/warehouses', label: 'انبارها', icon: 'grid' },
  { to: '/more/settings', label: 'تنظیمات', icon: 'settings' },
  { to: '/more/backup', label: 'پشتیبان‌گیری', icon: 'shield' },
  { to: '/more/help', label: 'راهنما', icon: 'help' },
]

export default function MorePage() {
  return (
    <>
      <PageHeader title="بیشتر" />
      <Card>
        <ul className={styles.list}>
          {ITEMS.map((item) => (
            <li key={item.to}>
              <Link to={item.to} className={styles.row}>
                <span className={styles.icon}>
                  <Icon name={item.icon} size={20} />
                </span>
                <span className={styles.label}>{item.label}</span>
                <Icon name="chevronLeft" size={18} className={styles.chevron} />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <p className={styles.version}>انباردار | نسخه {toPersianDigits(__APP_VERSION__)}</p>
    </>
  )
}
