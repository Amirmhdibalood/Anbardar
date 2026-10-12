import { NavLink, useLocation } from 'react-router-dom'
import { Icon, type IconName } from './Icon'
import styles from './BottomNav.module.css'

interface Props {
  onRegister: () => void
}

interface Item {
  to: string
  label: string
  icon: IconName
  end?: boolean
  /** مسیرهای دیگری که این تب را فعال نشان می‌دهند */
  also?: string[]
}

const RIGHT_ITEMS: Item[] = [
  { to: '/', label: 'خانه', icon: 'home', end: true },
  { to: '/products', label: 'کالاها', icon: 'box', also: ['/stock'] },
]
const LEFT_ITEMS: Item[] = [
  { to: '/reports', label: 'گزارش‌ها', icon: 'chart' },
  { to: '/more', label: 'بیشتر', icon: 'more' },
]

function NavItem({ item }: { item: Item }) {
  const { pathname } = useLocation()
  const extra = item.also?.some((p) => pathname === p || pathname.startsWith(p + '/')) ?? false
  return (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => `${styles.item} ${isActive || extra ? styles.active : ''}`}>
      <Icon name={item.icon} />
      <span>{item.label}</span>
    </NavLink>
  )
}

export function BottomNav({ onRegister }: Props) {
  return (
    <nav className={styles.root} aria-label="ناوبری اصلی">
      {RIGHT_ITEMS.map((item) => (
        <NavItem key={item.to} item={item} />
      ))}
      <div className={styles.center}>
        <button type="button" className={styles.fab} onClick={onRegister} aria-label="ثبت جدید">
          <Icon name="plus" size={26} />
        </button>
        <span className={styles.fabLabel}>ثبت</span>
      </div>
      {LEFT_ITEMS.map((item) => (
        <NavItem key={item.to} item={item} />
      ))}
    </nav>
  )
}
