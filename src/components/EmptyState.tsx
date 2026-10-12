import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import styles from './EmptyState.module.css'

interface Props {
  icon: IconName
  title: string
  description: string
  /** نشان کوچک مثل «به‌زودی» */
  badge?: string
  action?: ReactNode
  compact?: boolean
}

export function EmptyState({ icon, title, description, badge, action, compact }: Props) {
  return (
    <div className={`${styles.root} ${compact ? styles.compact : ''}`}>
      <div className={styles.icon}>
        <Icon name={icon} size={compact ? 24 : 30} />
      </div>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.description}>{description}</p>
      {badge && <span className={styles.badge}>{badge}</span>}
      {action}
    </div>
  )
}
