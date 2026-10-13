import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root=resolve(import.meta.dirname,'..'),dist=resolve(root,'dist');
const server=createServer(async(req,res)=>{
  try{const requested=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=resolve(dist,'.'+(requested==='/'?'/index.html':requested));if(!file.startsWith(dist+sep)){res.writeHead(403).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'}[extname(file)]||'application/octet-stream'));res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const page=await context.newPage();
const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))external.push(r.url());});
const artifacts=resolve(root,'artifacts');await mkdir(artifacts,{recursive:true});
async function navigationReady(){await page.waitForFunction(()=>document.querySelector('#app').dataset.navigating!=='true');}
async function closeDrawer(){if(await page.locator('#drawer').evaluate(el=>el.open)){await page.locator('#close-drawer').click();await navigationReady();}}
async function trace(){await closeDrawer();await page.locator('[data-route="trace"]').click();}
async function end(){await closeDrawer();await page.locator('#progress').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}));});}
async function preset(id){await closeDrawer();await page.locator('[data-route="machines"]').click();await page.locator(`.preset-row[data-preset="${id}"]`).click();await navigationReady();}
async function diagramReady(){await navigationReady();await page.locator('#diagram[data-building="false"]').waitFor();await page.waitForTimeout(750);}
async function inkHash(){return createHash('sha256').update(await page.locator('.diagram-ink').evaluate(canvas=>canvas.toDataURL())).digest('hex');}
try{
  await page.goto(base+'/?debug');await page.locator('#app[data-ready="true"]').waitFor();
  const theme=await page.evaluate(()=>{const css=getComputedStyle(document.documentElement);return{background:css.getPropertyValue('--mask').trim(),brand:css.getPropertyValue('--brand').trim(),accent:css.getPropertyValue('--copper').trim(),animation:getComputedStyle(document.querySelector('#view-bench')).animationName};});
  assert.deepEqual(theme,{background:'#f4f4f4',brand:'#161616',accent:'#161616',animation:'none'},'Monochrome palette and reduced-motion view fallback');
  assert.equal(await page.locator('.diagram-node').count(),2);
  assert.equal(await page.locator('.diagram-edge-label').count(),4);
  await page.screenshot({path:resolve(artifacts,'patchbay-desktop.png')});
  const cases=[['mealy-11-detector','0100'],['moore-11-detector','00100'],['ones-complement','01001'],['twos-complement','0010'],['parity','01001'],['mod3-remainder','0100'],['decimal-echo','290846'],['mealy-101-detector','00101'],['binary-full-adder','0001'],['turnstile','alarm unlock open unlock refund open'],['vending-machine','wait vend wait vend+5']];
  for(const [id,expected] of cases){await preset(id);await end();await trace();assert.equal(await page.locator('#summary-output').textContent(),expected,`${id} output`);}
  await preset('binary-full-adder');await page.locator('#input').fill('11 22');await page.locator('.load-button').click();assert.equal(await page.locator('#play').isDisabled(),true);assert.match(await page.locator('#input-error').textContent(),/position 2/);
  await preset('binary-full-adder');await page.locator('#mode-moore').click();await end();await trace();assert.equal(await page.locator('#summary-output').textContent(),'00001','Type switch converts the current multi-variable machine');await closeDrawer();await page.locator('#mode-mealy').click();await end();await trace();assert.equal(await page.locator('#summary-output').textContent(),'0001');
  await closeDrawer();await page.locator('#text-shortcut').click();
  const manual='type mealy\nstart Mine\nalphabet a\nMine a Mine word\n';
  await page.locator('#source').fill(manual);await closeDrawer();await page.locator('#text-shortcut').click();assert.equal(await page.locator('#source').inputValue(),manual,'Closing before debounce keeps a valid manual edit');assert.equal(await page.locator('#active-state').textContent(),'Mine');
  const unfinished='type mealy\nstart Unfinished\n';await page.locator('#source').fill(unfinished);await closeDrawer();await page.reload();await page.locator('#app[data-ready="true"]').waitFor();await page.locator('#text-shortcut').click();assert.equal(await page.locator('#source').inputValue(),unfinished,'An unfinished manual draft survives close and restart');assert.equal(await page.locator('#active-state').textContent(),'Mine','Unfinished text retains the last runnable machine');
  await page.locator('#source').fill('type moore\nstart Initial\nalphabet a\nout Initial ready\nout A 0\nInitial a A\nA a A\n');await page.locator('#apply').click();await page.locator('#input').fill('aa');await page.locator('.load-button').click();await end();await trace();assert.equal(await page.locator('#summary-output').textContent(),'ready 0 0','Initial word output keeps token boundaries');
  await closeDrawer();await page.locator('[data-route="settings"]').click();await page.locator('#moore-initial').uncheck();await end();await trace();assert.equal(await page.locator('#summary-output').textContent(),'00','Omitting the initial word retains compact binary output');await closeDrawer();await page.locator('[data-route="settings"]').click();await page.locator('#moore-initial').check();await closeDrawer();
  await preset('mealy-11-detector');await page.locator('#input').fill('1102');await page.locator('.load-button').click();assert.equal(await page.locator('#play').isDisabled(),true);assert.match(await page.locator('#input-error').textContent(),/position 4/);
  await page.locator('#input').fill('');await page.locator('.load-button').click();assert.equal(await page.locator('#play').isDisabled(),true);
  await page.locator('#input').fill('1101');await page.locator('.load-button').click();
  await page.locator('#speed').selectOption('4');await page.locator('#play').click();await page.waitForFunction(()=>document.querySelector('#progress').value==='4');await trace();assert.equal(await page.locator('#summary-output').textContent(),'0100');
  await page.locator('[aria-label="Seek to step 2"]').click();assert.equal(await page.locator('#summary-output').textContent(),'01');
  await closeDrawer();await page.locator('#back').click();assert.equal(await page.locator('#progress').inputValue(),'1');await page.locator('#reset').click();assert.equal(await page.locator('#progress').inputValue(),'0');
  await trace();await page.locator('#trace-play').click();await page.waitForFunction(()=>document.querySelector('#progress').value==='4');assert.equal(await page.locator('#summary-output').textContent(),'0100');await page.locator('#trace-reset').click();assert.equal(await page.locator('#progress').inputValue(),'0');await closeDrawer();
  await page.locator('#text-shortcut').click();await page.locator('#source').fill('type moore\nstart A\nA 0 A');await page.locator('#apply').click();assert.match(await page.locator('#editor-errors').textContent(),/Line/);assert.equal(await page.locator('#state-count').textContent(),'2');
  await page.locator('#source').fill('type mealy\nstart X\nX 0 X 1\nX 1 Y 0\nY 0 X 1\nY 1 Y 0');await page.locator('#apply').click();assert.equal(await page.locator('#active-state').textContent(),'X');await end();await trace();assert.equal(await page.locator('#summary-output').textContent(),'0010');
  await preset('moore-11-detector');await page.locator('[data-route="settings"]').click();await page.locator('#moore-initial').uncheck();await end();await trace();assert.equal(await page.locator('#summary-output').textContent(),'0100');
  await closeDrawer();await page.locator('[data-route="settings"]').click();await page.locator('#moore-initial').check();await closeDrawer();await end();await page.locator('#convert').click();await end();await trace();assert.equal(await page.locator('#summary-output').textContent(),'0100');
  await closeDrawer();await page.locator('#convert').click();await page.locator('[data-route="settings"]').click();await page.locator('#moore-initial').uncheck();await end();await trace();assert.equal(await page.locator('#summary-output').textContent(),'0100');
  await preset('moore-11-detector');await page.screenshot({path:resolve(artifacts,'patchbay-moore.png')});
  await page.locator('[data-route="settings"]').click();await page.locator('#solid-panels').check();assert.equal(await page.locator('html').getAttribute('data-glass'),'solid');await page.locator('#high-contrast').check();assert.equal(await page.locator('html').evaluate(e=>e.classList.contains('high-contrast')),true);await closeDrawer();await page.screenshot({path:resolve(artifacts,'patchbay-solid.png')});
  await page.locator('[data-route="learn"]').click();assert.equal(await page.locator('#view-learn').isVisible(),true);await page.locator('[data-route="bench"]').click();
  await page.locator('[data-route="bench"]').focus();await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-route')),'machines');await page.keyboard.press('Enter');assert.equal(await page.locator('#view-machines').isVisible(),true);
  await page.locator('[data-route="bench"]').click();await page.locator('#focus').click();assert.equal(await page.locator('html').evaluate(e=>e.classList.contains('focus-mode')),true);await page.locator('#focus').click();
  await page.setViewportSize({width:360,height:800});await page.screenshot({path:resolve(artifacts,'patchbay-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal overflow at 360px');
  await page.setViewportSize({width:1440,height:1000});await preset('mealy-11-detector');await page.locator('[data-route="settings"]').click();await page.locator('#high-contrast').uncheck();await page.locator('#solid-panels').uncheck();await page.locator('#reduced-motion').uncheck();await page.locator('#quality').selectOption('high');await closeDrawer();await page.emulateMedia({reducedMotion:'no-preference'});
  // Compare settled canvas pixels with a fresh load of the same machine, so
  // preset navigation and a resize interrupting morph cannot leave stale ink.
  await diagramReady();await page.locator('[data-route="machines"]').click();await page.waitForTimeout(80);await page.locator('.preset-row[data-preset="moore-11-detector"]').click();await diagramReady();const switchedInk=await inkHash();
  await page.reload();await page.locator('#app[data-ready="true"]').waitFor();await diagramReady();assert.equal(switchedInk,await inkHash(),'Normal-motion preset switch must match fresh diagram geometry');
  await preset('mealy-11-detector');await diagramReady();await page.locator('[data-route="machines"]').click();await page.waitForTimeout(80);await page.locator('.preset-row[data-preset="moore-11-detector"]').evaluate(el=>el.click());await page.setViewportSize({width:1360,height:1000});await diagramReady();const resizedInk=await inkHash();
  await page.reload();await page.locator('#app[data-ready="true"]').waitFor();await diagramReady();assert.equal(resizedInk,await inkHash(),'Mid-morph resize must match fresh diagram geometry');
  await page.setViewportSize({width:1440,height:1000});await page.locator('#text-shortcut').click();await page.locator('#source').fill('type mealy\nstart A\nA 0 B 0\nA 1 C 1\nB 0 D 0\nB 1 E 1\nC 0 F 0\nC 1 G 1\nD 0 D 0\nD 1 D 1\nE 0 E 0\nE 1 E 1\nF 0 F 0\nF 1 F 1\nG 0 G 0\nG 1 G 1');await page.locator('#apply').click();await diagramReady();
  const circles=await page.locator('.diagram-node').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,r:r.width/2};}));assert.equal(circles.length,7);for(let i=0;i<circles.length;i++)for(let j=i+1;j<circles.length;j++)assert.ok(Math.hypot(circles[i].x-circles[j].x,circles[i].y-circles[j].y)>=circles[i].r+circles[j].r+19,'Branching state circles remain separated');
  assert.equal(await page.locator('#diagram').evaluate(el=>el.scrollHeight>el.clientHeight),true,'Large diagrams have a scrollable drawing area');await page.locator('.diagram-node').last().click();assert.match(await page.locator('#toast').textContent(),/State G/);
  await preset('mealy-11-detector');await diagramReady();
  await page.locator('#replay-build').click();await diagramReady();await page.evaluate(()=>{scrollTo(0,0);document.querySelector('#toast').hidden=true;document.querySelector('#debug').hidden=true;});await page.screenshot({path:resolve(artifacts,'patchbay-glass.png')});
  await page.waitForTimeout(4000);const metrics=await page.locator('#diagnostics').innerText();
  const before=await page.evaluate(()=>({nodes:document.querySelectorAll('.diagram-node').length,labels:document.querySelectorAll('.diagram-edge-label').length,heap:performance.memory?.usedJSHeapSize??0}));
  for(let i=0;i<100;i++)await page.locator('#replay-build').evaluate(el=>el.click());
  await diagramReady();const after=await page.evaluate(()=>({nodes:document.querySelectorAll('.diagram-node').length,labels:document.querySelectorAll('.diagram-edge-label').length,heap:performance.memory?.usedJSHeapSize??0}));assert.equal(after.nodes,before.nodes);assert.equal(after.labels,before.labels);
  await page.locator('[data-route="settings"]').click();await page.locator('#reduced-motion').check();await closeDrawer();await page.waitForTimeout(1500);const staticBefore=await page.locator('#metric-draws').textContent();await page.waitForTimeout(1200);const staticAfter=await page.locator('#metric-draws').textContent();assert.equal(staticAfter,staticBefore,'Static mode stops canvas redraws');
  await page.evaluate(()=>localStorage.setItem('patchbay:nav:v1','{invalid'));await page.reload();await page.locator('#app[data-ready="true"]').waitFor();assert.equal(await page.locator('#machine-title').textContent(),'11 detector');
  assert.deepEqual(errors,[],'No uncaught renderer errors');assert.deepEqual(external,[],'No external runtime requests');
  const names=await (await import('node:fs/promises')).readdir(resolve(dist,'assets'));
  const files=await Promise.all(names.map(async name=>({name,bytes:(await stat(resolve(dist,'assets',name))).size})));
  const report={passed:'Eleven presets including decimal, multi-variable and event inputs; token errors, word-output prefixes, mode conversion, immediate text close and unfinished draft recovery; playback, seeking, validation, accessibility, keyboard, 360px layout, normal-motion preset/resize geometry, branching state spacing/scrolling, replay stability, static rendering, storage recovery and offline requests',metrics,before,after,heapGrowth:after.heap-before.heap,errors,external,files};await writeFile(resolve(artifacts,'ui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
