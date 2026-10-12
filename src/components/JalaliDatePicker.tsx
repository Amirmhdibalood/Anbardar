import { useState } from 'react'
import { JALALI_MONTHS, JALALI_WEEKDAYS_SHORT, formatJalaliDay, compareJalali, fromJalali, jalaliMonthLength, sameJalaliDay, toJalali, weekdayFromSaturday, type JalaliDate } from '../utils/jalali'
import { toPersianDigits } from '../utils/persian'
import { Button } from './Button'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import styles from './JalaliDatePicker.module.css'

interface Props {
  id: string
  value: JalaliDate
  onChange: (value: JalaliDate) => void
  /** عنوان برگه انتخاب */
  title?: string
}

/** فیلد تاریخ شمسی: دکمه‌ای با تاریخ فعلی که برگه تقویم ماهانه را باز می‌کند */
export function JalaliDatePicker({ id, value, onChange, title = 'انتخاب تاریخ' }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" id={id} className={styles.trigger} onClick={() => setOpen(true)}>
        <Icon name="file" size={17} />
        <span>{formatJalaliDay(value)}</span>
      </button>
      {open && (
        <CalendarSheet
          title={title}
          value={value}
          onClose={() => setOpen(false)}
          onPick={(d) => {
            onChange(d)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

function CalendarSheet({ title, value, onClose, onPick }: { title: string; value: JalaliDate; onClose: () => void; onPick: (d: JalaliDate) => void }) {
  const today = toJalali(new Date())
  const [view, setView] = useState({ jy: value.jy, jm: value.jm })
  const length = jalaliMonthLength(view.jy, view.jm)
  const offset = weekdayFromSaturday(fromJalali({ ...view, jd: 1 }))
  const cells: (number | null)[] = [...Array<null>(offset).fill(null), ...Array.from({ length }, (_, i) => i + 1)]
  const move = (delta: number) => {
    const index = view.jy * 12 + (view.jm - 1) + delta
    setView({ jy: Math.floor(index / 12), jm: (index % 12) + 1 })
  }
  return (
    <Sheet open title={title} onClose={onClose}>
      <div className={styles.head}>
        <button type="button" className={styles.nav} aria-label="ماه قبل" onClick={() => move(-1)}>
          <Icon name="arrowRight" size={18} />
        </button>
        <strong className={styles.month} aria-live="polite">
          {JALALI_MONTHS[view.jm - 1]} {toPersianDigits(view.jy)}
        </strong>
        <button type="button" className={styles.nav} aria-label="ماه بعد" onClick={() => move(1)}>
          <Icon name="chevronLeft" size={18} />
        </button>
      </div>
      <div className={styles.grid} role="grid">
        {JALALI_WEEKDAYS_SHORT.map((w, i) => (
          <span key={w + i} className={`${styles.weekday} ${i === 6 ? styles.friday : ''}`}>
            {w}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`e${i}`} />
          const d = { ...view, jd: day }
          const selected = sameJalaliDay(d, value)
          const isToday = sameJalaliDay(d, today)
          const future = compareJalali(d, today) > 0
          return (
            <button
              key={day}
              type="button"
              className={`${styles.day} ${selected ? styles.selected : ''} ${isToday ? styles.today : ''} ${future ? styles.future : ''}`}
              aria-pressed={selected}
              aria-label={`${toPersianDigits(day)} ${JALALI_MONTHS[view.jm - 1]}${isToday ? ' (امروز)' : ''}`}
              onClick={() => onPick(d)}
            >
              {toPersianDigits(day)}
            </button>
          )
        })}
      </div>
      <div className={styles.actions}>
        <Button variant="secondary" small onClick={() => onPick(today)}>
          امروز
        </Button>
      </div>
    </Sheet>
  )
}
