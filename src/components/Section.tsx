import type { ReactNode } from 'react'
import styles from './Section.module.css'

interface Props {
  title: string
  action?: ReactNode
  children: ReactNode
}

export function Section({ title, action, children }: Props) {
  return (
    <section className={styles.root}>
      <div className={styles.head}>
        <h2 className={styles.title}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
