import { useEffect, useRef, type ReactNode } from 'react'
import styles from './Sheet.module.css'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

/** برگه پایین‌صفحه (Bottom Sheet) با بستن با کلید Esc و لمس پس‌زمینه */
export function Sheet({ open, title, onClose, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  // onClose در ref نگه داشته می‌شود تا با هر رندر والد، فوکوس به اولین دکمه برنگردد (وسط تایپ)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // برگه‌های تودرتو (مثل انتخاب‌گر داخل فرم): فقط بالاترین برگه بسته شود
      const dialogs = document.querySelectorAll('[role="dialog"]')
      if (dialogs[dialogs.length - 1] !== panelRef.current) return
      e.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    panelRef.current?.querySelector<HTMLElement>('a,button')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.handle} aria-hidden="true" />
        <h2 className={styles.title}>{title}</h2>
        {children}
      </div>
    </div>
  )
}
