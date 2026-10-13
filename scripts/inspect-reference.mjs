import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve(import.meta.dirname, '../artifacts/reference/weevolveit');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const sample = () => page.evaluate(() => {
  const properties = ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'borderRadius', 'borderColor', 'padding', 'transform', 'opacity', 'transition', 'animation'];
  const describe = element => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    const descendants=[...element.querySelectorAll('span')].slice(0,4).map(child=>{const css=getComputedStyle(child);return{class:String(child.className),transform:css.transform,opacity:css.opacity,transition:css.transition,width:css.width,height:css.height};});
    return { tag: element.tagName, class: String(element.className).slice(0, 180), text: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 100), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, styles: Object.fromEntries(properties.map(key => [key, style[key]])),descendants };
  };
  const colors = {};
  for (const element of [...document.querySelectorAll('body *')].slice(0, 3000)) {
    const style = getComputedStyle(element);
    for (const key of ['color', 'backgroundColor']) if (style[key] !== 'rgba(0, 0, 0, 0)') colors[style[key]] = (colors[style[key]] || 0) + 1;
  }
  return { scrollY, title: document.title, body: describe(document.body), headings: [...document.querySelectorAll('h1,h2,h3')].slice(0, 25).map(describe), controls: [...document.querySelectorAll('nav a,button,a[class]')].filter(element => { const r=element.getBoundingClientRect();return r.width && r.height && r.top < innerHeight && r.bottom > 0; }).slice(0, 24).map(describe), colors: Object.entries(colors).sort((a,b)=>b[1]-a[1]).slice(0, 20), animations: document.getAnimations().slice(0, 20).map(animation=>({ state: animation.playState, timing: animation.effect?.getTiming(), keyframes: animation.effect?.getKeyframes().slice(0,4) })), scripts: [...document.scripts].map(script=>script.src).filter(Boolean) };
});
try {
  await page.goto('https://weevolveit.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const initial = await sample();
  await page.waitForTimeout(10000);
  await page.waitForFunction(()=>{const title=document.querySelector('h1');return title && Number(getComputedStyle(title).opacity)>.98;},{},{timeout:25000});
  const reject = page.getByRole('button', {name:'Reject',exact:true});
  if(await reject.isVisible())await reject.click();
  await page.waitForTimeout(700);
  const settled = await sample();
  await page.screenshot({ path: resolve(directory, 'desktop-hero.png') });
  const contact = page.locator('a').filter({ hasText: /^method$/i }).first();
  let hover = null;
  if (await contact.isVisible()) { await contact.hover(); await page.waitForTimeout(240); hover = await sample(); await page.screenshot({ path: resolve(directory, 'desktop-hover.png') }); }
  await page.evaluate(()=>scrollTo(0,900));
  const scrollInitial = await sample();
  await page.waitForTimeout(750);
  const scrollSettled = await sample();
  await page.screenshot({ path: resolve(directory, 'desktop-scroll.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(()=>scrollTo(0,0));
  await page.waitForTimeout(900);
  const mobile = await sample();
  await page.screenshot({ path: resolve(directory, 'mobile-hero.png') });
  await writeFile(resolve(directory, 'observations.json'), JSON.stringify({ source: 'https://weevolveit.com/', capturedAt: new Date().toISOString(), method: 'Existing Playwright browser; reference adaptation, not the unavailable ui_clone pipeline', initial, settled, hover, scrollInitial, scrollSettled, mobile, errors }, null, 2));
  console.log(JSON.stringify({directory,colors:settled.colors,hero:settled.headings.slice(0,3),controls:settled.controls.slice(0,3),errors},null,2));
} finally { await browser.close(); }
