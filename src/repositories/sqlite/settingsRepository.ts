import { DEFAULT_SETTINGS, sanitizeSettings, type AppSettings } from '../../models/settings'
import type { SqlExecutor } from '../../database/types'
import { nowIso } from '../../utils/time'
import type { SettingsRepository } from '../types'

const UPSERT = 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: SqlExecutor) {}

  async load(): Promise<AppSettings> {
    const rows = await this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings')
    const map = new Map(rows.map((r) => [r.key, r.value]))
    return sanitizeSettings({
      theme: map.get('theme') ?? DEFAULT_SETTINGS.theme,
      costMethod: map.get('cost_method') ?? DEFAULT_SETTINGS.costMethod,
      salePriceMode: map.get('sale_price_mode') ?? DEFAULT_SETTINGS.salePriceMode,
      markupBp: map.get('markup_bp') ?? DEFAULT_SETTINGS.markupBp,
    })
  }

  async save(settings: AppSettings): Promise<void> {
    const clean = sanitizeSettings(settings)
    const now = nowIso()
    await this.db.transaction(async (tx) => {
      await tx.run(UPSERT, ['theme', clean.theme, now])
      await tx.run(UPSERT, ['cost_method', clean.costMethod, now])
      await tx.run(UPSERT, ['sale_price_mode', clean.salePriceMode, now])
      await tx.run(UPSERT, ['markup_bp', String(clean.markupBp), now])
    })
  }

  async getValue(key: string): Promise<string | null> {
    const row = await this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
    return row?.value ?? null
  }

  async setValue(key: string, value: string): Promise<void> {
    await this.db.run(UPSERT, [key, value, nowIso()])
  }
}
