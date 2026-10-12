/**
 * تولید شناسه یکتا (UUID نسخه ۷).
 * زمان‌دار است، پس در SQLite ترتیب درج را حفظ می‌کند و ایندکس‌ها کارآمدتر می‌مانند؛
 * برای همگام‌سازی و نسخه‌های وب/چندکاربره هم بدون برخورد است.
 */
export function newId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  const ts = Date.now()
  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff
  bytes[2] = (ts >>> 24) & 0xff
  bytes[3] = (ts >>> 16) & 0xff
  bytes[4] = (ts >>> 8) & 0xff
  bytes[5] = ts & 0xff
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
