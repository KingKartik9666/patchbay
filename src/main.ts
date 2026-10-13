import './style.css';
import './diagram/diagram.css';
import { parse } from './engine/parse';
import { checkInput, simulate, tokenizeInput, usesTokenInput } from './engine/simulate';
import { mooreToMealy, mealyToMoore } from './engine/convert';
import { serialize } from './engine/serialize';
import type { MachineDef } from './engine/types';
import { presets } from './presets';
import { Player } from './player';
import { Diagram } from './diagram/diagram';
import { GraphicalEditor } from './editor/editor';
import { UIMotion, type MotionOrigin } from './motion/ui-motion';
import { ThemeWave, type Theme } from './motion/theme-wave';
import { DepthScene } from './scene/depth-scene';
import type { Signals } from './signals';
import { icon } from './icons';
import { template, escapeHtml as escape } from './ui/template';
import { Ticker } from './ticker';
import './reference.css';
import './scene/depth-scene.css';

const $ = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
const MACHINE_FILE_BYTES=1024*1024;
const textEncoder=new TextEncoder();
const app=$('app'); app.innerHTML=template();
const drawer=$<HTMLDialogElement>('drawer');
const motionQuery=matchMedia('(prefers-reduced-motion: reduce)');
const contrastQuery=matchMedia('(prefers-contrast: more)');
const transparencyQuery=matchMedia('(prefers-reduced-transparency: reduce)');
const params=new URLSearchParams(location.search);
const signals:Signals={pointer:{x:0,y:0},energy:0,phase:'idle',quality:'medium',glass:'baked',refreshHz:60,reducedMotion:motionQuery.matches,focusMode:false,boardRate:120,glowPasses:3};
let highContrast=contrastQuery.matches,mooreInitial=true,solidPreference=transparencyQuery.matches;
let theme:Theme='light',motionBlur=true,navigationVersion=0;
let machine:MachineDef, source=presets[0].source,input=presets[0].input,outputSeparator='';
let invalidInput=false,graphInitialized=false,manualDraft:string|null=null,manualDirty=false;
let route='bench',toastTimer=0,editorTimer=0,traceStart=-1,traceVersion=0,renderedTraceVersion=-1;
let rendererErrors=0,buildWasActive=true,lastKick=-1;
const player=new Player();
const motion=new UIMotion({reduced:()=>signals.reducedMotion,blur:()=>motionBlur});
let motionOrigin:MotionOrigin=motion.origin();
const diagram=new Diagram($('diagram'));
const graph=new GraphicalEditor($('graph-editor'),{
  onApply(text){const parsed=parse(text).machine;const nextInput=parsed&&checkInput(parsed,input).length?parsed.alphabet.slice(0,8).join(usesTokenInput(parsed)?' ':''):input;const errors=loadMachine(text,nextInput,'custom',true,false);if(errors.length){toast(errors[0].msg);return;}navigate('bench');toast('Drawing applied. Ready to run.');},
  onText(){navigate('text',graph.getSource());},
  onMessage:toast
});
const traceControls=document.createElement('div');traceControls.className='trace-controls';traceControls.innerHTML=`<button id="trace-reset" class="icon-button" aria-label="Reset trace playback">${icon('reset')}</button><button id="trace-back" class="icon-button" aria-label="Previous trace step">${icon('back')}</button><button id="trace-play" class="play-button">${icon('play')}Play</button><button id="trace-step" class="icon-button" aria-label="Next trace step">${icon('step')}</button>`;$('panel-trace').appendChild(traceControls);
const scene=new DepthScene();
const wave=new ThemeWave({theme:()=>theme,reduced:()=>signals.reducedMotion,onCommit(next){
  const root=document.documentElement;root.classList.add('theme-committing');
  try{theme=next;syncPreferences();scene.refreshTheme(theme);diagram.refreshTheme();diagram.update(0,signals);graph.resize();graph.update(0,signals);void root.offsetWidth;persist();}
  finally{root.classList.remove('theme-committing');}
}});
const targetPointer={x:0,y:0};
let bounds={x:0,y:0,width:1,height:1};
const glyph=document.createElement('span');glyph.className='flying-glyph';glyph.setAttribute('aria-hidden','true');document.body.appendChild(glyph);
let glyphAnimation:Animation|null=null;

