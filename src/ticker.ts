import type { Signals } from './signals';
export interface Stats { p50:number; p95:number; longFrames:number }
/** A single clock owns all motion, refresh sampling, and performance degradation. */
export class Ticker {
  private frame=0;private last=0;private count=0;private initialCount=0;private index=0;private elapsed=0;private slow=0;private detected=false;private disposed=false;
  private gaps=new Float64Array(60);private sorted=new Float64Array(60);private initial=new Float64Array(30);
  private stats:Stats={p50:0,p95:0,longFrames:0};private observer?:PerformanceObserver;
  constructor(private signals:Signals,private update:(dt:number)=>void,private report:(stats:Stats)=>void,private degraded:()=>void){
    if(PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')){this.observer=new PerformanceObserver(list=>{this.stats.longFrames+=list.getEntries().length;});this.observer.observe({type:'long-animation-frame'});}
    document.addEventListener('visibilitychange',this.visibility);
  }
  private visibility=()=>{cancelAnimationFrame(this.frame);if(!document.hidden&&!this.disposed){this.last=0;this.elapsed=0;this.slow=0;this.frame=requestAnimationFrame(this.tick);}};
  start(){if(!document.hidden&&!this.disposed){this.last=0;this.frame=requestAnimationFrame(this.tick);}}
  private tick=(now:number)=>{
    if(this.disposed||document.hidden)return;
    const gap=this.last?now-this.last:0;this.last=now;
    if(gap>0){
      this.gaps[this.index]=gap;this.index=(this.index+1)%60;this.count=Math.min(60,this.count+1);
      if(!this.detected&&gap<100){this.initial[this.initialCount++]=gap;if(this.initialCount===30){this.initial.sort();const rate=1000/this.initial[15];const rates=[60,75,90,120,144,165,240];this.signals.refreshHz=rates.reduce((a,b)=>Math.abs(b-rate)<Math.abs(a-rate)?b:a);this.signals.boardRate=Math.min(120,this.signals.refreshHz);this.detected=true;}}
      this.elapsed+=gap;
    }
    this.update(Math.min(gap/1000,.05));
    if(this.elapsed>=500&&this.count===60){
      const reportSeconds=this.elapsed/1000;this.elapsed=0;this.sorted.set(this.gaps);this.sorted.sort();this.stats.p50=this.sorted[30];this.stats.p95=this.sorted[57];
      const budget=1000/Math.min(120,this.signals.refreshHz);
      this.slow=this.stats.p95>budget*1.1?this.slow+reportSeconds:0;
      if(this.slow>=2){this.slow=0;const s=this.signals;if(s.boardRate>60)s.boardRate=60;else if(s.glowPasses===3)s.glowPasses=2;else if(s.quality==='high')s.quality='medium';else if(s.glass==='baked')s.glass='solid';else if(s.quality==='medium')s.quality='low';this.degraded();}
      this.report(this.stats);
    }
    this.frame=requestAnimationFrame(this.tick);
  };
  dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.observer?.disconnect();document.removeEventListener('visibilitychange',this.visibility);}
}
