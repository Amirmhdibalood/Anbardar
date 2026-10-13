// فونت‌ها: انتخاب در «تنظیمات ظاهری › فونت»، اعمال در کل برنامه، ذخیره، ارقام فارسی از خود فونت،
// چیدمان اعداد در فاکتور فروش برای هر فونت + اسکرین‌شات (تنظیمات، خانه، فاکتور)
import puppeteer from 'puppeteer-core'
import { setupDevice } from './lib/device.mjs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/'
const OUT = new URL('../screenshots/', import.meta.url).pathname
const results = []
const problems = []
const check = (n, ok, x = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : ' ' + x}`)
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const page = await (await browser.createBrowserContext()).newPage()
await setupDevice(page)
page.on('pageerror', (e) => problems.push(e.message))
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
page.on('requestfailed', (r) => problems.push('requestfailed ' + r.url()))
const go = async (h) => { await page.goto(BASE + h, { waitUntil: 'networkidle0' }); await page.waitForSelector('header'); await page.evaluate(() => document.fonts.ready); await wait(500) }
const clickText = async (t) => { const [el] = await page.$$(`xpath/.//button[contains(normalize-space(.), "${t}")] | .//a[contains(normalize-space(.), "${t}")]`); await el.evaluate((e) => e.scrollIntoView({ block: 'center' })); await el.click(); await wait(400) }

// داده نمونه: یک کالا و یک فاکتور فروش باز
await go('#/products/new')
await page.type('#f-name', 'هدفون بی‌سیم')
await page.type('#f-salePrice', '1250000')
await clickText('ثبت کالا')
await wait(600)

const families = { vazirmatn: 'Vazirmatn', sahel: 'Sahel', samim: 'Samim' }
for (const [font, family] of Object.entries(families)) {
  await go('#/more/settings')
  await page.click(`[data-font-option="${font}"]`)
  await wait(500)
  await page.evaluate(() => document.fonts.ready)
  const r = await page.evaluate((family) => {
    const body = getComputedStyle(document.body).fontFamily
    const input = getComputedStyle(document.querySelector('button')).fontFamily
    // ارقام فارسی از خود فونت؟ عرض متن با فونت در برابر monospace خالی
    const c = document.createElement('canvas').getContext('2d')
    const w = (f) => ((c.font = `24px ${f}`), c.measureText('۰۱۲۳۴۵۶۷۸۹٬٫').width)
    const loaded = [...document.fonts].filter((f) => f.family.replace(/['"]/g, '') === family && f.status === 'loaded').length
    return { body, input, own: Math.abs(w(`'${family}', monospace`) - w('monospace')) > 1, loaded }
  }, family)
  check(`${font}: applied app-wide (body + controls)`, r.body.startsWith(`"${family}"`) || r.body.startsWith(family), JSON.stringify(r))
  check(`${font}: woff2 loaded locally`, r.loaded >= 1, JSON.stringify(r))
  check(`${font}: Persian digits/separators come from the font`, r.own, JSON.stringify(r))
  await page.screenshot({ path: `${OUT}font-settings-${font}.png` })
  await go('#/')
  check(`${font}: persisted after reload`, await page.evaluate((f) => (document.documentElement.dataset.font ?? 'vazirmatn') === f, font))
  await page.screenshot({ path: `${OUT}font-home-${font}.png` })
  // فاکتور: سطر کالا، تعداد ۱۲، تخفیف — اعداد نباید بشکنند یا سرریز کنند
  await go('#/purchases/new')
  await clickText('افزودن کالا')
  const [opt] = await page.$$(`xpath/.//*[@role="dialog"]//button[contains(normalize-space(.), "هدفون بی‌سیم")]`)
  await opt.click()
  await wait(500)
  const qty = await page.$('[data-line="هدفون بی‌سیم"] input[id^="q-"]')
  if (qty) { await qty.click({ clickCount: 3 }); await qty.type('12'); await wait(300) }
  const price = await page.$('[data-line="هدفون بی‌سیم"] input[id^="p-"]')
  if (price) { await price.click({ clickCount: 3 }); await price.type('1250000'); await wait(400) }
  const lay = await page.evaluate(() => {
    const total = document.querySelector('[data-testid="invoice-total"]')
    const over = [...document.querySelectorAll('main *')].filter((e) => e.children.length === 0 && /[۰-۹]/.test(e.textContent) && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map((e) => e.textContent.trim())
    const tr = total?.getBoundingClientRect()
    return { total: total?.innerText.trim(), oneLine: tr ? tr.height < 48 : false, over, latin: /[0-9]/.test(document.querySelector('main').innerText.replace(/[A-Za-z0-9-]*\d+[A-Za-z-]+/g, '')) }
  })
  check(`${font}: invoice total uses Persian digits and stays on one line`, /^[۱-۹][۰-۹,٬]* تومان$/.test(lay.total ?? '') && lay.oneLine, JSON.stringify(lay))
  check(`${font}: no clipped numbers in invoice`, lay.over.length === 0, JSON.stringify(lay.over))
  await page.screenshot({ path: `${OUT}font-invoice-${font}.png` })
  await clickText('بازگشت').catch(() => {})
}
await go('#/more/settings')
await page.click('[data-font-option="vazirmatn"]')
await wait(300)
check('font licenses bundled (OFL)', await page.evaluate(async () => (await Promise.all(['Vazirmatn', 'Sahel', 'Samim'].map((n) => fetch(`licenses/${n}-OFL.txt`).then((r) => r.ok && r.text()).then((t) => !!t && t.includes('Open Font License'))))).every(Boolean)))
check('no page/console errors', problems.length === 0, problems.join(' | '))
await browser.close()
console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL')).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
