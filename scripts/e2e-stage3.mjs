// تست End-to-End مرحله ۳ (اعلان‌ها، پشتیبان هنگام خروج، هشدار اولین اجرا، ثبت یک‌باره، چاپ/PDF، راهنما) در هر دو تم
import puppeteer from 'puppeteer-core'
import { setupDevice } from './lib/device.mjs'
import { pick, pickAdd, pickedText, pickerOptions } from './lib/picker.mjs'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173/'
const OUT = new URL('../screenshots/', import.meta.url).pathname
const problems = []
const results = []
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + extra}`)

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})

async function run(theme) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await setupDevice(page)
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`[${theme}] console.${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`))
  page.on('requestfailed', (r) => problems.push(`[${theme}] requestfailed: ${r.url()}`))
  page.on('response', (r) => r.status() >= 400 && problems.push(`[${theme}] http ${r.status()}: ${r.url()}`))
  await page.evaluateOnNewDocument((t) => {
    if (!localStorage.getItem('anbardar.theme.v1')) localStorage.setItem('anbardar.theme.v1', t)
  }, theme)

  const t = (name) => `[${theme}] ${name}`
  const shot = (name) => page.screenshot({ path: `${OUT}stage3-${name}-${theme}.png` })
  const settle = (ms = 350) => page.evaluate((m) => document.fonts.ready.then(() => new Promise((r) => setTimeout(r, m))), ms)
  const body = () => page.evaluate(() => document.body.innerText)
  const go = async (hash) => {
    await page.goto(BASE + hash, { waitUntil: 'networkidle0' })
    await settle()
  }
  const clickText = async (text, tag = 'button') => {
    const [el] = await page.$$(`xpath/.//${tag}[contains(normalize-space(.), "${text}")] | .//a[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('not found: ' + text)
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }))
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
  const selectByText = (sel, text) => (text.startsWith('＋') ? pickAdd(page, sel) : pick(page, sel, text))
  const dialogClick = async (text) => {
    const [el] = await page.$$(`xpath/.//*[@role="dialog"]//button[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('dialog button not found: ' + text)
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }))
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
  // دکمه‌های پایین فرم ممکن است زیر نوار ثابت «ثبت» باشند؛ کلیک مستقیم DOM
  const domClick = async (text) => {
    const [el] = await page.$$(`xpath/.//button[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('not found: ' + text)
    await el.evaluate((e) => (e.scrollIntoView({ block: 'center' }), e.click()))
    await settle()
  }
  const sheetText = () => page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n'))
  const sfx = theme === 'dark' ? '' : ' روشن'


  const badge = () => page.$eval('[data-testid="notification-badge"]', (e) => e.textContent).catch(() => null)
  const back = async () => (await page.evaluate(() => window.dispatchEvent(new Event('anbardar:back'))), settle(450))
  const item = 'دوغ' + sfx

  // ---- ۱) اولین اجرا: هشدار پشتیبان به‌صورت بنر شناور (بدون جابه‌جایی محتوا)
  const banner = (id) => page.$(`[data-testid="floating-banner"][data-id="${id}"]`)
  const topOf = () => page.$eval('a[href="#/sales/new"]', (e) => e.getBoundingClientRect().top + window.scrollY)
  const docH = () => page.evaluate(() => document.documentElement.scrollHeight)
  await go('#/')
  const intro = await banner('backup:intro')
  check(t('first-run backup warning is a floating banner with its action'), !!intro && (await intro.evaluate((e) => e.innerText)).includes('تنظیم پشتیبان'))
  check(t('banner overlays (position fixed)'), (await page.$eval('[data-testid="floating-banners"]', (e) => getComputedStyle(e).position)) === 'fixed')
  check(t('bell next to the lamp'), !!(await page.$('[data-testid="notification-bell"]')) && !!(await page.$('[aria-label*="تم"], [data-lit]')))
  await shot('home-first-run')
  const t1 = await topOf()
  const h1 = await docH()
  await page.click('[data-testid="floating-banner"][data-id="backup:intro"] [data-testid="banner-close"]')
  await settle(400)
  const t2 = await topOf()
  const h2 = await docH()
  check(t('no layout shift: Home content top unchanged with banner visible'), t1 === t2 && h1 === h2, `${t1}/${t2} ${h1}/${h2}`)
  check(t('X closes the banner'), !(await banner('backup:intro')))
  check(t('dismissed banner stays in the bell (badge ۱)'), (await badge()) === '۱', String(await badge()))
  await page.click('[data-testid="notification-bell"]')
  await settle()
  check(t('dismissed item listed in the notification center'), (await body()).includes('اطلاعات فقط روی همین گوشی است'))
  await page.click('[data-testid="help-tip"]')
  await settle(300)
  check(t('help tip opens a sheet'), (await sheetText()).includes('اعلان‌ها هر بار از روی داده‌ها'))
  await back()
  await go('#/')
  check(t('once only: banner not shown again on the next Home visit'), !(await banner('backup:intro')))
  await page.reload({ waitUntil: 'networkidle0' })
  await settle()
  check(t('once only: not shown again after reload'), !(await page.$('[data-testid="floating-banner"]')))
  // بعد از اولین پشتیبان، هشدار از زنگ هم حذف می‌شود → حالت خالی
  await go('#/more/backup')
  await clickText('پشتیبان')
  await settle(800)
  await go('#/notifications')
  check(t('empty state after first backup'), !!(await page.$('[data-testid="notifications-empty"]')))
  await shot('notifications-empty')

  // ---- ۲) داده واقعی: کالای کم‌موجودی + چک سررسید امروز
  await go('#/products/new')
  await fill('#f-name', item)
  await fill('#f-reorderPoint', '5')
  await clickText('ثبت کالا')
  check(t('product saved'), await waitText('ثبت شد.'))
  await go('#/')
  check(t('out-of-stock (reorder point set) raises the badge'), (await badge()) === '۱', String(await badge()))
  const outId = await page.$eval('[data-testid="floating-banner"]', (e) => e.dataset.id).catch(() => null)
  check(t('new item appears as a banner'), !!outId && outId.endsWith(':out'), String(outId))
  // کشیدن به کنار = بستن
  const box = await (await page.$('[data-testid="floating-banner"]')).boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 - i * 20, box.y + box.height / 2)
  await page.mouse.up()
  await settle(500)
  check(t('swipe dismisses the banner'), !(await page.$('[data-testid="floating-banner"]')))
  check(t('swiped item still in the bell'), (await badge()) === '۱')
  // خرید ۳ عدد (زیر نقطه سفارش) با دوبار کلیک هم‌زمان روی «ثبت خرید»
  await go('#/purchases/new')
  await addLine(item)
  await fill(`[data-line="${item}"] input[id^="q-"]`, '3')
  await fill(`[data-line="${item}"] input[id^="p-"]`, '10000')
  await settle(250)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button[type="submit"]')].find((e) => e.textContent.includes('ثبت خرید'))
    b.click()
    b.click()
    b.click()
  })
  check(t('purchase saved'), await waitText('ثبت شد'))
  await settle(600)
  const detailUrl = await page.evaluate(() => location.hash)
  await go('#/purchases')
  const rows = await page.$$eval('a[href^="#/purchases/"]', (as) => as.filter((a) => /#\/purchases\/[^/]+$/.test(a.getAttribute('href')) && !a.getAttribute('href').endsWith('/new')).length)
  check(t('triple-tap submit created exactly one purchase'), rows === 1, String(rows))
  await go('#/more/parties')
  await page.click('button[aria-label="طرف حساب جدید"]')
  await settle(300)
  await page.type('#party-name', 'مشتری اعلان' + sfx)
  await page.type('#party-opening', '50000')
  await dialogClick('افزودن طرف حساب')
  await settle(400)
  await go('#/money/new?kind=receipt')
  await pick(page, '#money-party', 'مشتری اعلان' + sfx)
  await fill('#money-amount', '50000')
  await pick(page, '#money-method', 'چک')
  await page.type('#cheque-no', '445566')
  await pick(page, '#cheque-bank', 'ملت')
  await clickText('ثبت دریافت')
  check(t('cheque receipt saved'), await waitText('دریافت ثبت شد'))

  await go('#/')
  check(t('new cheque + low-stock items show as ≤2 stacked banners'), (await page.$$('[data-testid="floating-banner"]')).length === 2)
  await shot('home-banners')
  check(t('badge counts cheque + low stock (۲)'), (await badge()) === '۲', String(await badge()))
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${OUT}stage3-bell-${theme}.png`, clip: { x: 0, y: 0, width: page.viewport().width, height: 160 } })
  await shot('home-bell')
  await go('#/stock')
  check(t('bell on root tabs too'), !!(await page.$('[data-testid="notification-bell"]')))
  await page.click('[data-testid="notification-bell"]')
  await settle()
  const panel = await body()
  check(t('panel lists cheque due today'), panel.includes('سررسید چک امروز است') && panel.includes('۴۴۵۵۶۶'), panel)
  check(t('panel lists low stock'), panel.includes(`«${item}» کم شده است`), panel)
  check(t('stale out-of-stock item was replaced (dedupe)'), !panel.includes(`«${item}» تمام شد`))
  check(t('two items'), (await page.$$('[data-testid="notification-item"]')).length === 2)
  await shot('notifications-panel')
  await page.click('[data-testid="notification-mark-read"]')
  await settle(400)
  check(t('mark read: one unread left'), (await page.$$('[data-testid="notification-item"][data-read="false"]')).length === 1)
  // لمس اعلان کالا → صفحه موجودی با فیلتر کم‌موجودی
  const [stockItem] = await page.$$(`xpath/.//li[@data-testid="notification-item"][contains(., "کم شده")]//button[1]`)
  await stockItem.click()
  await settle(500)
  check(t('tap opens the related page (/stock?f=low)'), (await page.evaluate(() => location.hash)).startsWith('#/stock?f=low'))
  await go('#/notifications')
  check(t('read items persist'), (await page.$$('[data-testid="notification-item"][data-read="true"]')).length === 2)
  await page.reload({ waitUntil: 'networkidle0' })
  await settle()
  check(t('read state survives reload, badge hidden'), (await badge()) === null)
  await go('#/notifications')
  check(t('mark-all disabled when all read'), await page.$eval('[data-testid="notifications-read-all"]', (e) => e.disabled))

  // ---- ۳) چاپ و PDF
  await go(detailUrl)
  await clickText('چاپ / PDF فاکتور', 'a')
  await settle(500)
  const paper = await page.$eval('[data-testid="invoice-print-paper"]', (e) => e.innerText).catch(() => '')
  check(t('print layout shows items and total'), paper.includes(item) && paper.includes('مبلغ قابل پرداخت') && paper.includes('۳۰,۰۰۰'), paper)
  await shot('invoice-print')
  const dl = `/tmp/stage3-dl-${theme}`
  const cdp = await browser.target().createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, browserContextId: context.id })
  const fs = await import('node:fs')
  fs.rmSync(dl, { recursive: true, force: true })
  await page.click('[data-testid="invoice-pdf"]')
  let pdf = null
  for (let i = 0; i < 60 && !pdf; i++) {
    await new Promise((r) => setTimeout(r, 200))
    const f = fs.existsSync(dl) ? fs.readdirSync(dl).find((n) => n.endsWith('.pdf')) : null
    if (f) pdf = fs.readFileSync(`${dl}/${f}`)
  }
  check(t('PDF downloaded and valid'), !!pdf && pdf.subarray(0, 8).toString() === '%PDF-1.4' && pdf.length > 20000, String(pdf?.length))
  if (pdf) fs.copyFileSync(`${dl}/${fs.readdirSync(dl).find((n) => n.endsWith('.pdf'))}`, `${OUT}stage3-invoice-${theme}.pdf`)

  // ---- ۴) خروج: پیشنهاد پشتیبان وقتی داده تغییر کرده
  await go('#/')
  await page.evaluate(() => {
    window.__exited = 0
    window.addEventListener('anbardar:exit', () => window.__exited++)
  })
  await back()
  await back()
  await settle(300)
  check(t('exit prompt appears when data changed'), !!(await page.$('[data-testid="exit-backup-sheet"]')))
  await shot('exit-prompt')
  check(t('prompt blocks exit until chosen'), (await page.evaluate(() => window.__exited)) === 0)
  await page.click('[data-testid="exit-stay"]')
  await settle(300)
  check(t('stay keeps the app open'), (await page.evaluate(() => window.__exited)) === 0)
  await back()
  await back()
  await settle(300)
  await page.click('[data-testid="exit-backup"]')
  for (let i = 0; i < 30 && (await page.evaluate(() => window.__exited)) === 0; i++) await settle(200)
  check(t('backup & exit exits after backup'), (await page.evaluate(() => window.__exited)) === 1)
  await go('#/')
  await page.evaluate(() => {
    window.__exited = 0
    window.addEventListener('anbardar:exit', () => window.__exited++)
  })
  await back()
  await back()
  await settle(300)
  const sheetOpen = !!(await page.$('[data-testid="exit-backup-sheet"]'))
  check(t('no prompt right after a backup'), !sheetOpen && (await page.evaluate(() => window.__exited)) >= 1, `sheet=${sheetOpen} exited=${await page.evaluate(() => window.__exited)} toast=${(await body()).slice(0, 300)}`)

  await context.close()
}

await run('dark')
await run('light')
await browser.close()

const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(results.join('\n'))
if (problems.length) {
  console.log('\nProblems:')
  console.log([...new Set(problems)].join('\n'))
}
console.log(`\n${results.length - fails.length}/${results.length} passed`)
if (fails.length || problems.length) process.exit(1)
