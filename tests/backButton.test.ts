import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideBack, type BackState } from '../src/navigation/backButton'

const base: BackState = { dialogOpen: false, hasBackButton: false, pathname: '/', canGoBack: true, lastHomePress: null, now: 10_000 }

test('بازگشت: اول برگه باز بسته می‌شود', () => assert.equal(decideBack({ ...base, dialogOpen: true, hasBackButton: true }), 'close-dialog'))
test('بازگشت: دکمه سربرگ زده می‌شود', () => assert.equal(decideBack({ ...base, pathname: '/sales/new', hasBackButton: true }), 'page-back'))
test('بازگشت: تب ریشه به خانه', () => {
  for (const p of ['/products', '/stock', '/reports', '/more']) assert.equal(decideBack({ ...base, pathname: p }), 'go-home')
})
test('بازگشت: صفحه داخلی بی‌دکمه', () => {
  assert.equal(decideBack({ ...base, pathname: '/x' }), 'history-back')
  assert.equal(decideBack({ ...base, pathname: '/x', canGoBack: false }), 'go-home')
})
test('بازگشت: خانه دو بار در ۲ ثانیه', () => {
  assert.equal(decideBack(base), 'arm-exit')
  assert.equal(decideBack({ ...base, lastHomePress: 8_500 }), 'exit')
  assert.equal(decideBack({ ...base, lastHomePress: 7_000 }), 'arm-exit')
})

test('تم: فقط بنفش رایگان است و قفل فعلاً خاموش', async () => {
  const { isPremiumAccent, isAccentLocked, PREMIUM_ACCENTS_LOCKED } = await import('../src/config/themes')
  assert.equal(isPremiumAccent('purple'), false)
  assert.equal(isPremiumAccent('gold'), true)
  assert.equal(PREMIUM_ACCENTS_LOCKED, false)
  assert.equal(isAccentLocked('gold'), false)
})
test('تنظیمات: رنگ نامعتبر ← بنفش', async () => {
  const { sanitizeSettings } = await import('../src/models/settings')
  const s = sanitizeSettings({ accentDark: 'neon', accentLight: 'teal' })
  assert.equal(s.accentDark, 'purple')
  assert.equal(s.accentLight, 'teal')
})
