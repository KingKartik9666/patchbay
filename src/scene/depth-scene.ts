import type { Signals } from '../signals';

type Mesh = { buffer: WebGLBuffer; count: number };
type Program = { value: WebGLProgram; position: number; normal: number; matrix: WebGLUniformLocation | null; model: WebGLUniformLocation | null; theme: WebGLUniformLocation | null; resolution: WebGLUniformLocation | null; offset: WebGLUniformLocation | null; scene: WebGLUniformLocation | null };
const VERTEX = `attribute vec3 aPosition;attribute vec3 aNormal;uniform mat4 uMatrix;uniform mat4 uModel;varying vec3 vNormal;void main(){vNormal=(uModel*vec4(aNormal,0.0)).xyz;gl_Position=uMatrix*vec4(aPosition,1.0);}`;
const QUAD_VERTEX = `attribute vec3 aPosition;varying vec2 vUV;void main(){vUV=aPosition.xy*.5+.5;gl_Position=vec4(aPosition,1.0);}`;
const QUAD_FRAGMENT = `precision mediump float;varying vec2 vUV;uniform sampler2D uScene;uniform float uTheme;uniform vec2 uOffset;void main(){vec3 c=texture2D(uScene,clamp(vUV+uOffset,0.0,1.0)).rgb;gl_FragColor=vec4(mix(c,1.0-c,uTheme),1.0);}`;
const GLASS_FRAGMENT = `precision mediump float;varying vec3 vNormal;uniform sampler2D uScene;uniform float uTheme;uniform vec2 uResolution;uniform vec2 uOffset;
void main(){vec3 n=normalize(vNormal);float facing=abs(n.z);float rim=pow(1.0-facing,2.3);vec2 uv=gl_FragCoord.xy/uResolution+uOffset;
 vec2 bend=n.xy*(.014+.042*facing);vec3 c=texture2D(uScene,clamp(uv+bend,0.0,1.0)).rgb;
 float ribbon=pow(max(0.0,dot(n,normalize(vec3(-.45,.8,.65)))),22.0);float glint=pow(max(0.0,dot(n,normalize(vec3(.7,-.1,.65)))),70.0);
 c=clamp(c*.96-vec3(rim*.48+ribbon*.65+glint*.45)+vec3(.04*facing),.015,.985);gl_FragColor=vec4(mix(c,1.0-c,uTheme),1.0);}`;

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
  }
  return out;
}
function matrix(x: number, y: number, z: number, scale: number, rx: number, ry: number, rz: number): Float32Array {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const ax = new Float32Array([1,0,0,0, 0,cx,sx,0, 0,-sx,cx,0, 0,0,0,1]);
  const ay = new Float32Array([cy,0,-sy,0, 0,1,0,0, sy,0,cy,0, 0,0,0,1]);
  const az = new Float32Array([cz,sz,0,0, -sz,cz,0,0, 0,0,1,0, 0,0,0,1]);
  const out = multiply(az, multiply(ay, ax));
  for (let i = 0; i < 12; i++) out[i] *= scale;
  out[12] = x; out[13] = y; out[14] = z; return out;
}
function geometry(torus: boolean): Float32Array {
  const values: number[] = [], rows = 20, columns = torus ? 14 : 28;
  const point = (u: number, v: number) => {
    const a = u * Math.PI * 2, b = v * Math.PI * (torus ? 2 : 1);
    if (torus) { const radius = 1 + .29 * Math.cos(b); return [radius * Math.cos(a), .29 * Math.sin(b), radius * Math.sin(a), Math.cos(b) * Math.cos(a), Math.sin(b), Math.cos(b) * Math.sin(a)]; }
    return [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a), Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)];
  };
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const a = point(row / rows, column / columns), b = point((row + 1) / rows, column / columns);
    const c = point((row + 1) / rows, (column + 1) / columns), d = point(row / rows, (column + 1) / columns);
    values.push(...a,...b,...c,...a,...c,...d);
  }
  return new Float32Array(values);
}

/** Three-dimensional glass meshes over a cached environment/lettering texture.
 * The existing shared ticker owns time. No library, remote asset or private RAF.
 */
