import styles from './Chip.module.css'

interface Props {
  label: string
  selected?: boolean
  muted?: boolean
  onClick: () => void
}

/** دکمه فیلتر گرد (برای گروه‌های کالا) */
export function Chip({ label, selected, muted, onClick }: Props) {
  return (
    <button type="button" className={`${styles.chip} ${selected ? styles.on : ''} ${muted ? styles.muted : ''}`} aria-pressed={selected} onClick={onClick}>
      {label}
    </button>
  )
}
