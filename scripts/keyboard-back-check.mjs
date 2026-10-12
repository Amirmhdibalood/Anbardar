// صفحه‌کلید (دو حالت: WebView کوچک‌شده بومی / صفحه‌کلید روی محتوا با visualViewport کوتاه) + دکمه بازگشت
// سخت‌افزاری (رویداد anbardar:back همان مسیر App.backButton) + دکمه بازگشت سربرگ (چپ) و عنوان (راست).
import puppeteer from 'puppeteer-core'
import { installFakeKeyboard } from './lib/device.mjs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/'
const OUT = new URL('../screenshots/', import.meta.url).pathname
const results = []
const problems = []
const check = (n, ok, x = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : ' ' + x}`)
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function newPage(w, h, top, bottom) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
  page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()))
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.evaluateOnNewDocument(installFakeKeyboard, 0)
  await page.evaluateOnNewDocument((d) => {
    window.__insets = d
    const set = () => {
      document.documentElement.style.setProperty('--safe-area-inset-top', window.__insets.top + 'px')
      document.documentElement.style.setProperty('--safe-area-inset-bottom', window.__insets.bottom + 'px')
    }
    window.__applyInsets = set
    document.addEventListener('DOMContentLoaded', set)
  }, { top, bottom })
  return page
}
const go = async (page, hash) => {
  await page.goto(BASE + hash, { waitUntil: 'networkidle0' })
  await page.waitForSelector('header h1, nav', { timeout: 10000 }).catch(() => {})
  await wait(500)
}
const path = (page) => page.evaluate(() => location.hash.replace(/^#/, '').split('?')[0] || '/')
const back = async (page) => (await page.evaluate(() => window.dispatchEvent(new Event('anbardar:back'))), wait(450))
const dialogs = (page) => page.evaluate(() => document.querySelectorAll('[role="dialog"]').length)

const layout = (page) =>
  page.evaluate(() => {
    const footers = [...document.querySelectorAll('[class*="footer"]')].filter((e) => getComputedStyle(e).position === 'sticky' || getComputedStyle(e).position === 'fixed')
    const f = footers.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0]?.getBoundingClientRect()
    const a = document.activeElement?.getBoundingClientRect()
    const header = document.querySelector('header')?.getBoundingClientRect()
    const vvh = window.visualViewport.height
    return {
      vvh,
      ih: innerHeight,
      footerBottom: f?.bottom,
      footerTop: f?.top,
      focusTop: a?.top,
      focusBottom: a?.bottom,
      headerBottom: header?.bottom,
      kbOpen: document.documentElement.classList.contains('kb-open'),
      safeBottom: getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom').trim(),
      footerPad: f ? parseFloat(getComputedStyle(footers[0]).paddingBottom) : null,
    }
  })

for (const dev of [
  { name: '412x915-3btn', w: 412, h: 915, top: 24, bottom: 48 },
  { name: '360x780-gesture', w: 360, h: 780, top: 24, bottom: 16 },
]) {
  const kb = Math.round(dev.h * 0.4)
  for (const [hash, field] of [['#/products/new', '#f-name'], ['#/products/new?low', '#f-reorderPoint']]) {
    const tag = `${dev.name} ${hash}`
    // ── حالت ۱: صفحه‌کلید روی محتوا (visualViewport کوتاه) ──
    let page = await newPage(dev.w, dev.h, dev.top, dev.bottom)
    await go(page, hash)
    await page.waitForSelector(field, { timeout: 10000 })
    const sel = field
    const closed = await layout(page)
    await page.focus(sel)
    await page.evaluate((k) => window.__setKb(k), kb)
    await wait(700)
    let r = await layout(page)
    check(`${tag} overlay-kb: kb-open + bottom inset dropped (no double)`, r.kbOpen && r.safeBottom === '0px', JSON.stringify(r))
    check(`${tag} overlay-kb: submit bar sits right on top of keyboard`, r.footerBottom != null && Math.abs(r.footerBottom - (dev.h - kb)) <= 1, JSON.stringify(r))
    check(`${tag} overlay-kb: focused field visible between header and bar`, r.focusTop >= (r.headerBottom ?? 0) - 1 && r.focusBottom <= r.footerTop + 1, JSON.stringify(r))
    await page.screenshot({ path: `${OUT}keyboard-overlay-${dev.name}-${hash.includes('low') ? 'low-field' : 'name-field'}.png` })
    await page.evaluate(() => window.__setKb(0))
    await wait(500)
    r = await layout(page)
    check(`${tag} kb closed again: bar back on screen bottom, inset restored`, !r.kbOpen && Math.abs(r.footerBottom - dev.h) <= 1 && Math.abs(r.footerBottom - closed.footerBottom) <= 1, JSON.stringify(r))
    await page.browserContext().close()

    // ── حالت ۲: WebView بومی کوچک شد (SystemBars: padding = ime، --safe-area-inset-bottom = 0) ──
    page = await newPage(dev.w, dev.h, dev.top, dev.bottom)
    await go(page, hash)
    await page.focus(sel)
    await page.evaluate(() => ((window.__insets.bottom = 0), window.__applyInsets()))
    await page.setViewport({ width: dev.w, height: dev.h - kb, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    await wait(800)
    r = await layout(page)
    check(`${tag} native-resize: no extra kb inset (--kb-inset 0)`, !r.kbOpen && (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--kb-inset').trim())) === '0px', JSON.stringify(r))
    check(`${tag} native-resize: bar flush on keyboard, no gap`, Math.abs(r.footerBottom - (dev.h - kb)) <= 1 && r.footerPad <= 12, JSON.stringify(r))
    check(`${tag} native-resize: focused field visible`, r.focusTop >= (r.headerBottom ?? 0) - 1 && r.focusBottom <= r.footerTop + 1, JSON.stringify(r))
    await page.screenshot({ path: `${OUT}keyboard-native-${dev.name}-${hash.includes('low') ? 'low-field' : 'name-field'}.png` })
    await page.browserContext().close()
  }
}

// ── دکمه بازگشت ──
const page = await newPage(412, 915, 24, 48)
// سربرگ: عنوان راست، دکمه بازگشت چپ، روی همه صفحه‌های داخلی
const inner = {
  '#/products/new': '/products', '#/products/groups': '/products', '#/sales/new': '/', '#/purchases/new': '/purchases',
  '#/sales': '/more', '#/purchases': '/more', '#/money': '/more', '#/money/new': '/money', '#/transfers': '/more', '#/transfers/new': '/transfers',
  '#/balances': '/reports', '#/more/expenses': '/more', '#/more/price-calculator': '/more', '#/more/customers': '/more', '#/more/suppliers': '/more',
  '#/more/parties': '/more', '#/more/warehouses': '/more', '#/more/settings': '/more', '#/more/backup': '/more', '#/more/help': '/more',
}
for (const [hash, expected] of Object.entries(inner)) {
  await go(page, hash)
  const h = await page.evaluate(() => {
    const hd = document.querySelector('header')
    const b = hd?.querySelector('[data-back-button]')?.getBoundingClientRect()
    const t = hd?.querySelector('h1')?.getBoundingClientRect()
    const hr = hd?.getBoundingClientRect()
    return { has: !!b, backLeft: b ? b.left - hr.left : null, titleRightGap: t ? hr.right - t.right : null, bg: hd ? getComputedStyle(hd).backgroundColor : '' }
  })
  check(`header ${hash}: back on LEFT, title on RIGHT`, h.has && h.backLeft < 40 && h.titleRightGap < 40, JSON.stringify(h))
  await back(page)
  if ((await dialogs(page)) > 0) await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.includes('خارج'))?.click()), await wait(400)
  const p = await path(page)
  check(`hw-back ${hash} → ${expected}`, p === expected, p)
}
// تب‌های ریشه ← خانه
for (const hash of ['#/products', '#/stock', '#/reports', '#/more']) {
  await go(page, hash)
  const noBack = await page.evaluate(() => !document.querySelector('[data-back-button]'))
  await back(page)
  check(`root tab ${hash}: no header back, hw-back → home`, noBack && (await path(page)) === '/', await path(page))
}
// تاریخچه: خانه ← بیشتر ← تنظیمات؛ بازگشت ← بیشتر ← خانه
await go(page, '#/')
await page.evaluate(() => [...document.querySelectorAll('nav a')].find((a) => a.textContent.includes('بیشتر'))?.click())
await wait(400)
await page.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.getAttribute('href')?.endsWith('/more/settings'))?.click())
await wait(500)
const atSettings = await path(page)
await back(page)
const p1 = await path(page)
await back(page)
check('history: settings → more → home', atSettings === '/more/settings' && p1 === '/more' && (await path(page)) === '/', `${atSettings} ${p1} ${await path(page)}`)
// برگه باز: اول بسته شود
await go(page, '#/products/new')
await page.click('#f-unitId')
await wait(400)
const opened = await dialogs(page)
await back(page)
check('hw-back closes open picker sheet first (stays on page)', opened === 1 && (await dialogs(page)) === 0 && (await path(page)) === '/products/new')
// برگه تودرتو: فقط بالایی
await page.click('#f-groupId')
await wait(400)
await page.evaluate(() => [...[...document.querySelectorAll('[role="dialog"]')].pop().querySelectorAll('button')].find((b) => b.textContent.includes('افزودن'))?.click())
await wait(500)
const nested = await dialogs(page)
await back(page)
const afterOne = await dialogs(page)
await back(page)
check('hw-back closes nested sheets one at a time', nested >= 1 && afterOne === nested - 1 && (await dialogs(page)) === Math.max(0, nested - 2), `${nested} ${afterOne}`)
while ((await dialogs(page)) > 0) await back(page)
// فرم پر: تأیید خروج
if ((await path(page)) !== '/products/new') await go(page, '#/products/new')
await page.type('#f-name', 'کالای آزمایشی')
await back(page)
const confirmText = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].pop()?.innerText ?? '')
check('dirty product form: hw-back asks to confirm', confirmText.includes('خروج بدون ثبت'), confirmText)
await back(page)
check('second back cancels confirm, stays on form with data', (await dialogs(page)) === 0 && (await path(page)) === '/products/new' && (await page.$eval('#f-name', (i) => i.value)) === 'کالای آزمایشی')
await back(page)
await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.includes('خارج'))?.click())
await wait(500)
check('confirm leave → products list', (await path(page)) === '/products')
// فرم‌های دیگر
for (const [hash, fill] of []) {
  await go(page, hash)
  if (fill) {
    await fill()
    await back(page)
    const t = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].pop()?.innerText ?? '')
    check(`dirty ${hash}: confirm before leaving`, t.includes('خروج بدون ثبت'), t)
    while ((await dialogs(page)) > 0) await back(page)
  }
}
// خانه: دو بار در ۲ ثانیه ← خروج
await go(page, '#/')
await page.evaluate(() => { window.__exited = 0; window.addEventListener('anbardar:exit', () => window.__exited++) })
await back(page)
const toast = await page.evaluate(() => document.body.innerText.includes('برای خروج دوباره بزنید'))
await page.screenshot({ path: `${OUT}back-exit-toast.png` })
const ex1 = await page.evaluate(() => window.__exited)
await back(page)
check('home: first back shows toast, does not exit', toast && ex1 === 0)
check('home: second back within 2s exits', (await page.evaluate(() => window.__exited)) === 1 && (await path(page)) === '/')
await wait(2300)
await back(page)
check('home: back after 2s only re-arms (toast, no exit)', (await page.evaluate(() => window.__exited)) === 1)

check('no page/console errors', problems.length === 0, problems.join(' | '))
await browser.close()
console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL')).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
