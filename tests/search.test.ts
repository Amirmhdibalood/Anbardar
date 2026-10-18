import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createStockService } from '../src/services/inventoryService'
import { formatMoneyTyping, formatPercentTyping, formatQuantityTyping } from '../src/services/productForm'
import { parseQuantityInput } from '../src/utils/quantity'
import { matchesTokens, normalizeSearch, searchTokens } from '../src/utils/search'
import { setup } from './helpers'

describe('v1.5.1: search normalization', () => {
  it('ي/ی, ك/ک, digits, ZWNJ, spaces and case are ignored', () => {
    assert.equal(normalizeSearch('كيك'), 'کیک')
    assert.equal(normalizeSearch('مي\u200Cخواهم'), normalizeSearch('می خواهم'))
    assert.equal(normalizeSearch('A-۱۲٣'), 'a-123')
    assert.ok(matchesTokens('شامپو بچه کد X12', searchTokens('بچه x۱۲')))
    assert.ok(!matchesTokens('شامپو', searchTokens('صابون')))
    assert.deepEqual(searchTokens('   '), [])
  })
})

describe('v1.5.1: live number formatting', () => {
  it('money groups by 3 with Persian digits', () => {
    assert.equal(formatMoneyTyping('1234567'), '۱,۲۳۴,۵۶۷')
    assert.equal(formatMoneyTyping('۱,۲۳۴۵'), '۱۲,۳۴۵')
    assert.equal(formatMoneyTyping(''), '')
  })
  it('quantity groups the whole part, keeps one decimal separator, parses back', () => {
    assert.equal(formatQuantityTyping('12345.5'), '۱۲,۳۴۵٫۵')
    assert.equal(formatQuantityTyping('1/25'), '۱٫۲۵')
    assert.equal(formatQuantityTyping('.5'), '۰٫۵')
    assert.equal(formatQuantityTyping('1.2.3'), '۱٫۲۳')
    const r = parseQuantityInput(formatQuantityTyping('12345.5'), true)
    assert.deepEqual(r, { ok: true, value: 12_345_500 })
  })
  it('percent keeps up to 2 decimals', () => {
    assert.equal(formatPercentTyping('12,555'), '۱۲٫۵۵')
    assert.equal(formatPercentTyping('20'), '۲۰')
  })
})

describe('v1.5.1: product search in SQL (name, code, group)', () => {
  it('matches substrings with normalization and stays fast with 2,000+ products', async () => {
    const f = await setup()
    const g = await f.catalog.groups.create({ name: 'لوازم آرایشی' })
    for (let i = 0; i < 2100; i++) await f.catalog.products.create({ name: `کالای نمونه ${i}`, groupId: f.groupId })
    await f.catalog.products.create({ name: 'كرم مرطوب‌کننده', code: 'CR-77', groupId: g.id })
    const stock = createStockService(f.db)
    const t0 = performance.now()
    const byName = await stock.search({ search: 'کرم مرطوب کننده' })
    const ms = performance.now() - t0
    assert.equal(byName.rows.length, 1)
    assert.equal((await stock.search({ search: 'cr-۷۷' })).rows.length, 1)
    assert.equal((await stock.search({ search: 'آرایشی' })).rows.length, 1)
    assert.equal((await f.catalog.products.list({ search: 'ارایشی' })).length, 0, 'آ is not folded in SQL (kept exact)')
    const n209 = await f.catalog.products.list({ search: 'نمونه ۲۰۹' })
    assert.ok(n209.length >= 11 && n209.every((p) => `${p.name}${p.code}`.includes('209')))
    const all = await stock.search({ search: '', limit: 80 })
    assert.equal(all.rows.length, 80)
    assert.ok(all.total > 2000)
    assert.ok(ms < 1500, `search took ${ms}ms`)
  })
})
