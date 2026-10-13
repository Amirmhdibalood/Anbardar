// اسکریپت تست ظاهری: اجرای نسخه build در Chrome بدون رابط و گرفتن اسکرین‌شات + بررسی خطاهای کنسول
// اجرا: npm run build && (npx vite preview --port 4173 &) && node scripts/screenshots.mjs
import puppeteer from 'puppeteer-core'
import initSqlJs from 'sql.js'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/'
const OUT = new URL('../screenshots/', import.meta.url).pathname
const problems = []

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})

async function newPage(colorScheme = 'dark') {
  const context = await browser.createBrowserContext() // حافظه محلی جدا برای هر سناریو
  const page = await context.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: colorScheme }])
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`console.${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`))
  page.on('response', (r) => r.status() >= 400 && problems.push(`http ${r.status()}: ${r.url()}`))
  return page
}

const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme)
const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png` })
const settle = (page) => page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 250))))
const results = []
const check = (name, ok) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}`)

// ---- تم تیره (پیش‌فرض)
let page = await newPage('dark')
await page.goto(BASE, { waitUntil: 'networkidle0' })
await settle(page)
check('default theme is dark', (await theme(page)) === 'dark')
check('html dir=rtl lang=fa', await page.evaluate(() => document.documentElement.dir === 'rtl' && document.documentElement.lang === 'fa'))
check('Vazirmatn font loaded', await page.evaluate(() => document.fonts.check('16px Vazirmatn')))
await shot(page, 'home-dark')

await page.click('button[aria-label="ثبت جدید"]')
await settle(page)
check('register sheet opens', !!(await page.$('[role="dialog"]')))
await shot(page, 'register-sheet-dark')
await page.keyboard.press('Escape')
check('register sheet closes with Esc', !(await page.$('[role="dialog"]')))

await page.goto(BASE + '#/more', { waitUntil: 'networkidle0' })
await settle(page)
await shot(page, 'more-dark')

await page.goto(BASE + '#/more/settings', { waitUntil: 'networkidle0' })
await settle(page)
await shot(page, 'settings-dark')

// ---- تغییر تم و واحد پول از صفحه تنظیمات و ماندگاری آن
const clickRadio = async (text) => {
  const [el] = await page.$$(`xpath/.//button[@role="radio"][contains(., "${text}")]`)
  if (!el) throw new Error('radio not found: ' + text)
  await el.click()
}
await clickRadio('روشن')
await settle(page)
check('switching to light sets data-theme=light', (await theme(page)) === 'light')
await settle(page)
await shot(page, 'settings-light')
await page.reload({ waitUntil: 'networkidle0' })
await settle(page)
check('theme persisted after reload (light)', (await theme(page)) === 'light')
check('no currency/ریال option anywhere in settings', !(await page.evaluate(() => document.body.innerText)).includes('ریال'))

await page.goto(BASE + '#/', { waitUntil: 'networkidle0' })
await settle(page)
await shot(page, 'home-light')
await page.goto(BASE + '#/more', { waitUntil: 'networkidle0' })
await settle(page)
await shot(page, 'more-light')
await page.click('button[aria-label="ثبت جدید"]')
await settle(page)
await shot(page, 'register-sheet-light')
await page.keyboard.press('Escape')

// ---- مسیر ناموجود
await page.goto(BASE + '#/does-not-exist', { waitUntil: 'networkidle0' })
await settle(page)
check('unknown route shows Persian 404', (await page.evaluate(() => document.body.innerText)).includes('صفحه پیدا نشد'))
await shot(page, 'not-found-light')

// ---- جدول «سیستم»: با ترجیح تیره‌ی سیستم تیره شود
await page.goto(BASE + '#/more/settings', { waitUntil: 'networkidle0' })
await clickRadio('مطابق سیستم')
await settle(page)
check('system option follows OS (dark emulated)', (await theme(page)) === 'dark')
await page.close()

// ---- جریان ثبت از نوار: فروش
page = await newPage('light')
await page.goto(BASE, { waitUntil: 'networkidle0' })
check('light OS + default pref -> dark (pref is dark)', (await theme(page)) === 'dark')
await page.click('button[aria-label="ثبت جدید"]')
await settle(page)
await (await page.$('[role="dialog"] a[href="#/sales/new"]')).click()
await settle(page)
check('sheet -> ثبت فروش navigates', page.url().endsWith('#/sales/new'))
await page.close()


// ---- دیتابیس واقعی در مرورگر (sql.js + IndexedDB): Migration، Seed و انتقال تنظیمات قدیمی
{
  page = await newPage('dark')
  await page.evaluateOnNewDocument(() => {
    if (!sessionStorage.getItem('legacy-seeded')) {
      sessionStorage.setItem('legacy-seeded', '1')
      localStorage.setItem('anbardar.settings.v1', JSON.stringify({ theme: 'light', currency: 'rial' }))
    }
  })
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await settle(page)
  check('legacy localStorage theme imported into DB (light)', (await theme(page)) === 'light')
  check('legacy localStorage key removed after import', await page.evaluate(() => localStorage.getItem('anbardar.settings.v1') === null))
  await page.evaluate(() => localStorage.removeItem('anbardar.theme.v1')) // کش حذف شود؛ مرجع دیتابیس است
  await page.reload({ waitUntil: 'networkidle0' })
  await settle(page)
  check('theme is read from the database when the cache is gone', (await theme(page)) === 'light')
  check('home reads product count from DB (۰)', /تعداد کالاها\s*۰/.test(await page.evaluate(() => document.body.innerText)))
  await new Promise((r) => setTimeout(r, 800)) // ذخیره با تأخیر در IndexedDB
  const bytes = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('anbardar-web', 1)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const get = open.result.transaction('files').objectStore('files').get('anbardar.sqlite')
          get.onsuccess = () => resolve(get.result ? Array.from(get.result) : null)
          get.onerror = () => reject(get.error)
        }
      }),
  )
  check('database file persisted in IndexedDB', Array.isArray(bytes) && bytes.length > 4096)
  if (Array.isArray(bytes)) {
    const SQL = await initSqlJs()
    const db = new SQL.Database(Uint8Array.from(bytes))
    const one = (sql) => db.exec(sql)[0]?.values ?? []
    check('persisted DB: latest schema applied (units + cost_lots tables present)', one('SELECT MAX(version) FROM schema_migrations')[0]?.[0] >= 3 && one("SELECT COUNT(*) FROM sqlite_master WHERE name='cost_lots'")[0]?.[0] === 1 && one('SELECT COUNT(*) FROM units')[0]?.[0] === 9)
    check('persisted DB: seeded warehouse/customer/group', one("SELECT name FROM warehouses")[0]?.[0] === 'انبار مرکزی' && one('SELECT name FROM customers')[0]?.[0] === 'مشتری نقدی' && one('SELECT name FROM product_groups')[0]?.[0] === 'عمومی')
    check('persisted DB: theme stored in settings table', one("SELECT value FROM settings WHERE key='theme'")[0]?.[0] === 'light')
    check('persisted DB: no negative-stock setting (always forbidden) + system supplier', one("SELECT COUNT(*) FROM settings WHERE key='allow_negative_stock'")[0]?.[0] === 0 && one("SELECT name FROM suppliers WHERE is_system=1")[0]?.[0] === 'متفرقه')
    db.close()
  }
  await page.close()
}

await browser.close()
console.log(results.join('\n'))
console.log('\nConsole/runtime problems:', problems.length ? '\n' + problems.join('\n') : 'none')
process.exit(results.some((r) => r.startsWith('FAIL')) || problems.length ? 1 : 0)
