import { toPersianDigits } from './persian'

/**
 * تبدیل تاریخ شمسی ↔ میلادی (الگوریتم بورکوفسکی، همان روش jalaali-js) بدون وابستگی خارجی.
 * ماه‌ها از ۱ شروع می‌شوند.
 */
export interface JalaliDate {
  jy: number
  jm: number
  jd: number
}

const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178]

export const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'] as const
/** روزهای هفته از شنبه */
export const JALALI_WEEKDAYS_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'] as const

const div = (a: number, b: number) => Math.trunc(a / b)
const mod = (a: number, b: number) => a - Math.trunc(a / b) * b

function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const gy = jy + 621
  let leapJ = -14
  let jp = BREAKS[0]!
  let jump = 0
  if (jy < jp || jy >= BREAKS[BREAKS.length - 1]!) throw new RangeError(`Invalid Jalali year ${jy}`)
  for (let i = 1; i < BREAKS.length; i++) {
    const jm = BREAKS[i]!
    jump = jm - jp
    if (jy < jm) break
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4)
    jp = jm
  }
  let n = jy - jp
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4)
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150
  const march = 20 + leapJ - leapG
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33
  let leap = mod(mod(n + 1, 33) - 1, 4)
  if (leap === -1) leap = 4
  return { leap, gy, march }
}

function g2d(gy: number, gm: number, gd: number): number {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752
  return d
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908
  const i = div(mod(j, 1461), 4) * 5 + 308
  const gd = div(mod(i, 153), 5) + 1
  const gm = mod(div(i, 153), 12) + 1
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6)
  return { gy, gm, gd }
}

export function isJalaliLeapYear(jy: number): boolean {
  return jalCal(jy).leap === 0
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31
  if (jm <= 11) return 30
  return isJalaliLeapYear(jy) ? 30 : 29
}

export function gregorianToJalali(gy: number, gm: number, gd: number): JalaliDate {
  const jdn = g2d(gy, gm, gd)
  let jy = d2g(jdn).gy - 621
  const r = jalCal(jy)
  let k = jdn - g2d(r.gy, 3, r.march)
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 }
    k -= 186
  } else {
    jy -= 1
    k += 179
    if (r.leap === 1) k += 1
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 }
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  const r = jalCal(jy)
  return d2g(g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1)
}

/** تاریخ شمسی روز محلی یک Date */
export function toJalali(date: Date): JalaliDate {
  return gregorianToJalali(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

/** Date محلی برای یک روز شمسی با ساعت/دقیقه داده‌شده */
export function fromJalali(j: JalaliDate, hours = 12, minutes = 0): Date {
  const g = jalaliToGregorian(j.jy, j.jm, j.jd)
  return new Date(g.gy, g.gm - 1, g.gd, hours, minutes, 0, 0)
}

/** ایندکس روز هفته از شنبه (۰ = شنبه … ۶ = جمعه) */
export function weekdayFromSaturday(date: Date): number {
  return (date.getDay() + 1) % 7
}

export function sameJalaliDay(a: JalaliDate, b: JalaliDate): boolean {
  return a.jy === b.jy && a.jm === b.jm && a.jd === b.jd
}

/** مقایسه دو روز شمسی (منفی/صفر/مثبت) */
export function compareJalali(a: JalaliDate, b: JalaliDate): number {
  return a.jy - b.jy || a.jm - b.jm || a.jd - b.jd
}

/** «۱۳ مهر ۱۴۰۵» */
export function formatJalaliDay(d: JalaliDate): string {
  return toPersianDigits(`${d.jd} ${JALALI_MONTHS[d.jm - 1]} ${d.jy}`)
}

/** شروع و پایان روز شمسی به‌صورت ISO (منطقه زمانی محلی دستگاه) */
export function jalaliDayBounds(j: JalaliDate): { from: string; to: string } {
  const start = fromJalali(j, 0, 0)
  const end = fromJalali(j, 23, 59)
  end.setSeconds(59, 999)
  return { from: start.toISOString(), to: end.toISOString() }
}

/** بازه یک ماه شمسی (از اول تا آخر ماه) */
export function jalaliMonthBounds(jy: number, jm: number): { from: string; to: string } {
  const start = jalaliDayBounds({ jy, jm, jd: 1 }).from
  const end = jalaliDayBounds({ jy, jm, jd: jalaliMonthLength(jy, jm) }).to
  return { from: start, to: end }
}
