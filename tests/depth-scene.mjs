import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
const root=resolve(import.meta.dirname,'..'),dist=resolve(root,'dist'),artifacts=resolve(root,'artifacts');
const server=createServer(async(request,response)=>{
  try{const path=new URL(request.url,'http://localhost').pathname,file=resolve(dist,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(dist+sep)){response.writeHead(403).end();return;}response.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.woff2':'font/woff2'}[extname(file)]||'application/octet-stream'));response.end(await readFile(file));}catch{response.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));await mkdir(artifacts,{recursive:true});
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],external=[],checks={};
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'no-preference'}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith(base)&&!request.url().startsWith('data:'))external.push(request.url());});
  await page.goto(base);await page.locator('#app[data-ready=true]').waitFor();await page.locator('.depth-scene[data-renderer=WebGL]').waitFor();await page.locator('#diagram[data-building=false]').waitFor();
  assert.equal(await page.locator('#depth-canvas').evaluate(canvas=>canvas.getContext('webgl').getError()),0,'Actual 3D shader draws without GL errors');
  const clip={x:300,y:50,width:900,height:185},first=await page.screenshot({clip});
  const before=await page.locator('#depth-canvas').evaluate(canvas=>Number(canvas.dataset.draws));await page.waitForTimeout(900);
  const after=await page.locator('#depth-canvas').evaluate(canvas=>Number(canvas.dataset.draws));const second=await page.screenshot({clip});
  assert.ok(after>before&&after-before<=45,'The scene moves with a bounded frame rate');assert.notEqual(hash(first),hash(second),'Visible glass geometry moves across the floating lettering');checks.floatingFrames=after-before;
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(500);const still=await page.locator('#depth-canvas').evaluate(canvas=>Number(canvas.dataset.draws));await page.waitForTimeout(500);assert.equal(await page.locator('#depth-canvas').evaluate(canvas=>Number(canvas.dataset.draws)),still,'Reduced motion stops scene drawing');checks.reducedMotion='No idle scene redraws';
  await page.screenshot({path:resolve(artifacts,'depth-light.png')});
  const pane=await page.locator('#sheet').boundingBox(),inside={x:pane.x+8,y:pane.y+8,width:pane.width-16,height:pane.height-16};
  const glass=await page.locator('#sheet').evaluate(element=>{const matched=[];function walk(rules){for(const rule of rules){if(rule.type===CSSRule.MEDIA_RULE){if(matchMedia(rule.conditionText).matches)walk(rule.cssRules);}else if(rule.cssRules)walk(rule.cssRules);else if(rule.selectorText&&element.matches(rule.selectorText)&&rule.style.getPropertyValue('backdrop-filter'))matched.push({selector:rule.selectorText,filter:rule.style.getPropertyValue('backdrop-filter')});}}for(const sheet of document.styleSheets)walk(sheet.cssRules);return{background:getComputedStyle(element).backgroundColor,backdrop:getComputedStyle(element).backdropFilter,filter:getComputedStyle(element).filter,root:{...document.documentElement.dataset},classes:document.documentElement.className,matched};});console.log(JSON.stringify(glass));assert.match(glass.background,/0\.8\)/);assert.match(glass.backdrop,/blur\(24px\)/);assert.equal(glass.filter,'none','Foreground text remains crisp');
  const withScene=await page.screenshot({clip:inside});await page.locator('.depth-scene').evaluate(element=>element.style.visibility='hidden');const withoutScene=await page.screenshot({clip:inside});assert.notEqual(hash(withScene),hash(withoutScene),'Background light and geometry transmit through the frosted foreground');await page.locator('.depth-scene').evaluate(element=>element.style.visibility='');checks.glass=glass;
  await page.locator('#theme-toggle').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await page.screenshot({path:resolve(artifacts,'depth-dark.png')});
  await page.locator('[data-route=settings]').click();await page.locator('#solid-panels').check();await page.locator('#close-drawer').click();
  assert.equal(await page.locator('#sheet').evaluate(element=>getComputedStyle(element).backdropFilter),'none');const solid=await page.screenshot({clip:inside});await page.locator('.depth-scene').evaluate(element=>element.style.visibility='hidden');assert.equal(hash(solid),hash(await page.screenshot({clip:inside})),'Solid panels fully isolate the foreground');await page.locator('.depth-scene').evaluate(element=>element.style.visibility='');checks.solidPanels='Opaque with no backdrop blur';
  await page.locator('[data-route=settings]').click();await page.locator('#solid-panels').uncheck();await page.locator('#close-drawer').click();
  await page.locator('[data-route=editor]').click();assert.equal(await page.locator('.graph-stage').evaluate(element=>getComputedStyle(element).backgroundColor),'rgba(0, 0, 0, 0)');await page.screenshot({path:resolve(artifacts,'depth-editor.png')});
  await page.locator('[data-route=bench]').click();await page.locator('#depth-canvas').evaluate(canvas=>{window.__depthLoss=canvas.getContext('webgl').getExtension('WEBGL_lose_context');window.__depthLoss.loseContext();});
  await page.locator('.depth-scene[data-renderer=Static]').waitFor();assert.equal(await page.locator('.depth-fallback').isVisible(),true);await page.locator('#step').click();assert.equal(await page.locator('#progress').inputValue(),'1','Simulation remains usable after GPU context loss');
  await page.evaluate(()=>window.__depthLoss.restoreContext());await page.locator('.depth-scene[data-renderer=WebGL]').waitFor();await page.waitForTimeout(200);assert.equal(await page.locator('#depth-canvas').evaluate(canvas=>canvas.getContext('webgl').getError()),0);checks.contextRecovery='Fallback, working simulation and restored 3D rendering';
  await page.setViewportSize({width:3440,height:1440});await page.waitForTimeout(200);const pixels=await page.locator('#depth-canvas').evaluate(canvas=>canvas.width*canvas.height);assert.ok(pixels<=1_600_000,'Backing storage stays bounded on ultrawide screens');checks.ultrawidePixels=pixels;
  await page.setViewportSize({width:360,height:844});await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Depth layers do not create horizontal scrolling');await page.screenshot({path:resolve(artifacts,'depth-mobile.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();
  await writeFile(resolve(artifacts,'depth-scene-report.json'),JSON.stringify({checks,errors,external},null,2));console.log(JSON.stringify({checks,errors,external},null,2));
}finally{await browser.close();await new Promise(done=>server.close(done));}
