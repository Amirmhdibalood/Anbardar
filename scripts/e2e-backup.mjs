// تست End-to-End فاز ۷ (پشتیبان‌گیری / بازیابی / یادآوری)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/'
const OUT = new URL('../screenshots/', import.meta.url).pathname
const TMP = path.join(path.dirname(fileURLToPath(import.meta.url)), '../tmp')
const problems = []
const results = []
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + extra}`)

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] })

async function run(theme) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`[${theme}] console.${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`))
  page.on('requestfailed', (r) => problems.push(`[${theme}] requestfailed: ${r.url()}`))
  page.on('response', (r) => r.status() >= 400 && problems.push(`[${theme}] http ${r.status()}: ${r.url()}`))
  await page.evaluateOnNewDocument((t) => {
    if (!localStorage.getItem('anbardar.theme.v1')) localStorage.setItem('anbardar.theme.v1', t)
  }, theme)

  const t = (name) => `[${theme}] ${name}`
  const shot = (name) => page.screenshot({ path: `${OUT}phase7-${name}-${theme}.png` })
  const settle = (ms = 350) => page.evaluate((m) => document.fonts.ready.then(() => new Promise((r) => setTimeout(r, m))), ms)
  const body = () => page.evaluate(() => document.body.innerText)
  const go = async (hash) => {
    await page.goto(BASE + hash, { waitUntil: 'networkidle0' })
    await settle()
  }
  const clickText = async (text, tag = 'button') => {
    const [el] = await page.$$(`xpath/.//${tag}[contains(normalize-space(.), "${text}")] | .//a[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('not found: ' + text)
    await el.click()
    await settle()
  }
  const waitText = async (text, ms = 5000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if ((await body()).includes(text)) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    return false
  }
  const fill = async (sel, text) => {
    await page.$eval(sel, (e) => {
      e.focus()
      e.select()
    })
    for (let i = 0; i < 40 && (await page.$eval(sel, (e) => e.value)) !== ''; i++) await page.keyboard.press('Backspace')
    if (text) await page.type(sel, text)
  }
  const selectByText = async (sel, text) => {
    const value = await page.$eval(sel, (s, tx) => [...s.options].find((o) => o.textContent.trim() === tx)?.value, text)
    if (!value) throw new Error('option not found: ' + text)
    await page.select(sel, value)
    await settle(150)
  }
  const dialogClick = async (text) => {
    const [el] = await page.$$(`xpath/.//*[@role="dialog"]//button[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('dialog button not found: ' + text)
    await el.click()
    await settle()
  }
  const lineSel = (name, prefix) => `[data-line="${name}"] input[id^="${prefix}-"]`
  const addLine = async (name) => {
    await clickText('افزودن کالا')
    await settle(400)
    await dialogClick(name)
    await settle(400)
  }

  if (theme === 'light') {
    await go('#/more/settings')
    await clickText('روشن')
    await settle()
  }

  // یادآوری روی خانه وقتی پشتیبان نداریم
  await go('#/')
  check(t('home shows backup reminder when never backed up'), (await body()).includes('نسخه پشتیبان'))
  await shot('home-backup-reminder')

  // کالا + خرید برای داده واقعی
  await go('#/products/new')
  await fill('#f-name', 'هدفون پشتیبان')
  await fill('#f-code', 'B-1')
  await selectByText('#f-unitId', 'عدد')
  await clickText('ثبت کالا')
  await waitText('ثبت شد.')
  await go('#/purchases/new')
  await addLine('هدفون پشتیبان')
  await page.type(lineSel('هدفون پشتیبان', 'p'), '50000')
  await page.click(`[data-line="هدفون پشتیبان"] button[aria-label="زیاد کردن"]`)
  await clickText('ثبت خرید')
  await waitText('فاکتور خرید')

  // صفحه پشتیبان
  await go('#/more/backup')
  check(t('backup page open'), (await body()).includes('دریافت نسخه پشتیبان') && (await body()).includes('بازیابی'))
  await shot('backup-page')

  // دانلود پشتیبان (وب)
  const client = await page.createCDPSession()
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: TMP })
  await clickText('دریافت نسخه پشتیبان')
  await settle(1200)
  check(t('backup toast after download'), await waitText('فایل پشتیبان دانلود شد'))
  // پیدا کردن فایل
  let backupFile = null
  for (let i = 0; i < 20 && !backupFile; i++) {
    const files = fs.readdirSync(TMP).filter((f) => f.startsWith('anbardar-backup-') && f.endsWith('.json'))
    if (files.length) backupFile = path.join(TMP, files.sort().at(-1))
    else await new Promise((r) => setTimeout(r, 200))
  }
  check(t('backup file written'), !!backupFile, backupFile ?? 'none')
  const dump = backupFile ? JSON.parse(fs.readFileSync(backupFile, 'utf8')) : null
  check(t('backup file is anbardar-dump with products'), dump?.format === 'anbardar-dump' && Array.isArray(dump?.tables?.products) && dump.tables.products.some((r) => String(r.name).includes('هدفون')), dump?.format)

  await go('#/')
  check(t('home reminder gone after fresh backup'), !(await body()).includes('نسخه پشتیبان بگیرید'))

  // سلامت
  await go('#/more/backup')
  await clickText('بررسی سلامت')
  await settle(500)
  check(t('health check passes'), (await body()).includes('همه‌چیز سالم است'))
  await shot('backup-health')

  // بازیابی: اول یک کالای جدید اضافه کن، بعد restore کن تا برگردد
  await go('#/products/new')
  await fill('#f-name', 'کالای موقت')
  await fill('#f-code', 'TMP-9')
  await clickText('ثبت کالا')
  await waitText('ثبت شد.')
  await go('#/products')
  check(t('temp product exists before restore'), (await body()).includes('کالای موقت'))

  await go('#/more/backup')
  const input = await page.$('input[type=file]')
  await input.uploadFile(backupFile)
  await settle(500)
  check(t('restore confirm warns'), (await page.evaluate(() => document.querySelector('[role=dialog]')?.innerText ?? '')).includes('بازیابی'))
  await shot('restore-confirm')
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => null),
    dialogClick('بله، بازیابی شود'),
  ])
  await settle(1500)
  await go('#/products')
  const after = await body()
  check(t('after restore: backup product remains, temp product gone'), after.includes('هدفون پشتیبان') && !after.includes('کالای موقت'), after)
  await shot('after-restore')

  // فایل خراب
  const bad = path.join(TMP, 'bad-backup.json')
  fs.writeFileSync(bad, '{"format":"nope"}')
  await go('#/more/backup')
  await (await page.$('input[type=file]')).uploadFile(bad)
  await settle(400)
  await dialogClick('بله، بازیابی شود')
  await settle(800)
  check(t('bad file rejected with Persian message'), (await body()).includes('انباردار نیست') || (await body()).includes('معتبر نیست'), await body())
  await shot('restore-invalid')

  await context.close()
}

try {
  await run('dark')
  await run('light')
} finally {
  await browser.close()
}
console.log(results.join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL')).length
console.log(`\n${results.length - fails}/${results.length} checks passed`)
const real = [...new Set(problems)].filter((p) => !p.includes('favicon.ico'))
console.log(real.length ? `PROBLEMS (${real.length}):\n` + real.join('\n') : 'No console errors / failed requests')
process.exit(fails || real.length ? 1 : 0)
