import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-gpu']})
const sizes=[[360,640],[412,915],[800,1280],[1280,800]]
for (const [w,h] of sizes) for (const inset of [0,1]) {
  const ctx=await b.createBrowserContext(); const p=await ctx.newPage()
  await p.setViewport({width:w,height:h,isMobile:w<1000,hasTouch:true})
  await p.goto('http://localhost:4173/',{waitUntil:'networkidle0'})
  if (inset) await p.evaluate(()=>{const s=document.documentElement.style;s.setProperty('--safe-area-inset-top','24px');s.setProperty('--safe-area-inset-bottom','48px')})
  await new Promise(r=>setTimeout(r,1500))
  const m=await p.evaluate(()=>{const n=document.querySelector('nav')||document.querySelector('[class*="root"]');const r=document.querySelector('[class*="_app_"]')?.getBoundingClientRect();const nr=[...document.querySelectorAll('[class*="BottomNav"],nav,[class*="_root_z9"]')].map(e=>e.getBoundingClientRect()).pop();return {app:r&&[r.top,r.bottom,r.width],nav:nr&&[nr.top,nr.bottom],vh:innerHeight}})
  console.log(w,h,inset,JSON.stringify(m))
  await p.screenshot({path:`/workspace/anbardar-out/screens/${w}x${h}${inset?'-insets':''}.png`}); await ctx.close()
}
await b.close()
