import { Link } from 'react-router-dom'
import { Card } from '../components/Card'
import { Icon, type IconName } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { toPersianDigits } from '../utils/persian'
import { useSession } from '../hooks/useSession'
import { can, ROLE_LABELS, type Permission } from '../models/permissions'
import { getUsers } from '../services/appContext'
import styles from './MorePage.module.css'

const ITEMS: { to: string; label: string; icon: IconName; perm?: Permission }[] = [
  { to: '/sales', label: 'فاکتورهای فروش', icon: 'cart' },
  { to: '/purchases', label: 'فاکتورهای خرید', icon: 'truck' },
  { to: '/more/price-calculator', label: 'ماشین‌حساب قیمت', icon: 'chart' },
  { to: '/more/expenses', label: 'هزینه‌ها', icon: 'wallet', perm: 'expenses.manage' },
  { to: '/transfers', label: 'انتقال بین انبارها', icon: 'grid' },
  { to: '/more/parties', label: 'طرف حساب‌ها (مشتری و تأمین‌کننده)', icon: 'users' },
  { to: '/money', label: 'دریافت و پرداخت', icon: 'wallet' },
  { to: '/cheques', label: 'چک‌ها و سررسیدها', icon: 'file' },
  { to: '/balances', label: 'بدهکاران و بستانکاران', icon: 'briefcase' },
  { to: '/more/warehouses', label: 'انبارها', icon: 'grid' },
  { to: '/more/settings', label: 'تنظیمات', icon: 'settings' },
  { to: '/more/backup', label: 'پشتیبان‌گیری', icon: 'shield' },
  { to: '/more/users', label: 'کاربران و دسترسی‌ها', icon: 'users', perm: 'users.manage' },
  { to: '/more/audit', label: 'گزارش فعالیت‌ها', icon: 'file', perm: 'audit.view' },
  { to: '/more/help', label: 'راهنما', icon: 'help' },
]

export default function MorePage() {
  const { actor, usersOn } = useSession()
  const allowed = (p?: Permission) => !p || !usersOn || can(actor?.role, p)
  return (
    <>
      <PageHeader title="بیشتر" />
      {usersOn && actor && (
        <div className={styles.userBar} data-testid="current-user">
          <span>
            <strong>{actor.name}</strong> · {ROLE_LABELS[actor.role]}
          </span>
          <button type="button" onClick={() => void getUsers().logout()} data-testid="lock-now">
            قفل / تعویض کاربر
          </button>
        </div>
      )}
      <Card>
        <ul className={styles.list}>
          {ITEMS.filter((i) => allowed(i.perm)).map((item) => (
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
