import { formatMoney } from '../utils/money'
import { formatInteger } from '../utils/persian'
import styles from './PieChart.module.css'

export interface ChartSlice {
  key: string
  label: string
  amount: number
  tone: 'success' | 'warning' | 'error' | 'accent' | 'muted'
}

const TONE_VAR: Record<ChartSlice['tone'], string> = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--error)',
  accent: 'var(--accent)',
  muted: 'var(--muted)',
}

interface Props {
  slices: ChartSlice[]
  label?: string
}

/** نمودار دایره‌ای ساده با SVG (بدون کتابخانه خارجی) */
export function PieChart({ slices, label = 'نمودار درآمد و هزینه' }: Props) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.amount), 0)
  const size = 180
  const r = 70
  const cx = size / 2
  const cy = size / 2

  if (total <= 0) {
    return (
      <div className={styles.empty} role="img" aria-label={label}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={22} />
        </svg>
        <p>در این بازه هنوز درآمد یا هزینه‌ای ثبت نشده.</p>
      </div>
    )
  }

  let angle = -Math.PI / 2
  const arcs: { d: string; color: string; key: string }[] = []
  for (const slice of slices) {
    const value = Math.max(0, slice.amount)
    if (value === 0) continue
    const sweep = (value / total) * Math.PI * 2
    const end = angle + sweep
    const large = sweep > Math.PI ? 1 : 0
    const x1 = cx + r * Math.cos(angle)
    const y1 = cy + r * Math.sin(angle)
    const x2 = cx + r * Math.cos(end)
    const y2 = cy + r * Math.sin(end)
    const color = TONE_VAR[slice.tone]
    if (value === total) {
      arcs.push({
        key: slice.key,
        color,
        d: `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy - r}`,
      })
    } else {
      arcs.push({
        key: slice.key,
        color,
        d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`,
      })
    }
    angle = end
  }

  return (
    <div className={styles.wrap} data-testid="pie-chart">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        {arcs.map((a) => (
          <path key={a.key} d={a.d} fill={a.color} />
        ))}
        <circle cx={cx} cy={cy} r={42} fill="var(--card)" />
      </svg>
      <ul className={styles.legend}>
        {slices.map((s) => {
          const pct = total > 0 ? Math.round((Math.max(0, s.amount) / total) * 100) : 0
          return (
            <li key={s.key}>
              <span className={styles.dot} style={{ background: TONE_VAR[s.tone] }} />
              <span className={styles.legLabel}>{s.label}</span>
              <span className={styles.legAmount}>
                {formatMoney(s.amount, { withUnit: false })}
                <em>{formatInteger(pct)}٪</em>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