function toast(message:string){$('toast').textContent=message;$('toast').hidden=false;motion.enter($('toast'),{x:innerWidth/2,y:innerHeight,direction:'bottom'},'content');clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>$('toast').hidden=true,4500);}
function persist(){try{localStorage.setItem('patchbay:nav:v1',JSON.stringify({source,input,manualDraft,mooreInitial,theme,motionBlur,quality:signals.quality,glass:solidPreference?'solid':'baked',reducedMotion:signals.reducedMotion,focusMode:signals.focusMode,highContrast,route:['machines','learn'].includes(route)?route:'bench'}));}catch{/* Offline storage is optional. */}}
function outputSoFar(){return [...(player.trace.initialOut===undefined?[]:[player.trace.initialOut]),...player.trace.steps.slice(0,player.cursor).map(s=>s.out)].join(outputSeparator);}
function activeState(){return player.cursor?player.trace.steps[player.cursor-1].to:machine.start;}
function cancelFlight(){glyphAnimation?.cancel();glyphAnimation=null;glyph.style.opacity='0';}
function syncPreferences(){
  const root=document.documentElement;
  const forceSolid=highContrast||contrastQuery.matches||transparencyQuery.matches||!CSS.supports('backdrop-filter','blur(1px)');
  signals.glass=solidPreference||forceSolid?'solid':'baked';
  root.dataset.glass=signals.glass;root.dataset.quality=signals.quality;
  root.dataset.theme=theme;
  for(const id of ['theme-toggle','theme-setting']){$(id).setAttribute('aria-pressed',String(theme==='dark'));$(id).setAttribute('aria-label',`Switch to ${theme==='dark'?'light':'dark'} theme`);}
  $('theme-label').textContent=theme==='dark'?'Light theme':'Dark theme';
  $<HTMLInputElement>('motion-blur').checked=motionBlur;
  root.classList.toggle('reduced-motion',signals.reducedMotion);root.classList.toggle('high-contrast',highContrast||contrastQuery.matches);root.classList.toggle('focus-mode',signals.focusMode);
  $<HTMLInputElement>('solid-panels').checked=signals.glass==='solid';$<HTMLInputElement>('reduced-motion').checked=signals.reducedMotion;$<HTMLInputElement>('high-contrast').checked=highContrast||contrastQuery.matches;
  $<HTMLInputElement>('moore-initial').checked=mooreInitial;$<HTMLSelectElement>('quality').value=signals.quality;
  $('quality-button').textContent=`${signals.quality[0].toUpperCase()+signals.quality.slice(1)} quality`;
  $('focus').setAttribute('aria-pressed',String(signals.focusMode));
}
function setQuality(value:Signals['quality']){signals.quality=value;signals.boardRate=value==='high'?signals.refreshHz:60;signals.glowPasses=value==='high'?3:2;syncPreferences();persist();}
function cycleQuality(){const values=['low','medium','high'] as const;setQuality(values[(values.indexOf(signals.quality)+1)%3]);}
function toggleFocus(){signals.focusMode=!signals.focusMode;syncPreferences();persist();}

