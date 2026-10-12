import { compareJalali, formatJalaliDay, fromJalali, jalaliMonthLength, JALALI_MONTHS, toJalali, type JalaliDate } from './jalali'
import { toPersianDigits } from './persian'

/**
 * بازه‌های گزارش بر اساس تقویم شمسی و ساعت محلی دستگاه.
 * from شامل و to انحصاری است (ابتدای روز بعد از آخرین روز بازه) تا هیچ لحظه‌ای جا نیفتد یا دو بار شمرده نشود.
 */
export const PERIOD_KEYS = ['today', 'month', 'last_month', 'year', 'custom'] as const
export type PeriodKey = (typeof PERIOD_KEYS)[number]

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'امروز',
  month: 'این ماه',
  last_month: 'ماه قبل',
  year: 'امسال',
  custom: 'بازه دلخواه',
}

export interface PeriodSpec {
  key: PeriodKey
  /** فقط بازه دلخواه: روز اول و آخر (هر دو شامل) */
  from?: JalaliDate
  to?: JalaliDate
}

export interface Period {
  key: PeriodKey
  /** ISO؛ شامل */
  from: string
  /** ISO؛ انحصاری */
  to: string
  firstDay: JalaliDate
  /** آخرین روز (شامل) */
  lastDay: JalaliDate
  label: string
}

function startOf(day: JalaliDate): Date {
  return fromJalali(day, 0, 0)
}

function dayAfter(day: JalaliDate): Date {
  const d = startOf(day)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0)
}

function monthRange(jy: number, jm: number): [JalaliDate, JalaliDate] {
  return [
    { jy, jm, jd: 1 },
    { jy, jm, jd: jalaliMonthLength(jy, jm) },
  ]
}

export function resolvePeriod(spec: PeriodSpec, now = new Date()): Period {
  const today = toJalali(now)
  let first: JalaliDate
  let last: JalaliDate
  let label: string
  switch (spec.key) {
    case 'today':
      first = last = today
      label = `امروز، ${formatJalaliDay(today)}`
      break
    case 'month':
      ;[first, last] = monthRange(today.jy, today.jm)
      label = `${JALALI_MONTHS[today.jm - 1]} ${toPersianDigits(today.jy)}`
      break
    case 'last_month': {
      const jy = today.jm === 1 ? today.jy - 1 : today.jy
      const jm = today.jm === 1 ? 12 : today.jm - 1
      ;[first, last] = monthRange(jy, jm)
      label = `${JALALI_MONTHS[jm - 1]} ${toPersianDigits(jy)}`
      break
    }
    case 'year':
      first = { jy: today.jy, jm: 1, jd: 1 }
      last = { jy: today.jy, jm: 12, jd: jalaliMonthLength(today.jy, 12) }
      label = `سال ${toPersianDigits(today.jy)}`
      break
    case 'custom': {
      const a = spec.from ?? today
      const b = spec.to ?? today
      ;[first, last] = compareJalali(a, b) <= 0 ? [a, b] : [b, a]
      label = compareJalali(first, last) === 0 ? formatJalaliDay(first) : `${formatJalaliDay(first)} تا ${formatJalaliDay(last)}`
      break
    }
  }
  return { key: spec.key, from: startOf(first).toISOString(), to: dayAfter(last).toISOString(), firstDay: first, lastDay: last, label }
}

/** «1405-07-13» ← روز شمسی (برای نگهداری در آدرس صفحه) */
export function jalaliToParam(d: JalaliDate): string {
  return `${d.jy}-${String(d.jm).padStart(2, '0')}-${String(d.jd).padStart(2, '0')}`
}

export function jalaliFromParam(text: string | null | undefined): JalaliDate | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? '')
  if (!m) return undefined
  const d = { jy: Number(m[1]), jm: Number(m[2]), jd: Number(m[3]) }
  if (d.jy < 1300 || d.jy > 1500 || d.jm < 1 || d.jm > 12 || d.jd < 1 || d.jd > jalaliMonthLength(d.jy, d.jm)) return undefined
  return d
}

/** خواندن بازه از پارامترهای آدرس (?p=month یا ?p=custom&from=…&to=…)؛ پیش‌فرض «این ماه» */
export function periodFromParams(params: URLSearchParams): PeriodSpec {
  const key = (PERIOD_KEYS as readonly string[]).includes(params.get('p') ?? '') ? (params.get('p') as PeriodKey) : 'month'
  if (key !== 'custom') return { key }
  return { key, from: jalaliFromParam(params.get('from')), to: jalaliFromParam(params.get('to')) }
}
