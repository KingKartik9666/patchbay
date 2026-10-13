import { createServer } from 'vite';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
const root = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const server = await createServer({ root, server: { middlewareMode: true } });
try {
  const [{ parse }, { simulate, tokenizeInput, checkInput }, { mealyToMoore, mooreToMealy }, { serialize }, { presets }, graph] = await Promise.all([
    'parse', 'simulate', 'convert', 'serialize', '../presets', '../editor/model',
  ].map(name => server.ssrLoadModule(name.startsWith('../') ? '/src/' + name.slice(3) + '.ts' : '/src/engine/' + name + '.ts')));
  const valid = [...presets.map(p => ({ id:p.id, source:p.source, inputs:['',p.input,p.input+' ?'] })),
    {id:'unicode',source:'type mealy\nstart Ω\nΩ 🙂 Ω ✨\nΩ λ Ω β',inputs:['','🙂λ🙂','🙂 λ']},
    {id:'unicode-tokens',source:'type moore\nstart A\nout A ready\nA 0 A\nA coin A\nA é A',inputs:['','0 coin é','\tcoin\n0\u0085é']},
    {id:'prototype-names',source:'type mealy\nstart __proto__\n__proto__ 0 constructor 1\nconstructor 0 toString 0\ntoString 0 __proto__ 1',inputs:['','000000','1']},
  ];
  for(let n=1;n<=12;n++) {
    const lines=['type mealy','start S0','alphabet 0 1'];
    for(let s=0;s<n;s++) for(let b=0;b<2;b++) lines.push(`S${s} ${b} S${(s*3+b+1)%n} ${(s+b)%2}`);
    valid.push({id:`generated-${n}`,source:lines.join('\n'),inputs:['','0','1','011010'.repeat(10)]});
  }
  const invalid=['','type other\nstart A\nA 0 A 0','type mealy\nA 0 A 0','type mealy\nstart Z\nA 0 A 0','type mealy\nstart A\nA 0 A','type mealy\nstart A\nA 0 B 0\nA 1 A 1\nB 0 A 0','type moore\nstart A\nout A 0\nA 0 B\nB 0 A','type mealy\nstart A\nA 0 A 0\nA 0 A 1','type moore\nstart A\nout A 0\nout A 1\nA 0 A','type mealy\ntype moore\nstart A\nA 0 A 0','type mealy\nstart A\nstart A\nA 0 A 0','type mealy\nstart A\nalphabet 0 0\nA 0 A 0','type mealy\nstart A\nalphabet 0\nA 1 A 0','type mealy\nstart A\nstate A\nstate A\nA 0 A 0'];
  const cases = valid.map(({id,source,inputs}) => {
    const result = parse(source); if(!result.machine) throw new Error(id+JSON.stringify(result.errors));
    const machine=result.machine;
    const converted=machine.outputs.kind==='mealy'?mealyToMoore(machine):mooreToMealy(machine);
    const wordInitial=machine.outputs.kind==='mealy'?mealyToMoore(machine,'ready'):converted;
    return {id,source,result,serialized:serialize(machine),converted,convertedSource:serialize(converted),wordInitial,
      runs:inputs.flatMap(input=>[true,false].map(mooreInitial=>({input,mooreInitial,symbols:tokenizeInput(machine,input),issues:checkInput(machine,input),trace:simulate(machine,input,{mooreInitial}),convertedTrace:simulate(converted,input,{mooreInitial:false}),wordTrace:simulate(wordInitial,input,{mooreInitial})}))) };
  });
  const fixtureDir=new URL('../tests/fixtures/',import.meta.url); await mkdir(fixtureDir,{recursive:true});
  await writeFile(new URL('domain-parity.json',fixtureDir),JSON.stringify({capturedFrom:'Patchbay 1.3.0 TypeScript engine',cases,invalid:invalid.map(source=>({source,result:parse(source)}))},null,2)+'\n');
  await writeFile(new URL('presets.json',fixtureDir),JSON.stringify(presets,null,2)+'\n');
  const draft=graph.draftFromMachine(parse(presets[0].source).machine); draft.states[0].x=0;draft.states[0].y=35;draft.kind='moore';draft.transitions.reverse();
  const unfinished=graph.createDraft();graph.addState(unfinished,160,200);graph.addState(unfinished,430,200);graph.setAlphabet(unfinished,['coin','push']);graph.upsertTransition(unfinished,{from:unfinished.states[0].id,to:unfinished.states[1].id,input:'coin',output:'unlock'});
  await writeFile(new URL('graph-compatibility.json',fixtureDir),JSON.stringify([draft,unfinished].map(draft=>({draft,source:graph.draftToSource(draft),file:graph.serializeDraft(draft),errors:graph.validateDraft(draft)})),null,2)+'\n');
  const largeSource=['type mealy','start S0','alphabet 0 1',...Array.from({length:256},(_,s)=>[`S${s} 0 S${(s+1)%256} 0`,`S${s} 1 S${(s+17)%256} 1`]).flat()].join('\n');
  const large=parse(largeSource).machine,benchInput='01101001'.repeat(512);
  const measure=fn=>{for(let i=0;i<50;i++)fn();const times=[];for(let i=0;i<500;i++){const start=performance.now();fn();times.push(performance.now()-start);}times.sort((a,b)=>a-b);return{samples:500,p50Ms:times[250],p95Ms:times[475]};};
  const report={version:'1.3.0',node:process.version,platform:process.platform,arch:process.arch,conditions:{states:256,transitions:512,inputCodeUnits:4096,warmups:50},parse:measure(()=>parse(largeSource)),simulate:measure(()=>simulate(large,benchInput)),convert:measure(()=>mealyToMoore(large)),capturedAt:new Date().toISOString()};
  await writeFile(new URL('benchmark-input.json',fixtureDir),JSON.stringify({source:largeSource,input:benchInput})+'\n');
  await mkdir(new URL('../artifacts/migration/',import.meta.url),{recursive:true});
  await writeFile(new URL('../artifacts/migration/baseline-domain.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({cases:cases.length,runs:cases.reduce((n,c)=>n+c.runs.length,0),invalid:invalid.length,benchmark:report},null,2));
} finally { await server.close(); }