function renderTapes(){
  const symbols=tokenizeInput(machine,input),start=Math.max(0,player.cursor-3),end=Math.min(symbols.length,start+18);
  $('input-tape').innerHTML=symbols.slice(start,end).map((sym,j)=>{const i=start+j;return `<button class="tape-cell ${i<player.cursor?'consumed':''} ${i===player.cursor?'current':''}" data-token="${Array.from(sym).length>1}" data-seek="${i}" title="${escape(sym)}" aria-label="Before input ${i+1}: ${escape(sym)}"><span>${escape(sym)}</span><small>${i+1}</small></button>`;}).join('')+'<span class="tape-tail" aria-hidden="true">···</span>';
  let html=player.trace.initialOut!==undefined&&start===0?`<button class="tape-cell initial-cell" data-seek="0" aria-label="Initial Moore output ${escape(player.trace.initialOut)}"><span>${escape(player.trace.initialOut)}</span><small>start</small></button>`:'';
  html+=symbols.slice(start,end).map((_,j)=>{const i=start+j,out=i<player.cursor?player.trace.steps[i]?.out??'':'';return `<button class="tape-cell ${i<player.cursor?'printed':''} ${i===player.cursor?'current':''}" data-token="${Array.from(out).length>1}" data-seek="${i+1}" title="${escape(out)}" aria-label="After step ${i+1}${out?`: ${escape(out)}`:''}"><span>${escape(out)}</span><small>${i+1}</small></button>`;}).join('')+'<span class="tape-tail" aria-hidden="true">···</span>';
  $('output-tape').innerHTML=html;$('input-count').textContent=`${symbols.length} symbols`;$('output-count').textContent=`${player.cursor+(player.trace.initialOut!==undefined?1:0)} written`;
}
function renderTrace(){
  const steps=player.trace.steps,start=Math.max(0,Math.floor(Math.max(0,player.cursor-1)/100)*100-50),end=Math.min(steps.length,start+200);
  if(traceStart!==start||renderedTraceVersion!==traceVersion){
    let html=player.trace.initialOut!==undefined&&start===0?`<tr data-row-seek="0"><td><button data-seek="0" aria-label="Seek to initial output">Start</button></td><td>${escape(machine.start)}</td><td>—</td><td>${escape(machine.start)}</td><td>${escape(player.trace.initialOut)}</td></tr>`:'';
    html+=steps.slice(start,end).map((s,j)=>{const n=start+j+1;return `<tr data-row-seek="${n}"><td><button data-seek="${n}" aria-label="Seek to step ${n}">${String(n).padStart(2,'0')}</button></td><td>${escape(s.from)}</td><td>${escape(s.sym)}</td><td>${escape(s.to)}</td><td class="trace-out">${escape(s.out)}</td></tr>`;}).join('');
    $('trace-body').innerHTML=html;traceStart=start;renderedTraceVersion=traceVersion;
    $('trace-window').textContent=steps.length>200?`Steps ${start+1}–${end} of ${steps.length}. Use the timeline to seek.`:'';
  }
  for(const row of $('trace-body').children){const n=Number((row as HTMLElement).dataset.rowSeek);row.classList.toggle('selected',n===player.cursor);row.classList.toggle('read',n<player.cursor);const button=row.querySelector('button');if(n===player.cursor)button?.setAttribute('aria-current','step');else button?.removeAttribute('aria-current');}
  $('trace-empty').hidden=steps.length>0||player.trace.initialOut!==undefined;
}
function render(){
  if(!machine)return;
  const count=player.trace.steps.length,done=player.cursor===count,state=activeState(),out=outputSoFar();
  diagram.rest(state);$('active-state').textContent=state;$('current-state').textContent=state;$('summary-output').textContent=out||'—';
  $('step-counter').textContent=String(player.cursor).padStart(2,'0');$('total-counter').textContent=String(count).padStart(2,'0');$('progress-label').textContent=`${player.cursor} / ${count}`;
  $('playback-status').textContent=invalidInput?'Check your input':player.playing?'Following the signal':done&&count?'Run complete':player.cursor?'Paused':'Ready when you are';
  const progress=$<HTMLInputElement>('progress');progress.max=String(count);progress.value=String(player.cursor);progress.disabled=invalidInput||!count;
  $('play').innerHTML=`${icon(player.playing?'pause':'play')}<span>${player.playing?'Pause':done&&count?'Replay':'Play'}</span><kbd>Space</kbd>`;
  $<HTMLButtonElement>('play').disabled=invalidInput||!count;$<HTMLButtonElement>('step').disabled=invalidInput||player.cursor>=count;$<HTMLButtonElement>('back').disabled=player.cursor===0;
  $('trace-play').innerHTML=`${icon(player.playing?'pause':'play')}${player.playing?'Pause':done&&count?'Replay':'Play'}`;$<HTMLButtonElement>('trace-play').disabled=invalidInput||!count;$<HTMLButtonElement>('trace-step').disabled=invalidInput||player.cursor>=count;$<HTMLButtonElement>('trace-back').disabled=player.cursor===0;
  renderTapes();if(drawer.open&&route==='trace')renderTrace();
  if(player.cursor&&(!player.playing||player.speed<=1||player.cursor%4===0||done)){const s=player.trace.steps[player.cursor-1];$('narration').textContent=done?`Done. ${count} symbols read, final state ${state}. Output ${out}.`:`Step ${player.cursor}. In state ${s.from}, read ${s.sym}. Moved to ${s.to}. Wrote ${s.out}.`;}
}
function loadInput(value:string){
  cancelFlight();input=value;$<HTMLInputElement>('input').value=value;
  const issues=checkInput(machine,value);invalidInput=issues.length>0;
  $<HTMLInputElement>('input').setAttribute('aria-invalid',String(invalidInput));$('input-error').hidden=!invalidInput;
  if(issues.length){const issue=issues[0];$('input-error').textContent=`The input has “${issue.sym}” at position ${issue.index+1}. This machine reads only ${machine.alphabet.join(' and ')}.`;}
  const trace=invalidInput?{steps:[],output:''}:simulate(machine,value,{mooreInitial});
  const outputs=[...(trace.initialOut===undefined?[]:[trace.initialOut]),...trace.steps.map(step=>step.out)];
  outputSeparator=trace.output===outputs.join('')?'':' ';
  traceVersion++;player.load(trace);persist();
}
function loadMachine(text:string,newInput=input,id='custom',updateEditor=true,syncGraph=true){
  const result=parse(text);if(!result.machine)return result.errors;
  machine=result.machine;source=text;
  if(updateEditor){$<HTMLTextAreaElement>('source').value=source;manualDraft=source;manualDirty=false;}
  const moore=machine.outputs.kind==='moore',preset=presets.find(p=>p.id===id);
  $('machine-title').textContent=preset?.name??'Custom machine';$('machine-description').textContent=preset?.description??'Your states. Your transitions. Your experiment.';
  $('mode-mealy').setAttribute('aria-pressed',String(!moore));$('mode-moore').setAttribute('aria-pressed',String(moore));
  $('state-count').textContent=String(machine.states.length);$('transition-count').textContent=String(machine.states.reduce((n,s)=>n+Object.keys(machine.delta[s]).length,0));
  $('notation').innerHTML=moore?'Transition label: <b>input</b>':'Transition label: <b>input <span>/</span> output</b>';
  $('output-explanation').textContent=moore?'Moore outputs belong to states.':'Mealy outputs belong to transitions.';
  $('tape-note').textContent=moore?mooreInitial?'Initial output included: n + 1 symbols.':'Initial output omitted: n symbols.':'One output for every input.';
  $('convert').innerHTML=`${icon('convert')}<span>Convert to ${moore?'Mealy':'Moore'}</span>`;$('conversion-note').hidden=true;
  diagram.setMachine(machine);
  if(syncGraph){graph.setMachine(machine,!graphInitialized);graphInitialized=true;}
  $<HTMLInputElement>('input').placeholder=`e.g. ${machine.alphabet.slice(0,6).join(usesTokenInput(machine)?' ':'')}`;
  $('input-format').textContent=usesTokenInput(machine)?'Separate inputs with spaces. Each token is one transition.':'Enter symbols consecutively. Each symbol is one transition.';
  loadInput(newInput);return[];
}
function selectPreset(id:string){const p=presets.find(p=>p.id===id);if(!p)return;void navigate('bench',source,()=>loadMachine(p.source,p.input,p.id));}
function finishTransient(){cancelFlight();diagram.finishBuild();}
function seek(cursor:number){finishTransient();player.seek(cursor);}
function play(){if(invalidInput)return;finishTransient();player.toggle();}
function step(){if(invalidInput)return;finishTransient();player.step();}
function replay(){cancelFlight();player.seek(0);diagram.replay();}
player.onChange=()=>{lastKick=-1;render();};
player.onTravel=(i,p)=>{const first=i!==lastKick;if(first){lastKick=i;signals.energy=Math.min(1,signals.energy+.5);}if(player.speed<=2&&i<64){if(signals.reducedMotion||signals.quality==='low'){if(first)diagram.travel(player.trace.steps[i],1);}else diagram.travel(player.trace.steps[i],p);}};

