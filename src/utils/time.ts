/** زمان فعلی به‌صورت ISO 8601 (UTC). همه تاریخ‌ها در دیتابیس به این شکل ذخیره می‌شوند. */
export function nowIso(): string {
  return new Date().toISOString()
}
