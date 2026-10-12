import { Icon, type IconName } from './Icon'
import styles from './SegmentedControl.module.css'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: IconName
}

interface Props<T extends string> {
  label: string
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
}

export function SegmentedControl<T extends string>({ label, options, value, onChange }: Props<T>) {
  return (
    <div className={styles.root} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`${styles.item} ${selected ? styles.selected : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.icon && <Icon name={option.icon} size={18} />}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
