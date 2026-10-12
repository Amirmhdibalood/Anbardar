// تست انتخاب‌گر سفارشی (Picker) — تیره و روشن: باز شدن برگه، تیک، جستجو، صفحه‌کلید، افزودن، برگه تودرتو، حالت خالی
import puppeteer from 'puppeteer-core'
import { setupDevice, device } from './lib/device.mjs'
import { pick, pickedText } from './lib/picker.mjs'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/'
const OUT = new URL('../screenshots/', import.meta.url).pathname
const problems = []
const results = []
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + extra}`)
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] })

async function run(theme) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await setupDevice(page)
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`[${theme}] console.${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`))
  const t = (n) => `[${theme}] ${n}`
  const settle = (ms = 300) => page.evaluate((m) => document.fonts.ready.then(() => new Promise((r) => setTimeout(r, m))), ms)
  const go = async (hash) => (await page.goto(BASE + hash, { waitUntil: 'networkidle0' }), settle())
  if (theme === 'light') {
    await go('#/more/settings')
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'روشن')?.click())
    await settle()
    check(t('light theme active'), await page.evaluate(() => document.documentElement.dataset.theme === 'light'))
    // انتخاب‌گر روش محاسبه سود در تنظیمات
    await pick(page, '#cost-method', 'میانگین موزون متحرک')
    check(t('settings cost-method picker saves'), (await pickedText(page, '#cost-method')) === 'میانگین موزون متحرک')
    await pick(page, '#cost-method', 'اولین ورودی، اولین خروجی (FIFO)')
  }
  const dialogs = () => page.evaluate(() => document.querySelectorAll('[role="dialog"]').length)
  const topDialog = () => page.evaluate(() => { const d = document.querySelectorAll('[role="dialog"]'); return d[d.length - 1]?.innerText ?? '' })

  // ۱) واحد شمارش: برگه با عنوان، تیک روی انتخاب فعلی، جستجو (بیش از ۶ گزینه)
  await go('#/products/new')
  check(t('trigger shows current value like an input'), (await pickedText(page, '#f-unitId')) === 'عدد')
  await page.click('#f-unitId')
  await settle()
  const info = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].pop()
    const sel = d.querySelector('[role="option"][aria-selected="true"]')
    const opt = d.querySelector('[role="option"]').getBoundingClientRect()
    return { title: d.querySelector('h2')?.textContent, selected: sel?.textContent.trim(), check: !!sel?.querySelector('svg'), search: !!d.querySelector('input[type=search]'), focusSearch: document.activeElement?.type === 'search', h: opt.height, expanded: document.querySelector('#f-unitId').getAttribute('aria-expanded'), bottom: d.getBoundingClientRect().bottom }
  })
  check(t('sheet title + selected option checkmarked'), info.title === 'واحد شمارش' && info.selected?.startsWith('عدد') && info.check, JSON.stringify(info))
  check(t('search box shown for >6 options and focused'), info.search && info.focusSearch, JSON.stringify(info))
  check(t('large touch targets (≥48px) and aria-expanded'), info.h >= 48 && info.expanded === 'true', JSON.stringify(info))
  check(t('sheet sits on the bottom edge'), Math.abs(info.bottom - (device.h - device.kb)) < 1, JSON.stringify(info))
  await page.screenshot({ path: `${OUT}picker-open-${theme}.png` })
  await page.type('[role="dialog"] input[type=search]', 'کیل')
  await settle(200)
  const filtered = await page.$$eval('[role="dialog"] [role="option"]', (os) => os.map((o) => o.textContent.trim()))
  check(t('search filters options'), filtered.length >= 1 && filtered.every((x) => x.includes('کیل')), JSON.stringify(filtered))
  await page.screenshot({ path: `${OUT}picker-search-${theme}.png` })
  await page.keyboard.press('Enter')
  await settle()
  check(t('Enter in search picks first match and closes'), (await dialogs()) === 0 && (await pickedText(page, '#f-unitId')).startsWith('کیلو'))
  check(t('focus returns to trigger'), await page.evaluate(() => document.activeElement?.id === 'f-unitId'))

  // ۲) صفحه‌کلید: فلش پایین روی دکمه ← باز؛ فلش + Enter ← انتخاب؛ Escape ← بستن بدون تغییر
  await page.keyboard.press('ArrowDown')
  await settle()
  check(t('ArrowDown on trigger opens'), (await dialogs()) === 1)
  await page.keyboard.press('Escape')
  await settle()
  check(t('Escape closes without changing'), (await dialogs()) === 0 && (await pickedText(page, '#f-unitId')).startsWith('کیلو'))

  // ۳) جستجوی بی‌نتیجه ← حالت خالی؛ «افزودن» گروه با متن جستجو ← ساخته و انتخاب می‌شود
  await page.click('#f-groupId')
  await settle()
  check(t('few options → no search box'), !(await page.$('[role="dialog"] input[type=search]')))
  await page.keyboard.press('Escape')
  await settle()
  await pick(page, '#f-unitId', 'عدد')
  await page.click('#f-unitId')
  await settle()
  await page.type('[role="dialog"] input[type=search]', 'زززز')
  await settle(200)
  check(t('no-match empty state'), (await topDialog()).includes('موردی با این جستجو پیدا نشد'))
  await page.keyboard.press('Escape')
  await settle()
  await page.click('#f-groupId')
  await settle()
  await page.evaluate(() => [...[...document.querySelectorAll('[role="dialog"]')].pop().querySelectorAll('button')].find((b) => b.textContent.includes('گروه جدید')).click())
  await settle()
  check(t('add action opens create sheet'), (await topDialog()).includes('نام گروه'))
  await page.type('#group-name', theme === 'dark' ? 'لبنیات' : 'لبنیات روشن')
  await page.evaluate(() => [...[...document.querySelectorAll('[role="dialog"]')].pop().querySelectorAll('button')].find((b) => b.textContent.includes('افزودن گروه')).click())
  await settle(500)
  check(t('new group created and selected'), (await pickedText(page, '#f-groupId')).startsWith('لبنیات'))

  // ۴) انتخاب‌گر داخل برگه دیگر: Escape فقط انتخاب‌گر را می‌بندد
  await go('#/more/expenses')
  await page.evaluate(() => [...document.querySelectorAll('button, a')].find((b) => (b.getAttribute('aria-label') ?? b.textContent).includes('ثبت هزینه'))?.click())
  await settle()
  await page.click('#ex-cat')
  await settle()
  check(t('nested picker opens over the expense sheet'), (await dialogs()) === 2)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await settle()
  check(t('keyboard pick in nested sheet keeps the parent open'), (await dialogs()) === 1, String(await dialogs()))
  await page.click('#ex-cat')
  await settle()
  await page.keyboard.press('Escape')
  await settle()
  check(t('Escape closes only the top sheet'), (await dialogs()) === 1)
  await context.close()
}

await run('dark')
await run('light')
await browser.close()
console.log(results.join('\n'))
if (problems.length) console.log('\nProblems:\n' + [...new Set(problems)].join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(`\n${results.length - fails.length}/${results.length} passed`)
if (fails.length || problems.length) process.exit(1)
