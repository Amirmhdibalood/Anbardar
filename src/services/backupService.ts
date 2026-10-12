import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { MIGRATIONS } from '../database/migrations'
import { runMigrations } from '../database/migrations/runner'
import { dumpDatabase, restoreDump, takeSnapshot, validateDump, type DatabaseDump } from '../database/snapshot'
import type { SnapshotStore } from '../database/snapshot'
import { createInventoryService } from './inventoryService'
import { getApp } from './appContext'
import { AppError } from '../utils/errors'
import { nowIso } from '../utils/time'
import { JALALI_MONTHS, toJalali } from '../utils/jalali'
import { toPersianDigits } from '../utils/persian'

const LATEST = MIGRATIONS[MIGRATIONS.length - 1]!.version
export const LAST_BACKUP_KEY = 'last_backup_at'
export const BACKUP_REMINDER_KEY = 'backup_reminder'
const REMIND_AFTER_DAYS = 7

function fileName(): string {
  const j = toJalali(new Date())
  const stamp = `${j.jy}-${String(j.jm).padStart(2, '0')}-${String(j.jd).padStart(2, '0')}`
  return `anbardar-backup-${stamp}.json`
}

export interface BackupInfo {
  lastBackupAt: string | null
  reminderEnabled: boolean
  /** آیا از آخرین پشتیبان بیشتر از ۷ روز گذشته؟ */
  isStale: boolean
}

export async function getBackupInfo(): Promise<BackupInfo> {
  const repos = getApp().repos
  const last = await repos.settings.getValue(LAST_BACKUP_KEY)
  const reminder = (await repos.settings.getValue(BACKUP_REMINDER_KEY)) !== '0'
  let isStale = !last
  if (last) {
    const age = Date.now() - Date.parse(last)
    isStale = !Number.isFinite(age) || age > REMIND_AFTER_DAYS * 24 * 60 * 60 * 1000
  }
  return { lastBackupAt: last, reminderEnabled: reminder, isStale }
}

export async function setBackupReminder(enabled: boolean): Promise<void> {
  await getApp().repos.settings.setValue(BACKUP_REMINDER_KEY, enabled ? '1' : '0')
}

/** ساخت Dump فعلی و علامت‌زدن زمان آخرین پشتیبان */
export async function createBackupDump(): Promise<{ dump: DatabaseDump; json: string; name: string }> {
  const dump = await dumpDatabase(getApp().db, LATEST, 'user-backup')
  const json = JSON.stringify(dump)
  const name = fileName()
  await getApp().repos.settings.setValue(LAST_BACKUP_KEY, nowIso())
  return { dump, json, name }
}

/**
 * ذخیره/اشتراک فایل پشتیبان:
 * - وب: دانلود مستقیم
 * - اندروید: نوشتن در Cache و باز کردن برگه اشتراک سیستم
 */
export async function shareBackup(): Promise<'shared' | 'downloaded'> {
  const { json, name } = await createBackupDump()
  if (Capacitor.isNativePlatform()) {
    const path = `backups/${name}`
    await Filesystem.writeFile({ path, data: json, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true })
    const uri = await Filesystem.getUri({ path, directory: Directory.Cache })
    await Share.share({ title: 'نسخه پشتیبان انباردار', text: 'نسخه پشتیبان اطلاعات فروشگاه', url: uri.uri, dialogTitle: 'ذخیره یا ارسال نسخه پشتیبان' })
    return 'shared'
  }
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return 'downloaded'
}

export interface RestoreResult {
  preRestoreSnapshot: string
  fromSchemaVersion: number
  toSchemaVersion: number
}

/**
 * بازیابی از متن JSON فایل:
 * ۱) اعتبارسنجی ۲) Snapshot ایمنی از وضعیت فعلی ۳) جایگزینی کامل ۴) Migration تا نسخه فعلی ۵) بررسی سلامت
 */
export async function restoreFromJson(text: string, snapshots: SnapshotStore): Promise<RestoreResult> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AppError('validation', 'این فایل JSON معتبر نیست.')
  }
  const check = validateDump(parsed, LATEST)
  if (!check.ok) throw new AppError('validation', check.error)

  const db = getApp().db
  const pre = await takeSnapshot(db, snapshots, LATEST, 'pre-restore')
  await restoreDump(db, check.dump)
  if ('flush' in db && typeof (db as { flush?: () => Promise<void> }).flush === 'function') {
    await (db as { flush: () => Promise<void> }).flush()
  }
  const migration = await runMigrations(db, MIGRATIONS, snapshots)
  const inventory = createInventoryService(db)
  const stockIssues = await inventory.verifyConsistency()
  const costIssues = await inventory.verifyCosts()
  if (stockIssues.length || costIssues.length) {
    throw new AppError(
      'integrity',
      'بازیابی انجام شد ولی سلامت موجودی/لایه‌های بها کامل نیست. از بخش پشتیبان‌گیری «بررسی سلامت» را بزنید یا نسخه قبلی را برگردانید.',
    )
  }
  await getApp().repos.settings.setValue(LAST_BACKUP_KEY, nowIso())
  return { preRestoreSnapshot: pre, fromSchemaVersion: check.dump.schemaVersion, toSchemaVersion: migration.toVersion }
}

export function formatBackupDate(iso: string | null): string {
  if (!iso) return 'هنوز نسخه‌ای نگرفته‌اید'
  try {
    const d = new Date(iso)
    const j = toJalali(d)
    return `${toPersianDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${toPersianDigits(j.jy)}`
  } catch {
    return iso
  }
}
