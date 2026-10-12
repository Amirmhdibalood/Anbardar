import type { SqlExecutor } from '../../database/types'
import { AppError } from '../../utils/errors'
import type { SequenceName, SequenceRepository } from '../types'

export class SqliteSequenceRepository implements SequenceRepository {
  constructor(private readonly db: SqlExecutor) {}

  next(name: SequenceName): Promise<number> {
    // افزایش و خواندن باید اتمیک باشند (SAVEPOINT اگر داخل تراکنش باشیم، تراکنش اگر نه)
    return this.db.transaction(async (tx) => {
      const result = await tx.run('UPDATE sequences SET last_value = last_value + 1 WHERE name = ?', [name])
      if (result.changes === 0) throw new AppError('database', 'شمارنده سند پیدا نشد.')
      const row = await tx.get<{ last_value: number }>('SELECT last_value FROM sequences WHERE name = ?', [name])
      return Number(row?.last_value)
    })
  }
}
