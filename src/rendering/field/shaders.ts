/** GLSL ES 3.00 for the field, kept compact because shader strings ship as-is.
 * The glass constants below are the single source for both the shader and the
 * JS mirrors that the tests check. */
export const GLASS = {
  /** Dark: luminance passes unchanged below the knee and approaches darkMax. */
  knee: 0.04,
  /** Under the audited #454545 (L 0.0595) with room for the ±0.5/255 dither. */
  darkMax: 0.058,
  /** Over the audited #C4C4C4 (L 0.552) with the same room. */
  lightMin: 0.565,
  /** #7A808A: the dark field never exceeds this outside the glass. */
  cap: 0.214,
  lens: 10,
  rim: 14,
  frost: 18,
  expand: 8,
  vignette: 0.82,
} as const;

/** WCAG relative luminance of linear RGB. */
export const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
export const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Soft knee: slope 1 at the knee, asymptote darkMax, never above it. */
export function clampDark(l: number): number {
  const span = GLASS.darkMax - GLASS.knee;
  return l <= GLASS.knee ? l : GLASS.knee + span * (1 - Math.exp(-(l - GLASS.knee) / span));
}
/** Mixes toward a floor colour of luminance `floor` until L reaches lightMin. */
export function floorLight(l: number, floor: number): number {
  if (l >= GLASS.lightMin) return l;
  return l + ((GLASS.lightMin - l) / Math.max(floor - l, 1e-3)) * (floor - l);
}
/** Dark field outside glass; `exempt` (0..1) is the live signal's mask. */
export function capField(l: number, exempt: number): number {
  return Math.min(l, GLASS.cap) * (1 - exempt) + l * exempt;
}
/** Lens displacement in CSS px at `edge` px inside the rim. */
export function lensOffset(edge: number): number {
  return edge < GLASS.rim ? GLASS.lens * (1 - edge / GLASS.rim) ** 2 : 0;
}
/** Mip level that matches an 18 CSS px blur at `texelsPerCss`. */
export function frostLod(texelsPerCss: number): number {
  return Math.max(0, Math.min(5, Math.log2(GLASS.frost * texelsPerCss)));
}

const HEAD = '#version 300 es\nprecision highp float;\n';
/** A GLSL float literal. */
const n = (value: number) => {
  const text = String(+value.toFixed(6));
  return text.includes('.') ? text : `${text}.`;
};
const ENCODE =
  'vec3 enc(vec3 c){c=clamp(c,0.,1.);return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c));}\n' +
  'vec3 dec(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(.04045,c));}\n';
const LIGHT = `uniform vec3 uEye,uL,uLc,uSky,uGnd,uFog;uniform float uAmb;
vec3 face(vec3 n,vec3 w){vec3 v=normalize(uEye-w);n=normalize(n);return dot(n,v)<0.?-n:n;}
vec3 lit(vec3 a,vec3 n,vec3 w,float sp,float gl,float rim){vec3 v=normalize(uEye-w),l=uL-w;float d=length(l);l/=d;
float at=1./(1.+.35*d*d),nl=max(dot(n,l),0.);vec3 hm=mix(uGnd,uSky,n.y*.5+.5)*uAmb;
return a*(hm+uLc*nl*at)+uLc*sp*pow(max(dot(n,normalize(l+v)),0.),gl)*at*step(0.,dot(n,l))+rim*pow(1.-max(dot(n,v),0.),3.)*(hm+uLc*at);}
float fog(vec3 w){return 1.-exp(-max(0.,-w.z-3.5)*.16);}
`;
const OUT = 'layout(location=0) out vec4 o;\n';

