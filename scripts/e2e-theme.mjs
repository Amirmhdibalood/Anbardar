// تنظیمات ظاهری (حالت + رنگ تأکیدی، نشان «ویژه»، پیش‌نمایش زنده، ذخیره) و چراغ تم در سربرگ خانه/تب‌ها
import puppeteer from 'puppeteer-core'
import { setupDevice, device } from './lib/device.mjs'
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/'
const OUT = new URL('../screenshots/', import.meta.url).pathname
const results = []
const problems = []
const check = (n, ok, x = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : ' ' + x}`)
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ctx = await browser.createBrowserContext()
const page = await ctx.newPage()
await setupDevice(page)
page.on('pageerror', (e) => problems.push(e.message))
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()))
const go = async (h) => { await page.goto(BASE + h, { waitUntil: 'networkidle0' }); await page.waitForSelector('header'); await page.evaluate(() => document.fonts.ready); await wait(500) }
const attr = () => page.evaluate(() => ({ theme: document.documentElement.dataset.theme, accent: document.documentElement.dataset.accent ?? 'purple', meta: document.querySelector('meta[name=theme-color]')?.content }))
const lamp = () => page.evaluate(() => { const l = document.querySelector('[data-theme-lamp]'); const h = l?.closest('header')?.getBoundingClientRect(); const r = l?.getBoundingClientRect(); return l ? { lit: l.dataset.lit, leftGap: r.left - h.left, top: r.top - h.top } : null })
const clickBtn = (t) => page.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t)?.click(), t)

// خانه در تیره: چراغ خاموش، بالا چپ
await go('#/')
let l = await lamp()
check('home: lamp at top-left, unlit in dark', l && l.lit === 'false' && l.leftGap < 30 && l.top < 60, JSON.stringify(l))
await page.screenshot({ path: `${OUT}home-lamp-off.png` })
// زدن چراغ ← روشن، با ذخیره
await page.click('[data-theme-lamp]')
await wait(700)
check('lamp tap → light theme, lamp lit', (await attr()).theme === 'light' && (await lamp()).lit === 'true')
check('theme-color meta follows background', (await attr()).meta?.toLowerCase() === '#f6f6fa', JSON.stringify(await attr()))
await page.screenshot({ path: `${OUT}home-lamp-on.png` })
await go('#/')
check('lamp choice persisted after reload', (await attr()).theme === 'light' && (await lamp()).lit === 'true')
// تب‌های اصلی: چراغ؛ صفحه‌های داخلی: بازگشت (نه چراغ)
for (const h of ['#/products', '#/stock', '#/reports', '#/more']) {
  await go(h)
  const x = await lamp()
  check(`root tab ${h}: lamp at top-left`, x && x.leftGap < 30, JSON.stringify(x))
}
await go('#/more/settings')
check('inner page: back button, no lamp', await page.evaluate(() => !!document.querySelector('header [data-back-button]') && !document.querySelector('[data-theme-lamp]')))
// تنظیمات ظاهری
const info = await page.evaluate(() => {
  const t = document.body.innerText
  const sw = [...document.querySelectorAll('[data-accent-option]')]
  return { section: t.includes('تنظیمات ظاهری'), tem: t.includes('تم'), modes: ['روشن', 'تیره', 'مطابق سیستم'].every((m) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === m)), n: sw.length, premium: sw.filter((s) => s.textContent.includes('ویژه')).map((s) => s.dataset.accentOption), checked: sw.find((s) => s.getAttribute('aria-checked') === 'true')?.dataset.accentOption, preview: !!document.querySelector('[data-testid=theme-preview]') }
})
check('settings: «تنظیمات ظاهری» › «تم» with روشن/تیره/مطابق سیستم', info.section && info.modes, JSON.stringify(info))
check('5 accent swatches, purple selected (free default)', info.n === 5 && info.checked === 'purple', JSON.stringify(info))
check('«ویژه» badge on the 4 non-free accents only', JSON.stringify(info.premium) === JSON.stringify(['teal', 'emerald', 'gold', 'crimson']), JSON.stringify(info))
check('live preview present', info.preview)
// رنگ روشن: سرخابی
await page.click('[data-accent-option="crimson"]')
await wait(600)
const pv = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid=theme-preview] > span')).backgroundColor)
check('premium accent still selectable now; live preview recolors', (await attr()).accent === 'crimson' && pv === 'rgb(225, 29, 72)', pv)
await page.screenshot({ path: `${OUT}settings-theme-light.png` })
// حالت تیره: رنگ جدا (هنوز بنفش)، سپس آبی نفتی
await clickBtn('تیره')
await wait(600)
check('dark mode keeps its own accent (purple)', (await attr()).theme === 'dark' && (await attr()).accent === 'purple', JSON.stringify(await attr()))
await page.click('[data-accent-option="teal"]')
await wait(600)
await page.screenshot({ path: `${OUT}settings-theme-dark.png` })
await go('#/more/settings')
check('accents persisted per mode after reload', (await attr()).accent === 'teal' && (await page.evaluate(() => document.querySelector('[aria-checked=true][data-accent-option]')?.dataset.accentOption)) === 'teal')
await go('#/')
await page.click('[data-theme-lamp]')
await wait(600)
check('lamp → light uses light accent (crimson)', (await attr()).theme === 'light' && (await attr()).accent === 'crimson', JSON.stringify(await attr()))
// مطابق سیستم
await go('#/more/settings')
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
await clickBtn('مطابق سیستم')
await wait(600)
check('system mode follows OS (dark)', (await attr()).theme === 'dark')
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
await wait(600)
check('system mode reacts to OS change (light)', (await attr()).theme === 'light')
// برگرداندن پیش‌فرض‌ها
await page.click('[data-accent-option="purple"]'); await clickBtn('تیره'); await wait(300); await page.click('[data-accent-option="purple"]'); await wait(300)
check('no page/console errors', problems.length === 0, problems.join(' | '))
await browser.close()
console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL')).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