const drawerDescriptions:Record<string,[string,string]>={trace:['The trace','Every transition, accounted for.'],text:['Edit the definition','States, symbols and transitions in text.'],settings:['Make it yours','Keep the logic. Set the atmosphere.']};
function markNavigation(name:string){document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach(b=>{const active=b.dataset.route===(name==='text'?'editor':name);b.classList.toggle('active',active);b.tabIndex=active?0:-1;if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
function navigate(name:string,textSource?:string,apply?:()=>void):Promise<void>{
  if(!['bench','machines','learn','trace','editor','text','settings'].includes(name))return Promise.resolve();
  const version=++navigationVersion,origin={...motionOrigin};
  motion.cancel();
  if(route==='text'&&name!=='text'){manualDraft=$<HTMLTextAreaElement>('source').value;if(manualDirty)validateDraft();persist();}
  if(name!=='trace'){player.seek(player.cursor);cancelFlight();}clearTimeout(editorTimer);
  const isDrawer=name in drawerDescriptions;
  const current=drawer.open?drawer:document.querySelector<HTMLElement>('.view:not([hidden])');
  const commit=()=>{
    if(version!==navigationVersion)return;
    if(drawer.open&&!isDrawer)drawer.close();
    apply?.();route=name;app.dataset.screen=name;markNavigation(name);
    ['bench','machines','learn','editor'].forEach(view=>$(`view-${view}`).hidden=view!==(isDrawer?'bench':name));
    if(isDrawer){
      ['trace','editor','settings'].forEach(panel=>$(`panel-${panel}`).hidden=panel!==(name==='text'?'editor':name));
      const [title,description]=drawerDescriptions[name];$('drawer-title').textContent=title;$('drawer-description').textContent=description;
      if(name==='trace')renderTrace();
      if(name==='text'){if(textSource!==undefined){manualDraft=textSource;manualDirty=false;}$<HTMLTextAreaElement>('source').value=manualDraft??source;$('editor-errors').replaceChildren();$('editor-valid').textContent='Changes preview when the definition is complete.';}
      if(!drawer.open)drawer.showModal();
    }
    if(name==='bench'||isDrawer)diagram.resize();
    if(name==='editor')graph.resize();
    motion.enter(isDrawer?drawer:$(`view-${name}`),origin,isDrawer?'drawer':'page');
    measureLayout();persist();app.dataset.navigating='false';
  };
  app.dataset.navigating='true';
  if(signals.reducedMotion||!current||name===route&&!apply){commit();return Promise.resolve();}
  return motion.exit(current,origin,drawer.open?'drawer':'page').then(commit);
}

drawer.addEventListener('close',()=>{if(route in drawerDescriptions){route='bench';markNavigation('bench');persist();}clearTimeout(editorTimer);});
drawer.addEventListener('cancel',e=>{e.preventDefault();void navigate('bench');});
$('close-drawer').addEventListener('click',()=>void navigate('bench'));
document.addEventListener('click',e=>{const trigger=(e.target as HTMLElement).closest<HTMLElement>('button,a,input[type=checkbox],select');if(!trigger)return;motionOrigin=motion.origin(trigger);if(trigger.matches('button'))motion.feedback(trigger);},true);
document.addEventListener('click',e=>{const target=e.target as HTMLElement;if(target.closest('#graph-editor')&&!target.closest('.graph-node,.graph-edge-label,.graph-canvas')){const inspector=document.querySelector<HTMLElement>('.graph-inspector');if(inspector)motion.enter(inspector,motionOrigin,'content');}});
document.querySelectorAll<HTMLButtonElement>('[data-route]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.route!)));
$('rail').addEventListener('keydown',e=>{const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('.nav-item'));const current=buttons.indexOf(document.activeElement as HTMLButtonElement);let index=current;if(['ArrowDown','ArrowRight'].includes(e.key))index=(current+1)%buttons.length;else if(['ArrowUp','ArrowLeft'].includes(e.key))index=(current-1+buttons.length)%buttons.length;else if(e.key==='Home')index=0;else if(e.key==='End')index=buttons.length-1;else return;e.preventDefault();buttons.forEach((b,i)=>b.tabIndex=i===index?0:-1);buttons[index].focus();});
$('edit-shortcut').addEventListener('click',()=>navigate('editor'));$('text-shortcut').addEventListener('click',()=>navigate('text'));$('library-edit').addEventListener('click',()=>navigate('editor'));$('trace-shortcut').addEventListener('click',()=>navigate('trace'));
document.addEventListener('click',e=>{const target=(e.target as HTMLElement).closest<HTMLElement>('[data-seek],[data-row-seek],[data-preset]');if(!target)return;if(target.dataset.preset)selectPreset(target.dataset.preset);else if(!invalidInput)seek(Number(target.dataset.seek??target.dataset.rowSeek));});
$('input-form').addEventListener('submit',e=>{e.preventDefault();loadInput($<HTMLInputElement>('input').value);});
$('mode-mealy').addEventListener('click',()=>{if(machine.outputs.kind!=='mealy')convertCurrent();});$('mode-moore').addEventListener('click',()=>{if(machine.outputs.kind!=='moore')convertCurrent();});
$('play').addEventListener('click',play);$('step').addEventListener('click',step);$('back').addEventListener('click',()=>seek(player.cursor-1));$('reset').addEventListener('click',()=>seek(0));$('replay-build').addEventListener('click',replay);
$('trace-play').addEventListener('click',play);$('trace-step').addEventListener('click',step);$('trace-back').addEventListener('click',()=>seek(player.cursor-1));$('trace-reset').addEventListener('click',()=>seek(0));
$('progress').addEventListener('input',()=>seek(Number($<HTMLInputElement>('progress').value)));$('speed').addEventListener('change',()=>{player.speed=Number($<HTMLSelectElement>('speed').value);cancelFlight();});
$('focus').addEventListener('click',toggleFocus);$('quality-button').addEventListener('click',cycleQuality);
function convertCurrent(){const wasMoore=machine.outputs.kind==='moore';try{const converted=serialize(wasMoore?mooreToMealy(machine):mealyToMoore(machine));void navigate('bench',source,()=>{loadMachine(converted);$('conversion-note').textContent=wasMoore?'Mealy machines print after reading, so the initial output is dropped.':'States split by incoming output. An initial 0 is added; omit initial Moore output in Settings to compare the runs.';$('conversion-note').hidden=false;toast(`Converted to ${wasMoore?'Mealy':'Moore'}.`);});}catch(e){toast(e instanceof Error?e.message:'The conversion could not be completed.');}}
$('convert').addEventListener('click',convertCurrent);
function validateDraft(apply=false){
  clearTimeout(editorTimer);const draft=$<HTMLTextAreaElement>('source').value;manualDraft=draft;manualDirty=false;
  const errors=loadMachine(draft,input,'custom',false);
  $('editor-errors').innerHTML=errors.slice(0,30).map(e=>`<p><strong>Line ${e.line}:</strong> ${escape(e.msg)}</p>`).join('');
  $('editor-valid').textContent=errors.length?'The diagram keeps your last valid machine.':'Valid machine. Preview updated.';
  if(errors.length&&apply)$('editor-errors').focus();else if(apply){void navigate('bench');toast('Machine applied.');}
}
$('source').addEventListener('input',()=>{manualDraft=$<HTMLTextAreaElement>('source').value;manualDirty=true;persist();clearTimeout(editorTimer);editorTimer=window.setTimeout(()=>validateDraft(),250);});$('apply').addEventListener('click',()=>validateDraft(true));
function traceText(){return[`Patchbay — ${machine.outputs.kind} machine`,`Input: ${input}`,`Output: ${player.trace.output}`,player.trace.initialOut!==undefined?`Initial output: ${player.trace.initialOut}`:'','Step\tState\tInput\tNext\tOutput',...player.trace.steps.map((s,i)=>`${i+1}\t${s.from}\t${s.sym}\t${s.to}\t${s.out}`)].filter(Boolean).join('\n');}
function download(text:string,name:string){const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=name;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(traceText());toast('Full trace copied.');}catch{if(window.patchbay)toast('Clipboard unavailable. Try again with the app focused.');else download(traceText(),'patchbay-trace.txt');}});
function openDefinition(value:string,name:string){if(value.trimStart().startsWith('{')){graph.openSource(value);navigate('editor');}else{$<HTMLTextAreaElement>('source').value=value;$('editor-file').textContent=name;validateDraft();}}
$('open-file').addEventListener('click',async()=>{try{if(window.patchbay){const file=await window.patchbay.openMachine();if(file)openDefinition(file.source,file.name);}else $<HTMLInputElement>('file-input').click();}catch(e){toast(e instanceof Error?e.message:'Could not open that file.');}});
$('file-input').addEventListener('change',async()=>{const element=$<HTMLInputElement>('file-input'),file=element.files?.[0];if(!file)return;try{if(file.size>MACHINE_FILE_BYTES)throw new Error('Choose a file no larger than 1 MiB.');openDefinition(await file.text(),file.name);}catch(e){toast(e instanceof Error?e.message:'Could not open that file.');}finally{element.value='';}});
$('save-file').addEventListener('click',async()=>{try{const value=$<HTMLTextAreaElement>('source').value;if(textEncoder.encode(value).byteLength>MACHINE_FILE_BYTES||value.includes('\0'))throw new Error('Save a UTF-8 definition no larger than 1 MiB, without null characters.');if(window.patchbay){if(await window.patchbay.saveMachine(value))toast('Definition saved.');}else download(value,'patchbay-machine.txt');}catch(e){toast(e instanceof Error?e.message:'Could not save the machine file.');}});
$('screenshot').addEventListener('click',async()=>{await navigate('bench');try{await new Promise(resolve=>window.setTimeout(resolve,750));if(await window.patchbay?.saveScreenshot())toast('Screenshot saved.');}catch{toast('Could not save the screenshot.');}});
if(!window.patchbay){document.documentElement.classList.add('web-preview');$<HTMLButtonElement>('screenshot').disabled=true;$('screenshot').title='Open the Electron app to save a screenshot.';}
$('moore-initial').addEventListener('change',()=>{mooreInitial=$<HTMLInputElement>('moore-initial').checked;$('tape-note').textContent=machine.outputs.kind==='moore'?mooreInitial?'Initial output included: n + 1 symbols.':'Initial output omitted: n symbols.':'One output for every input.';loadInput(input);});
$('quality').addEventListener('change',()=>setQuality($<HTMLSelectElement>('quality').value as Signals['quality']));
$('solid-panels').addEventListener('change',()=>{solidPreference=$<HTMLInputElement>('solid-panels').checked;syncPreferences();persist();});
$('reduced-motion').addEventListener('change',()=>{signals.reducedMotion=$<HTMLInputElement>('reduced-motion').checked;cancelFlight();if(signals.reducedMotion){motion.cancel();wave.finish();}syncPreferences();persist();});
$('motion-blur').addEventListener('change',()=>{motionBlur=$<HTMLInputElement>('motion-blur').checked;motion.cancel();persist();});
for(const id of ['theme-toggle','theme-setting'])$(id).addEventListener('click',()=>wave.toggle(motionOrigin));
$('high-contrast').addEventListener('change',()=>{highContrast=$<HTMLInputElement>('high-contrast').checked;syncPreferences();persist();});
motionQuery.addEventListener('change',e=>{signals.reducedMotion=e.matches;if(e.matches){motion.cancel();wave.finish();}syncPreferences();});contrastQuery.addEventListener('change',()=>syncPreferences());transparencyQuery.addEventListener('change',()=>syncPreferences());
$('diagram').addEventListener('state-inspect',e=>{const state=(e as CustomEvent<{state:string}>).detail.state;toast(`State ${state}. ${machine.alphabet.map(sym=>`On ${sym}, go to ${machine.delta[state][sym]}.`).join(' ')}`);});
$('diagram').addEventListener('glyph-handoff',e=>{if(signals.reducedMotion||player.speed>2||signals.focusMode)return;const {glyph:value,x,y}=(e as CustomEvent<{glyph:string;x:number;y:number}>).detail;const cell=document.querySelector('.output-tape .current');if(!cell)return;const rect=cell.getBoundingClientRect();cancelFlight();glyph.textContent=value;glyph.style.opacity='1';glyphAnimation=glyph.animate([{transform:`translate(${x}px,${y}px) scale(.8)`,opacity:1},{transform:`translate(${rect.x+rect.width/2}px,${rect.y+rect.height/2}px) scale(1)`,opacity:0}],{duration:Math.min(340,270/player.speed),easing:'cubic-bezier(.2,0,.2,1)',fill:'forwards'});});
document.addEventListener('keydown',e=>{if(route==='editor'||e.ctrlKey||e.altKey||e.metaKey||drawer.open&&route!=='trace')return;const target=e.target as HTMLElement;if(target.matches('input,textarea,select,[contenteditable]'))return;if(e.key===' '&&target.closest('button'))return;if(target.closest('#rail')&&e.key.startsWith('Arrow'))return;const actions:Record<string,()=>void>={' ':play,ArrowRight:step,ArrowLeft:()=>seek(player.cursor-1),r:()=>seek(0),e:()=>navigate('editor'),f:toggleFocus,q:cycleQuality,b:replay,'?':()=>navigate('learn')};const action=actions[e.key];if(action){e.preventDefault();action();}});
$('sheet').addEventListener('pointermove',e=>{targetPointer.x=Math.max(-1,Math.min(1,(e.clientX-bounds.x)/bounds.width*2-1));targetPointer.y=Math.max(-1,Math.min(1,(e.clientY-bounds.y)/bounds.height*2-1));});$('sheet').addEventListener('pointerleave',()=>{targetPointer.x=targetPointer.y=0;});
document.addEventListener('pointermove',e=>{targetPointer.x=e.clientX/innerWidth*2-1;targetPointer.y=e.clientY/innerHeight*2-1;},{passive:true});
document.addEventListener('pointerleave',()=>{targetPointer.x=targetPointer.y=0;});
document.querySelector('.wordmark')!.addEventListener('click',e=>{e.preventDefault();navigate('bench');});
let removeMaximizedListener:undefined|(()=>void);
if(window.patchbay){const bridge=window.patchbay;const setMax=(max:boolean)=>{$('window-maximize').innerHTML=icon(max?'restore':'maximize');$('window-maximize').setAttribute('aria-label',max?'Restore window':'Maximize window');};$('window-minimize').addEventListener('click',()=>void bridge.minimize());$('window-maximize').addEventListener('click',()=>void bridge.toggleMaximize().then(setMax));$('window-close').addEventListener('click',()=>void bridge.close());void bridge.isMaximized().then(setMax);removeMaximizedListener=bridge.onMaximized(setMax);}
function measureLayout(){const b=$('sheet').getBoundingClientRect();bounds={x:b.x,y:b.y,width:b.width||1,height:b.height||1};}
const observer=new ResizeObserver(measureLayout);observer.observe(document.body);observer.observe($('rail'));observer.observe($('sheet'));observer.observe($('dock'));window.addEventListener('scroll',measureLayout,{passive:true});

let saved:Record<string,unknown>={};try{const parsed:unknown=JSON.parse(localStorage.getItem('patchbay:nav:v1')??localStorage.getItem('patchbay-session')??'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))saved=parsed as Record<string,unknown>;}catch{/* Recover damaged saved state. */}
if(typeof saved.mooreInitial==='boolean')mooreInitial=saved.mooreInitial;if(typeof saved.reducedMotion==='boolean')signals.reducedMotion=saved.reducedMotion;if(typeof saved.highContrast==='boolean')highContrast=saved.highContrast;if(typeof saved.focusMode==='boolean')signals.focusMode=saved.focusMode;if(saved.glass==='solid')solidPreference=true;if(['low','medium','high'].includes(String(saved.quality)))signals.quality=saved.quality as Signals['quality'];if(['low','medium','high'].includes(params.get('quality')??''))signals.quality=params.get('quality') as Signals['quality'];
if(typeof saved.source==='string'&&textEncoder.encode(saved.source).byteLength<=MACHINE_FILE_BYTES&&parse(saved.source).machine){source=saved.source;input=typeof saved.input==='string'?saved.input.slice(0,4096):input;}
if(saved.theme==='light'||saved.theme==='dark')theme=saved.theme;if(typeof saved.motionBlur==='boolean')motionBlur=saved.motionBlur;
syncPreferences();scene.refreshTheme(theme);diagram.refreshTheme();await document.fonts.ready;
loadMachine(source,input,presets.find(p=>p.source===source)?.id??'custom');
if(typeof saved.manualDraft==='string'&&textEncoder.encode(saved.manualDraft).byteLength<=MACHINE_FILE_BYTES)manualDraft=saved.manualDraft;
if(['machines','learn'].includes(String(saved.route)))navigate(String(saved.route));
measureLayout();
const ticker=new Ticker(signals,(dt)=>{
  const ease=1-Math.exp(-dt/.12);signals.pointer.x+=(targetPointer.x-signals.pointer.x)*ease;signals.pointer.y+=(targetPointer.y-signals.pointer.y)*ease;signals.energy*=Math.exp(-dt/.8);
  const visibleBench=!$('view-bench').hidden;
  if(visibleBench){player.update(dt);diagram.update(dt,signals);}
  if(!$('view-editor').hidden)graph.update(dt,signals);
  signals.phase=invalidInput?'fault':diagram.building&&visibleBench?'building':player.playing?'playing':player.cursor===player.trace.steps.length&&player.cursor>0?'done':'idle';
  if(signals.phase==='building')signals.energy=.35;
  if(buildWasActive!==diagram.building){buildWasActive=diagram.building;$('build-status').textContent=diagram.building?'Building diagram':'Diagram ready';}
  scene.update(dt,signals,wave.active||drawer.open);wave.update(dt);
},stats=>{
  $('metric-hz').textContent=`${signals.refreshHz} Hz`;$('metric-frame').textContent=`${stats.p50.toFixed(1)} / ${stats.p95.toFixed(1)} ms`;$('metric-board').textContent=`${scene.renderer} · ${scene.costMs.toFixed(2)} ms`;$('metric-draws').textContent=`${scene.drawCount} scene / ${diagram.drawCount} diagram`;$('metric-long').textContent=String(stats.longFrames);$('metric-errors').textContent=String(rendererErrors);
  if(params.has('debug')){$('debug').hidden=false;$('debug').textContent=`${signals.refreshHz} Hz · p50 ${stats.p50.toFixed(1)} / p95 ${stats.p95.toFixed(1)} ms\n${signals.quality} · ${signals.glass} · ${scene.renderer} ${scene.costMs.toFixed(2)} ms\nDraws ${scene.drawCount} / ${diagram.drawCount} · long frames ${stats.longFrames}`;}
},()=>{solidPreference=signals.glass==='solid';syncPreferences();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){player.seek(player.cursor);cancelFlight();wave.finish();motion.cancel();}});
window.addEventListener('error',()=>{rendererErrors++;});window.addEventListener('unhandledrejection',()=>{rendererErrors++;});
ticker.start();app.dataset.ready='true';
window.addEventListener('beforeunload',()=>{ticker.dispose();observer.disconnect();wave.dispose();motion.dispose();scene.dispose();diagram.dispose();graph.dispose();removeMaximizedListener?.();cancelFlight();});