/** Background: vertical field gradient with a horizon haze. */
export const BG_VS = `${HEAD}out vec2 vU;void main(){vec2 p=vec2(gl_VertexID==1?3.:-1.,gl_VertexID==2?3.:-1.);vU=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
export const BG_FS = `${HEAD}${ENCODE}${OUT}in vec2 vU;uniform vec3 uTop,uBot,uHaze;uniform float uHz;
void main(){float h=exp(-pow((vU.y-uHz)/.14,2.));o=vec4(enc(mix(mix(uBot,uTop,vU.y),uHaze,h*.85)),0.);}`;

/** Socket floor: 22×12 instanced bezels on y = −2.2 from z −1 to −14. */
export const FLOOR_VS = `${HEAD}layout(location=0)in vec3 aP;layout(location=1)in vec3 aN;uniform mat4 uVP;out vec3 vW,vN;
void main(){int i=gl_InstanceID;vW=aP+vec3(-11.55+float(i%22)*1.1,-2.2,-1.-float(i/22)*${n(13 / 11)});vN=aN;gl_Position=uVP*vec4(vW,1.);}`;
export const FLOOR_FS = `${HEAD}${ENCODE}${LIGHT}${OUT}in vec3 vW,vN;uniform vec3 uBez;uniform vec4 uPool;uniform vec2 uSweep;
void main(){vec3 n=face(vN,vW),c=lit(uBez,n,vW,.3,32.,.05);vec2 d=vW.xz-uPool.xz;
float p=exp(-dot(d,d)*.35)*uPool.w+exp(-pow(vW.x-uSweep.x,2.)/.6)*uSweep.y;
vec3 h=normalize(vec3(0.,1.,0.)+normalize(uEye-vW));
c+=uLc*p*(uBez*max(n.y,0.)*10.+.6*pow(max(dot(n,h),0.),24.));o=vec4(enc(mix(c,uFog,fog(vW))),0.);}`;

/** Jacks: per-instance position, scale, tilt toward the light and emission. */
export const JACK_VS = `${HEAD}layout(location=0)in vec3 aP;layout(location=1)in vec3 aN;layout(location=2)in float aZ;
layout(location=3)in vec4 aI;layout(location=4)in vec4 aE;layout(location=5)in float aF;
uniform mat4 uVP,uG;out vec3 vW,vN,vE;out float vZ;
void main(){float cx=cos(aE.x),sx=sin(aE.x),cy=cos(aE.y),sy=sin(aE.y);mat3 R=mat3(cy,0,-sy,0,1,0,sy,0,cy)*mat3(1,0,0,0,cx,sx,0,-sx,cx);
vec4 w=uG*vec4(R*aP*aI.w+aI.xyz,1.);vW=w.xyz;vN=mat3(uG)*(R*aN);vZ=aZ;vE=vec3(aE.zw,aF);gl_Position=uVP*w;}`;
export const JACK_FS = `${HEAD}${ENCODE}${LIGHT}${OUT}in vec3 vW,vN,vE;in float vZ;uniform vec3 uJack,uLive,uFault;uniform float uCollar;
void main(){vec3 n=face(vN,vW);float r=step(.5,vZ)*step(vZ,1.5),k=step(1.5,vZ)*step(vZ,2.5),h=step(2.5,vZ);
vec3 c=lit(uJack*(1.-.7*h),n,vW,.6*(1.-h),48.,.25)+uLc*vE.y*(r+k+.4*(1.-r-k-h));
c=mix(c,uLive,uCollar*.35*k);float lv=vE.x*r,f=vE.z*r*(1.-vE.x);c=mix(c,uLive,lv*.9);c+=uFault*.5*f;
o=vec4(enc(mix(c,uFog,fog(vW)*(1.-lv-f))),max(lv,f));}`;

const CUBIC = `layout(location=1)in vec3 aA;layout(location=2)in vec3 aB;layout(location=3)in vec3 aC;layout(location=4)in vec3 aD;
layout(location=5)in vec4 aK;layout(location=6)in vec2 aS;uniform mat4 uVP,uG;out vec3 vW,vN;out float vL;
vec3 cb(float t){float s=1.-t;return s*s*s*aA+3.*s*s*t*aB+3.*s*t*t*aC+t*t*t*aD+aK.xyz*sin(3.14159*t);}
vec3 ct(float t){float s=1.-t;return 3.*s*s*(aB-aA)+6.*s*t*(aC-aB)+3.*t*t*(aD-aC)+aK.xyz*3.14159*cos(3.14159*t)+1e-5;}
void fr(vec3 T,out vec3 N,out vec3 B){vec3 u=normalize(mix(vec3(0,0,1),vec3(0,1,0),smoothstep(.6,.9,abs(T.z))));N=normalize(cross(T,u));B=cross(T,N);}
void put(vec3 p,vec3 n){vec4 w=uG*vec4(p,1.);vW=w.xyz;vN=mat3(uG)*n;vL=aS.x;gl_Position=uVP*w;}
`;
/** Cables: an instanced tube strip evaluated from per-instance P0..P3 and bend. */
export const CABLE_VS = `${HEAD}layout(location=0)in vec2 aT;${CUBIC}uniform float uR;
void main(){vec3 T=normalize(ct(aT.x)),N,B;fr(T,N,B);vec3 n=cos(aT.y)*N+sin(aT.y)*B;put(cb(aT.x)+n*uR*aK.w,n);}`;
/** Plug sleeves at both ends and the Mealy ferrule at mid-span. */
export const FITTING_VS = `${HEAD}layout(location=0)in vec3 aF;layout(location=7)in vec3 aG;${CUBIC}uniform float uFer;
void main(){float k=abs(aF.x-.5)<.1?uFer:1.;vec3 T=normalize(ct(aF.x)),N,B;if(aF.x>.75)T=-T;fr(T,N,B);
vec3 d=cos(aF.z)*N+sin(aF.z)*B;put(cb(aF.x)+(T*aF.y+d*aG.x)*k*aK.w,d*aG.y+T*aG.z);}`;
export const CABLE_FS = `${HEAD}${ENCODE}${LIGHT}${OUT}in vec3 vW,vN;in float vL;uniform vec3 uCab,uLive;uniform vec2 uSpec;
void main(){vec3 c=lit(uCab,face(vN,vW),vW,uSpec.x,uSpec.y,.2);c=mix(c,uLive,vL*.95);o=vec4(enc(mix(c,uFog,fog(vW)*(1.-vL))),vL);}`;
/** The live cable's soft halo shell. */
export const HALO_FS = `${HEAD}${ENCODE}uniform vec3 uEye,uLive;uniform float uHalo;${OUT}in vec3 vW,vN;in float vL;
void main(){float a=pow(abs(dot(normalize(vN),normalize(uEye-vW))),2.)*uHalo;o=vec4(enc(uLive),a);}`;

/** Signal bead: a camera-facing emissive sprite. */
export const BEAD_VS = `${HEAD}layout(location=0)in vec2 aQ;uniform mat4 uVP;uniform vec3 uBp,uRt,uUp;uniform float uBs;out vec2 vQ;
void main(){vQ=aQ;gl_Position=uVP*vec4(uBp+(uRt*aQ.x+uUp*aQ.y)*uBs,1.);}`;
export const BEAD_FS = `${HEAD}${ENCODE}uniform vec3 uLive;${OUT}in vec2 vQ;
void main(){float a=smoothstep(1.,.5,length(vQ));o=vec4(enc(uLive),a);}`;

/** Composite: shader-owned glass under registered rects (lens, frost, clamp),
 * the field cap outside them, focus dim, vignette, bead glow and dither. */
export const COMPOSITE_FS = `${HEAD}${ENCODE}${OUT}uniform sampler2D uS;uniform vec2 uC,uT;uniform float uOut,uH,uLod,uDim,uDs,uTh;
uniform vec4 uR[8];uniform vec2 uK[8];uniform int uN;uniform vec3 uBd,uGc,uFl;const vec3 W=vec3(.2126,.7152,.0722);
vec3 sd(vec2 p,vec4 r,float k){vec2 h=r.zw*.5,c=r.xy+h,s=sign(p-c+1e-4),q=abs(p-c)-h+k;float e=length(max(q,0.));
return vec3(e+min(max(q.x,q.y),0.)-k,(e>0.?normalize(max(q,0.)):(q.x>q.y?vec2(1,0):vec2(0,1)))*s);}
vec2 uv(vec2 q){return vec2(q.x/uC.x,1.-q.y/uC.y);}
void main(){vec2 p=vec2(gl_FragCoord.x,uH-gl_FragCoord.y)/uOut,g=vec2(0);float b=1e4;
for(int i=0;i<8;i++){if(i>=uN)break;vec4 r=uR[i];vec3 s=sd(p,r,min(uK[i].x,.5*min(r.z,r.w)));if(uK[i].y<.5&&s.x<0.)s=vec3(p.y-r.y-r.w,0,1);if(s.x<b){b=s.x;g=s.yz;}}
vec3 c;float ex=0.;
if(b<0.){float e=-b;vec2 q=uv(p-g*(e<${n(GLASS.rim)}?${n(GLASS.lens)}*pow(1.-e/${n(GLASS.rim)},2.):0.)),f=exp2(uLod)*.5/uT;
c=(textureLod(uS,q+f,uLod).rgb+textureLod(uS,q-f,uLod).rgb+textureLod(uS,q+vec2(f.x,-f.y),uLod).rgb+textureLod(uS,q+vec2(-f.x,f.y),uLod).rgb)*.25;}
else{vec4 t=textureLod(uS,uv(p),.6);c=t.rgb;ex=t.a;}
c=dec(c);float l=dot(c,W);c=mix(c,vec3(l),uDs)*uDim;vec2 m=(p/uC-.5)*2.;c*=mix(1.,${n(GLASS.vignette)},smoothstep(.5,1.6,dot(m,m)));
vec2 d=p-uBd.xy;float gw=min(1.,uBd.z*(exp(-dot(d,d)/72.)+.2*exp(-dot(d,d)/648.)));
if(b<${n(GLASS.expand)}){c=mix(c,uGc,gw);l=dot(c,W);
vec3 dk=l>${n(GLASS.knee)}?c*(${n(GLASS.knee)}+${n(GLASS.darkMax - GLASS.knee)}*(1.-exp(-(l-${n(GLASS.knee)})/${n(GLASS.darkMax - GLASS.knee)})))/l:c;
vec3 lt=l<${n(GLASS.lightMin)}?mix(c,uFl,(${n(GLASS.lightMin)}-l)/max(dot(uFl,W)-l,1e-3)):c;c=mix(dk,lt,uTh);}
else{l=dot(c,W);c=mix(mix(c*min(1.,${n(GLASS.cap)}/max(l,1e-5)),c,ex),c,uTh);c=mix(c,uGc,gw);}
o=vec4(enc(c)+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.,1.);}`;
export const COMPOSITE_VS = BG_VS;