export class DepthScene {
  readonly element = document.createElement('div');
  private canvas = document.createElement('canvas');
  private environment = document.createElement('canvas');
  private gl: WebGLRenderingContext | null = null;
  private quad?: Program; private glass?: Program; private quadMesh?: Mesh; private ring?: Mesh; private sphere?: Mesh;
  private texture?: WebGLTexture;
  private clock = 0; private elapsed = 1; private dark = false; private dirty = true; private disposed = false; private lost = false;
  private width = 1; private height = 1; private pointer = { x: 0, y: 0 }; private quality: Signals['quality'] = 'medium';
  private frozen = false; private draws = 0; private lastCost = 0;
  constructor() {
    this.element.className = 'depth-scene'; this.element.setAttribute('aria-hidden', 'true');
    this.canvas.id = 'depth-canvas'; this.element.append(this.canvas);
    const fallback = document.createElement('div'); fallback.className = 'depth-fallback'; fallback.innerHTML = '<span>Patchbay</span><i></i><i></i>';
    this.element.append(fallback); document.body.insertBefore(this.element, document.getElementById('app'));
    this.canvas.addEventListener('webglcontextlost', this.contextLost);
    this.canvas.addEventListener('webglcontextrestored', this.contextRestored);
    window.addEventListener('resize', this.resize);
    this.initialize(); this.resize();
    void document.fonts.ready.then(() => { if (!this.disposed) { this.paintEnvironment(); this.dirty = true; } });
  }
  get drawCount(): number { return this.draws; }
  get costMs(): number { return this.lastCost; }
  get renderer(): string { return this.gl && !this.lost ? 'WebGL' : 'Static'; }
  refreshTheme(theme: 'light' | 'dark'): void { this.dark = theme === 'dark'; this.dirty = true; this.render(); }
  update(dt: number, signals: Readonly<Signals>, themeWave = false): void {
    const freeze = signals.reducedMotion || signals.focusMode || signals.quality === 'low' || themeWave;
    if (this.quality !== signals.quality) { this.quality = signals.quality; this.resize(); }
    if (freeze !== this.frozen) { this.frozen = freeze; this.dirty = true; }
    if (!freeze) {
      this.clock += dt; this.elapsed += dt;
      const follow = 1 - Math.exp(-dt/.22);
      this.pointer.x += (signals.pointer.x-this.pointer.x)*follow; this.pointer.y += (signals.pointer.y-this.pointer.y)*follow;
      if (this.elapsed >= 1 / (signals.quality === 'high' ? 45 : 30)) this.dirty = true;
    }
    if (this.dirty) this.render();
  }
  dispose(): void {
    this.disposed = true; window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('webglcontextlost', this.contextLost); this.canvas.removeEventListener('webglcontextrestored', this.contextRestored);
    if (this.gl) { for (const mesh of [this.quadMesh, this.ring, this.sphere]) if (mesh) this.gl.deleteBuffer(mesh.buffer); for (const p of [this.quad, this.glass]) if (p) this.gl.deleteProgram(p.value); if (this.texture) this.gl.deleteTexture(this.texture); }
    this.environment.width = this.environment.height = this.canvas.width = this.canvas.height = 1; this.element.remove();
  }
  private contextLost = (event: Event): void => { event.preventDefault(); this.lost = true; this.element.dataset.renderer = 'Static'; };
  private contextRestored = (): void => { if (!this.disposed) { this.lost = false; this.initialize(); this.resize(); } };
  private initialize(): void {
    try {
      this.gl = this.canvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
      if (!this.gl) throw new Error('No WebGL context');
      this.quad = this.program(QUAD_VERTEX, QUAD_FRAGMENT); this.glass = this.program(VERTEX, GLASS_FRAGMENT);
      this.quadMesh = this.mesh(new Float32Array([-1,-1,0,0,0,1, 1,-1,0,0,0,1, 1,1,0,0,0,1, -1,-1,0,0,0,1, 1,1,0,0,0,1, -1,1,0,0,0,1]));
      this.ring = this.mesh(geometry(true)); this.sphere = this.mesh(geometry(false)); this.texture = this.gl.createTexture()!;
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR); this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE); this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
      this.element.dataset.renderer = 'WebGL';
    } catch { this.gl = null; this.element.dataset.renderer = 'Static'; }
  }
  private program(vertex: string, fragment: string): Program {
    const gl = this.gl!, value = gl.createProgram()!;
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader compile failed');
      gl.attachShader(value, shader); gl.deleteShader(shader);
    }
    gl.linkProgram(value); if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(value) || 'Shader link failed');
    return { value, position: gl.getAttribLocation(value, 'aPosition'), normal: gl.getAttribLocation(value, 'aNormal'), matrix: gl.getUniformLocation(value, 'uMatrix'), model: gl.getUniformLocation(value, 'uModel'), theme: gl.getUniformLocation(value, 'uTheme'), resolution: gl.getUniformLocation(value, 'uResolution'), offset: gl.getUniformLocation(value, 'uOffset'), scene: gl.getUniformLocation(value, 'uScene') };
  }
  private mesh(values: Float32Array): Mesh { const gl = this.gl!, buffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW); return { buffer, count: values.length / 6 }; }
  private resize = (): void => {
    if (this.disposed) return;
    this.width = innerWidth; this.height = innerHeight;
    const cap = this.quality === 'low' ? .65 : this.quality === 'high' ? 1.25 : 1;
    const ratio = Math.min(devicePixelRatio || 1, cap, Math.sqrt(1_600_000 / (this.width * this.height)));
    this.canvas.width = this.environment.width = Math.max(1, Math.floor(this.width * ratio));
    this.canvas.height = this.environment.height = Math.max(1, Math.floor(this.height * ratio));
    this.paintEnvironment(); this.dirty = true;
  };
  private paintEnvironment(): void {
    const context = this.environment.getContext('2d'); if (!context) return;
    const w = this.environment.width, h = this.environment.height, ratio = w / this.width;
    context.setTransform(ratio,0,0,ratio,0,0);
    const base = context.createLinearGradient(0,0,this.width,this.height); base.addColorStop(0,'#eeeeee'); base.addColorStop(.42,'#d9d9d9'); base.addColorStop(1,'#999999');
    context.fillStyle = base; context.fillRect(0,0,this.width,this.height);
    const light = context.createRadialGradient(this.width*.75,30,0,this.width*.75,30,this.width*.65); light.addColorStop(0,'#ffffffc0'); light.addColorStop(1,'#ffffff00');
    context.fillStyle = light; context.fillRect(0,0,this.width,this.height);
    context.save(); context.translate(this.width*.53, Math.min(220,this.height*.28)); context.rotate(-.018);
    context.font = `850 ${Math.min(178,this.width*.155)}px "Nunito Variable", sans-serif`; context.textAlign = 'center';
    for (let i = 8; i > 0; i--) { context.fillStyle = `rgba(35,35,35,${.06+i*.005})`; context.fillText('Patchbay',i*.65,i*.95); }
    context.fillStyle = '#252525'; context.fillText('Patchbay',0,0); context.restore();
    if (this.gl && this.texture && !this.lost) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D,this.texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.environment); }
    this.dirty = true;
  }
  private bind(program: Program, mesh: Mesh): void {
    const gl = this.gl!; gl.useProgram(program.value); gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
    gl.enableVertexAttribArray(program.position); gl.vertexAttribPointer(program.position,3,gl.FLOAT,false,24,0);
    if (program.normal >= 0) { gl.enableVertexAttribArray(program.normal); gl.vertexAttribPointer(program.normal,3,gl.FLOAT,false,24,12); }
    gl.uniform1f(program.theme,this.dark?1:0); gl.uniform1i(program.scene,0); gl.uniform2f(program.resolution,this.canvas.width,this.canvas.height);
    gl.uniform2f(program.offset,-this.pointer.x*.006,(this.pointer.y*3+Math.sin(this.clock*.25)*2)/this.height);
  }
  private render(): void {
    this.dirty = false; this.elapsed = 0;
    if (!this.gl || this.lost || this.disposed || !this.quad || !this.glass) return;
    const started = performance.now(), gl = this.gl; gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.disable(gl.DEPTH_TEST); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this.texture!);
    this.bind(this.quad,this.quadMesh!); gl.drawArrays(gl.TRIANGLES,0,this.quadMesh!.count);
    gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
    const aspect = this.width/this.height, focal = 1/Math.tan(.62/2), near=.1, far=40;
    const projection = new Float32Array([focal/aspect,0,0,0, 0,focal,0,0, 0,0,(far+near)/(near-far),-1, 0,0,2*far*near/(near-far),0]);
    const drift = Math.sin(this.clock*.3)*.07, orbit = this.clock*.045;
    const shapes: [Mesh,number,number,number,number,number,number,number][] = [
      [this.ring!, -.45, 1.4+drift,-7.1, .63,1.08,orbit+.25,.15],
      [this.ring!, aspect*1.25, -.45-drift,-7.4, 1.06,.55,orbit-.6,-.38],
      [this.sphere!, -aspect*1.6, -.7+drift,-7.6,.95,.1,orbit,0],
      [this.ring!, -aspect*2.1, 1.95-drift,-8.0,.42,.85,-orbit,.4],
    ];
    for (const [mesh,x,y,z,size,rx,ry,rz] of shapes) {
      this.bind(this.glass,mesh); const model = matrix(x+this.pointer.x*.13,y-this.pointer.y*.1,z,size,rx+this.pointer.y*.06,ry+this.pointer.x*.12,rz);
      gl.uniformMatrix4fv(this.glass.model,false,model); gl.uniformMatrix4fv(this.glass.matrix,false,multiply(projection,model)); gl.drawArrays(gl.TRIANGLES,0,mesh.count);
    }
    this.draws++; this.lastCost = performance.now()-started;
    this.canvas.dataset.draws = String(this.draws); this.canvas.dataset.motion = this.frozen ? 'still' : 'floating';
  }
}
