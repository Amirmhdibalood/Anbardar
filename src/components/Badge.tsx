import styles from './Badge.module.css'

export function Badge({ children, tone = 'neutral' }: { children: string; tone?: 'neutral' | 'warning' | 'error' | 'accent' | 'success' }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>
}
