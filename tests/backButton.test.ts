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
