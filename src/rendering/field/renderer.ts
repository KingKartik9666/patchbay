import type { MachineDef } from '../../domain/contracts';
import type { FieldCanvasProps } from '../../components/FieldCanvas';
import {
  type Vec3,
  POSES,
  add,
  camera,
  inverseDirection,
  project,
  ray,
  rigid,
  scale,
  sub,
  transformPoint,
} from './camera';
import { BEZEL_PROFILE, JACK_PROFILE, JACK_ZONES, QUAD, fittings, lathe, tube } from './geometry';
import {
  CABLE_CAPACITY,
  CABLE_FLOATS,
  JACK_CAPACITY,
  JACK_FLOATS,
  SceneAnimator,
  type SceneModel,
  deriveScene,
  liveSignals,
} from './scene';
import * as S from './shaders';
import { FIELD_SPRINGS, Spring, Spring2 } from './springs';
import { type FieldMode, type FieldTier, decideMode, fieldHost, fieldRequests } from './bridge';
import { REST, installPointer, pointer } from './pointer';
import { GLASS_KIND, clearRims, glassRegistry, writeRims } from './glass-registry';
import { FLOOR_COLOUR, type Palette, mixPalette } from './palette';
import { DYNAMIC, frameBudget, nextRenderScale, type RenderScaleState } from '../pacing';
import { onLaunchSettled } from '../../launch/launch';

const FLOOR_COUNT = 22 * 12;
const CABLE_RADIUS = 0.045;

export interface DrawFrame {
  viewProj: Float32Array;
  group: Float32Array;
  eye: Vec3;
  right: Vec3;
  up: Vec3;
  light: Vec3;
  palette: Palette;
  pool: [number, number, number, number];
  sweep: [number, number];
  horizon: number;
  jacks: Float32Array;
  jackCount: number;
  cables: Float32Array;
  cableCount: number;
  live: number;
  haloRadius: number;
  ferrule: number;
  collar: number;
  bead: { position: Vec3; screen: [number, number] } | null;
  rects: { x: number; y: number; w: number; h: number; radius: number; kind: number }[];
  dim: number;
  theme: number;
  css: { w: number; h: number };
  outScale: number;
  fboScale: number;
}

class NoContext extends Error {}

interface Program {
  program: WebGLProgram;
  locations: Map<string, WebGLUniformLocation | null>;
}

/** WebGL2 resources and the two passes. No library; every mesh is procedural. */
export class FieldRenderer {
  readonly gl: WebGL2RenderingContext;
  private programs: Record<
    'bg' | 'floor' | 'jack' | 'cable' | 'fitting' | 'halo' | 'bead' | 'composite',
    Program
  >;
  private empty: WebGLVertexArrayObject;
  private floor: { vao: WebGLVertexArrayObject; count: number };
  private jack: { vao: WebGLVertexArrayObject; count: number };
  private cable: { vao: WebGLVertexArrayObject; count: number };
  private fitting: { vao: WebGLVertexArrayObject; count: number };
  private halo: { vao: WebGLVertexArrayObject; count: number };
  private quad: WebGLVertexArrayObject;
  private jackBuffer: WebGLBuffer;
  private cableBuffer: WebGLBuffer;
  private haloBuffer: WebGLBuffer;
  private resources: { buffers: WebGLBuffer[]; vaos: WebGLVertexArrayObject[] } = {
    buffers: [],
    vaos: [],
  };
  private texture: WebGLTexture | null = null;
  private depth: WebGLRenderbuffer | null = null;
  private fbo: WebGLFramebuffer | null = null;
  private fboSize = [0, 0];
  private rectData = new Float32Array(32);
  private kindData = new Float32Array(16);

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: true,
      preserveDrawingBuffer: false,
      powerPreference: 'default',
    });
    if (!gl) throw new NoContext('WebGL2 is unavailable');
    this.gl = gl;
    this.programs = {
      bg: this.compile(S.BG_VS, S.BG_FS),
      floor: this.compile(S.FLOOR_VS, S.FLOOR_FS),
      jack: this.compile(S.JACK_VS, S.JACK_FS),
      cable: this.compile(S.CABLE_VS, S.CABLE_FS),
      fitting: this.compile(S.FITTING_VS, S.CABLE_FS),
      halo: this.compile(S.CABLE_VS, S.HALO_FS),
      bead: this.compile(S.BEAD_VS, S.BEAD_FS),
      composite: this.compile(S.COMPOSITE_VS, S.COMPOSITE_FS),
    };
    this.empty = this.vao(() => undefined);
    const floorMesh = lathe(BEZEL_PROFILE, [], 16, 'y'),
      jackMesh = lathe(JACK_PROFILE, JACK_ZONES, 32, 'z'),
      tubeMesh = tube(8, 32),
      fitMesh = fittings(12);
    this.jackBuffer = this.buffer(JACK_CAPACITY * JACK_FLOATS * 4);
    this.cableBuffer = this.buffer(CABLE_CAPACITY * CABLE_FLOATS * 4);
    this.haloBuffer = this.buffer(CABLE_FLOATS * 4);
    this.floor = this.mesh(floorMesh, () => {
      this.attrib(0, 3, 7, 0);
      this.attrib(1, 3, 7, 3);
    });
    this.jack = this.mesh(jackMesh, () => {
      this.attrib(0, 3, 7, 0);
      this.attrib(1, 3, 7, 3);
      this.attrib(2, 1, 7, 6);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.jackBuffer);
      this.attrib(3, 4, JACK_FLOATS, 0, 1);
      this.attrib(4, 4, JACK_FLOATS, 4, 1);
      this.attrib(5, 1, JACK_FLOATS, 8, 1);
    });
    const instances = (buffer: WebGLBuffer) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (let i = 0; i < 4; i++) this.attrib(1 + i, 3, CABLE_FLOATS, i * 3, 1);
      this.attrib(5, 4, CABLE_FLOATS, 12, 1);
      this.attrib(6, 2, CABLE_FLOATS, 16, 1);
    };
    this.cable = this.mesh(tubeMesh, () => {
      this.attrib(0, 2, 2, 0);
      instances(this.cableBuffer);
    });
    this.halo = this.mesh(tubeMesh, () => {
      this.attrib(0, 2, 2, 0);
      instances(this.haloBuffer);
    });
    this.fitting = this.mesh(fitMesh, () => {
      this.attrib(0, 3, 6, 0);
      this.attrib(7, 3, 6, 3);
      instances(this.cableBuffer);
    });
    const quadBuffer = this.buffer(QUAD);
    this.quad = this.vao(() => {
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      this.attrib(0, 2, 2, 0);
    });
  }

  private compile(vertex: string, fragment: string): Program {
    const gl = this.gl,
      program = gl.createProgram(),
      shaders = [
        [gl.VERTEX_SHADER, vertex],
        [gl.FRAGMENT_SHADER, fragment],
      ] as const;
    const compiled = shaders.map(([type, source]) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
      return shader;
    });
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost())
      throw new Error(
        `Field shader failed: ${gl.getProgramInfoLog(program)} ${compiled.map((s) => gl.getShaderInfoLog(s)).join(' ')}`,
      );
    for (const shader of compiled) gl.deleteShader(shader);
    return { program, locations: new Map() };
  }
  private buffer(data: number | BufferSource, target: GLenum = this.gl.ARRAY_BUFFER): WebGLBuffer {
    const gl = this.gl,
      buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    if (typeof data === 'number') gl.bufferData(target, data, gl.DYNAMIC_DRAW);
    else gl.bufferData(target, data, gl.STATIC_DRAW);
    this.resources.buffers.push(buffer);
    return buffer;
  }
  private vao(setup: () => void): WebGLVertexArrayObject {
    const vao = this.gl.createVertexArray();
    this.gl.bindVertexArray(vao);
    setup();
    this.gl.bindVertexArray(null);
    this.resources.vaos.push(vao);
    return vao;
  }
  private mesh(
    mesh: { data: Float32Array<ArrayBuffer>; index: Uint16Array<ArrayBuffer> },
    setup: () => void,
  ): { vao: WebGLVertexArrayObject; count: number } {
    const gl = this.gl,
      data = this.buffer(mesh.data),
      index = this.buffer(mesh.index, gl.ELEMENT_ARRAY_BUFFER);
    const vao = this.vao(() => {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      gl.bindBuffer(gl.ARRAY_BUFFER, data);
      setup();
    });
    return { vao, count: mesh.index.length };
  }
  private attrib(location: number, size: number, stride: number, offset: number, divisor = 0) {
    const gl = this.gl;
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4);
    gl.vertexAttribDivisor(location, divisor);
  }

  private use(program: Program): (name: string, value: number | Float32List) => void {
    const gl = this.gl;
    gl.useProgram(program.program);
    return (name, value) => {
      let location = program.locations.get(name);
      if (location === undefined) {
        location = gl.getUniformLocation(program.program, name);
        program.locations.set(name, location);
      }
      if (!location) return;
      if (typeof value === 'number') gl.uniform1f(location, value);
      else if (value.length === 2) gl.uniform2fv(location, value);
      else if (value.length === 3) gl.uniform3fv(location, value);
      else if (value.length === 4) gl.uniform4fv(location, value);
      else gl.uniformMatrix4fv(location, false, value);
    };
  }

  /** Resizes the drawing buffer and the half-resolution scene target. */
  resize(width: number, height: number, outScale: number, fboScale: number): void {
    const gl = this.gl,
      w = Math.max(1, Math.round(width * outScale)),
      h = Math.max(1, Math.round(height * outScale)),
      fw = Math.max(1, Math.round(width * fboScale)),
      fh = Math.max(1, Math.round(height * fboScale));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    if (fw === this.fboSize[0] && fh === this.fboSize[1]) return;
    this.releaseTarget();
    this.fboSize = [fw, fh];
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texStorage2D(
      gl.TEXTURE_2D,
      Math.min(7, Math.floor(Math.log2(Math.max(fw, fh))) + 1),
      gl.RGBA8,
      fw,
      fh,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, fw, fh);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private releaseTarget(): void {
    const gl = this.gl;
    gl.deleteFramebuffer(this.fbo);
    gl.deleteRenderbuffer(this.depth);
    gl.deleteTexture(this.texture);
    this.fbo = this.depth = this.texture = null;
  }

  draw(f: DrawFrame): void {
    const gl = this.gl,
      p = f.palette;
    if (gl.isContextLost() || !this.fbo) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.fboSize[0], this.fboSize[1]);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    let set = this.use(this.programs.bg);
    set('uTop', p.top);
    set('uBot', p.bot);
    set('uHaze', p.haze);
    set('uHz', f.horizon);
    gl.bindVertexArray(this.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    const lighting = () => {
      set('uVP', f.viewProj);
      set('uG', f.group);
      set('uEye', f.eye);
      set('uL', f.light);
      set('uLc', p.key);
      set('uSky', p.sky);
      set('uGnd', p.gnd);
      set('uFog', p.fog);
      set('uAmb', p.amb);
    };
    set = this.use(this.programs.floor);
    lighting();
    set('uBez', p.bezel);
    set('uPool', f.pool);
    set('uSweep', f.sweep);
    gl.bindVertexArray(this.floor.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.floor.count, gl.UNSIGNED_SHORT, 0, FLOOR_COUNT);
    if (f.jackCount) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.jackBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.jacks, 0, f.jackCount * JACK_FLOATS);
      set = this.use(this.programs.jack);
      lighting();
      set('uJack', p.jack);
      set('uLive', p.live);
      set('uFault', p.fault);
      set('uCollar', f.collar);
      gl.bindVertexArray(this.jack.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, this.jack.count, gl.UNSIGNED_SHORT, 0, f.jackCount);
    }
    if (f.cableCount) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cableBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.cables, 0, f.cableCount * CABLE_FLOATS);
      set = this.use(this.programs.cable);
      lighting();
      set('uR', CABLE_RADIUS);
      set('uCab', p.cable);
      set('uLive', p.live);
      set('uSpec', [0.15, 24]);
      gl.bindVertexArray(this.cable.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, this.cable.count, gl.UNSIGNED_SHORT, 0, f.cableCount);
      set = this.use(this.programs.fitting);
      lighting();
      set('uFer', f.ferrule);
      set('uCab', p.sleeve);
      set('uLive', p.live);
      set('uSpec', [0.5, 40]);
      gl.bindVertexArray(this.fitting.vao);
      gl.drawElementsInstanced(
        gl.TRIANGLES,
        this.fitting.count,
        gl.UNSIGNED_SHORT,
        0,
        f.cableCount,
      );
    }
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    if (f.live >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.haloBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.cables, f.live * CABLE_FLOATS, CABLE_FLOATS);
      set = this.use(this.programs.halo);
      set('uVP', f.viewProj);
      set('uG', f.group);
      set('uEye', f.eye);
      set('uR', f.haloRadius);
      set('uLive', p.live);
      set('uHalo', p.halo);
      gl.bindVertexArray(this.halo.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, this.halo.count, gl.UNSIGNED_SHORT, 0, 1);
    }
    if (f.bead) {
      set = this.use(this.programs.bead);
      set('uVP', f.viewProj);
      set('uBp', f.bead.position);
      set('uRt', f.right);
      set('uUp', f.up);
      set('uBs', 0.11);
      set('uLive', p.live);
      gl.bindVertexArray(this.quad);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.generateMipmap(gl.TEXTURE_2D);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    set = this.use(this.programs.composite);
    const rects = f.rects.slice(0, 8);
    this.rectData.fill(0);
    this.kindData.fill(0);
    rects.forEach((r, i) => {
      this.rectData.set([r.x, r.y, r.w, r.h], i * 4);
      this.kindData.set([r.radius, r.kind], i * 2);
    });
    const program = this.programs.composite.program;
    gl.uniform4fv(gl.getUniformLocation(program, 'uR'), this.rectData);
    gl.uniform2fv(gl.getUniformLocation(program, 'uK'), this.kindData);
    gl.uniform1i(gl.getUniformLocation(program, 'uN'), rects.length);
    gl.uniform1i(gl.getUniformLocation(program, 'uS'), 0);
    gl.activeTexture(gl.TEXTURE0);
    set('uC', [f.css.w, f.css.h]);
    set('uT', this.fboSize);
    set('uOut', f.outScale);
    set('uH', this.canvas.height);
    set('uLod', S.frostLod(f.fboScale));
    set('uDim', 1 - 0.22 * f.dim);
    set('uDs', 0.2 * f.dim);
    set('uTh', f.theme);
    set('uBd', f.bead ? [...f.bead.screen, p.glowStrength] : [0, 0, 0]);
    set('uGc', p.glow);
    set('uFl', FLOOR_COLOUR);
    gl.bindVertexArray(this.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    this.releaseTarget();
    for (const buffer of this.resources.buffers) gl.deleteBuffer(buffer);
    for (const vao of this.resources.vaos) gl.deleteVertexArray(vao);
    for (const program of Object.values(this.programs)) gl.deleteProgram(program.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const EMPTY_SCENE: SceneModel = {
  kind: 'mealy',
  jacks: [],
  cables: [],
  dropped: { jacks: 0, cables: 0 },
  jackSize: 1,
};
const scenes = new WeakMap<MachineDef, SceneModel>();
const sceneOf = (machine: MachineDef) => {
  let scene = scenes.get(machine);
  if (!scene) scenes.set(machine, (scene = deriveScene(machine)));
  return scene;
};
/** Machine-load dolly: a critically damped impulse that peaks 5% closer. */
const DOLLY_KICK = -0.05 * ((2 * Math.PI) / FIELD_SPRINGS.drift.duration) * Math.E;
/** A theme switch the page shows at once: the wave and the reduced-motion fade
 * snapshot the new theme, and the instant path (tests, captures) has no tween. */
const themeSwap = () => {
  const root = document.documentElement;
  return (
    root.hasAttribute('data-theme-wave') ||
    root.hasAttribute('data-theme-fade') ||
    root.hasAttribute('data-theme-instant')
  );
};

/** Owns the field's lifetime, mode, frame policy and per-frame derivation. It
 * reads props and playback refs each frame and never sets React state per frame. */
export class FieldEngine {
  private props: FieldCanvasProps | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private renderer: FieldRenderer | null = null;
  private used = false;
  private started = false;
  private detach: (() => void)[] = [];
  private clockOff: (() => void) | null = null;
  private canvasObserver: ResizeObserver | null = null;
  private mode: FieldMode = 'off';
  private tier: FieldTier = 'static';
  private reason: string | null = 'unmounted';
  private webgl2 = true;
  private losses = 0;
  private autoTier: FieldTier | null = null;
  private restoreTimer = 0;
  private captured = false;
  private stillQueued = false;
  private css = { w: 0, h: 0 };
  private outScale = 1;
  private fboScale = 0;
  private anim = new SceneAnimator();
  private shown: MachineDef | undefined | null = null;
  private yaw = new Spring(FIELD_SPRINGS.drift, 0);
  private pitch = new Spring(FIELD_SPRINGS.drift, 0);
  private distance = new Spring(FIELD_SPRINGS.drift, 10);
  private shift = new Spring(FIELD_SPRINGS.drift, 0);
  private size = new Spring(FIELD_SPRINGS.drift, 1);
  private dollyKick = new Spring(FIELD_SPRINGS.drift, 0);
  private dollyHold = new Spring(FIELD_SPRINGS.drift, 0);
  private dim = new Spring(FIELD_SPRINGS.drift, 0);
  private light = new Spring2(FIELD_SPRINGS.light, REST.x, REST.y);
  private parallax = new Spring2(FIELD_SPRINGS.parallax);
  private theme = { from: 0, to: 0, start: -Infinity };
  private sweep = -Infinity;
  private wasDone = false;
  private running = false;
  private settled = true;
  /** Something asked for a frame (a prop, a request, playback) since the last one. */
  private dirty = true;
  private lastActive = -Infinity;
  private draws: number[] = [];
  /** Dynamic resolution: the scale multiplier and the gaps of this window. */
  private scale: RenderScaleState = { dyn: 1, good: 0, lastResize: -Infinity };
  private gaps: number[] = [];
  private scaleReason: string | null = null;
  /** Boot work (fonts, first renders, the diagram build) is not a GPU verdict. */
  private warmUntil = Infinity;
  /** Neither is the launch; sampling starts 500 ms after it settles. */
  private launchReadyAt = Infinity;
  private forced: MediaQueryList | null = null;

  constructor(private readonly remount: () => void) {}

  update(props: FieldCanvasProps): void {
    const previous = this.props;
    this.props = props;
    if (!previous) {
      this.theme = {
        from: +(props.theme === 'light'),
        to: +(props.theme === 'light'),
        start: -Infinity,
      };
      return;
    }
    if (previous.clock !== props.clock && this.started) {
      this.stop();
      this.start();
      return;
    }
    const now = performance.now();
    if (previous.theme !== props.theme) {
      const to = +(props.theme === 'light'),
        swap = themeSwap();
      this.theme =
        props.reducedMotion || swap
          ? { from: to, to, start: -Infinity }
          : { from: this.themeAt(now), to, start: now };
      // The theme wave snapshots the page right after this update: the field
      // must already show the new palette in that frame, not tween into it.
      if (swap) this.drawNow();
    }
    if (
      previous.machine &&
      props.machine &&
      previous.machine !== props.machine &&
      !props.reducedMotion
    )
      this.dollyKick.kick(DOLLY_KICK);
    if (
      previous.off !== props.off ||
      previous.quality !== props.quality ||
      previous.reducedMotion !== props.reducedMotion
    ) {
      if (props.reducedMotion) this.unsubscribe();
      // A new quality choice starts dynamic resolution afresh at full scale.
      if (previous.quality !== props.quality) {
        this.scale = { dyn: 1, good: 0, lastResize: -Infinity };
        this.scaleReason = null;
      }
      this.applyMode();
    }
    if (
      previous.machine !== props.machine ||
      previous.page !== props.page ||
      previous.panel !== props.panel ||
      previous.theme !== props.theme ||
      previous.player !== props.player ||
      previous.reducedMotion !== props.reducedMotion
    )
      this.wake();
  }

  start(): void {
    if (this.started || !this.props) return;
    this.started = true;
    const root = document.documentElement,
      forced = matchMedia('(forced-colors: active)'),
      mutations = new MutationObserver(() => {
        const captured = root.hasAttribute('data-capture');
        if (captured !== this.captured) {
          this.captured = captured;
          if (!captured) this.drawNow();
        }
        this.wake();
      });
    this.forced = forced;
    this.captured = root.hasAttribute('data-capture');
    const modeChange = () => this.applyMode();
    forced.addEventListener('change', modeChange);
    mutations.observe(root, { attributes: true, attributeFilter: ['data-capture', 'class'] });
    this.detach = [
      fieldHost.connect(this.wake),
      installPointer(this.props.clock.signals, this.wake),
      glassRegistry.onChange((sync) => {
        if (sync) this.drawNow();
        this.wake();
      }),
      this.props.clock.onStats(() => this.publish()),
      onLaunchSettled(() => {
        this.launchReadyAt = performance.now() + 500;
      }),
      () => forced.removeEventListener('change', modeChange),
      () => mutations.disconnect(),
    ];
    this.observe();
    this.applyMode(true);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    for (const off of this.detach) off();
    this.detach = [];
    this.canvasObserver?.disconnect();
    this.canvasObserver = null;
    this.teardown(false);
    clearTimeout(this.restoreTimer);
    clearRims();
    const root = document.documentElement;
    delete root.dataset.bg;
    delete root.dataset.bgScale;
    delete root.dataset.bgFps;
    delete root.dataset.bgReason;
    this.mode = 'off';
    this.tier = 'static';
    this.reason = 'unmounted';
    fieldHost.publish({ mode: 'off', scale: 0, fps: 0, tier: 'static', reason: 'unmounted' });
  }

  /** The canvas element; a new one arrives after every remount. */
  attach(canvas: HTMLCanvasElement | null): void {
    if (canvas === this.canvas && (this.renderer || !canvas)) return;
    if (canvas !== this.canvas) {
      this.teardown(false);
      this.canvas = canvas;
      this.used = false;
      canvas?.addEventListener('webglcontextlost', this.lost);
    }
    this.observe();
    if (this.started && this.mode === 'webgl') this.initGL();
  }

  /** Resizes draw synchronously inside the observer callback. */
  private observe(): void {
    this.canvasObserver?.disconnect();
    this.canvasObserver = null;
    if (!this.canvas || !this.started || typeof ResizeObserver === 'undefined') return;
    this.canvasObserver = new ResizeObserver(() => {
      this.resize();
      this.drawNow();
    });
    this.canvasObserver.observe(this.canvas);
  }

  /** Re-subscribes to the clock (or redraws the still frame) after any change. */
  readonly wake = (): void => {
    if (!this.canDraw()) return;
    this.lastActive = performance.now();
    this.dirty = true;
    if (this.props!.reducedMotion) {
      if (this.stillQueued) return;
      this.stillQueued = true;
      queueMicrotask(() => {
        this.stillQueued = false;
        this.still();
      });
    } else if (!this.clockOff) this.clockOff = this.props!.clock.subscribe(this.tick);
  };

  private canDraw(): boolean {
    return this.started && this.mode === 'webgl' && !!this.renderer && !this.captured;
  }

  private applyMode(force = false): void {
    const props = this.props;
    if (!props || !this.started) return;
    const decision = decideMode({
      off: props.off,
      forcedColors: !!this.forced?.matches,
      quality: props.quality,
      webgl2: this.webgl2,
      contextLosses: this.losses,
      autoTier: this.autoTier,
    });
    const changed =
      decision.mode !== this.mode || decision.tier !== this.tier || decision.reason !== this.reason;
    this.mode = decision.mode;
    this.tier = decision.tier;
    this.reason = decision.reason;
    if (this.mode !== 'webgl') {
      this.teardown(true);
      clearRims();
    } else if (!this.renderer) this.initGL();
    else {
      this.resize();
      this.wake();
    }
    if (changed || force) this.publish();
  }

  private initGL(): void {
    if (!this.canvas || this.renderer || !this.started || this.mode !== 'webgl') return;
    if (this.used) {
      // A canvas that has held a context cannot show the static field again.
      this.remount();
      return;
    }
    try {
      this.renderer = new FieldRenderer(this.canvas);
      this.used = true;
    } catch (error) {
      if (!(error instanceof NoContext)) {
        this.used = true;
        console.warn(error);
      }
      this.webgl2 = false;
      this.applyMode();
      return;
    }
    this.resize();
    // Skip the app's boot work (fonts, first renders, the diagram build).
    this.warmUntil = performance.now() + 2000;
    this.gaps = [];
    this.publish();
    this.drawNow();
    this.wake();
  }

  private teardown(remount: boolean): void {
    this.unsubscribe();
    this.renderer?.dispose();
    this.renderer = null;
    if (remount && this.used) {
      this.used = false;
      this.remount();
    }
  }

  private unsubscribe(): void {
    this.clockOff?.();
    this.clockOff = null;
    this.gaps = [];
  }

  private readonly lost = (event: Event): void => {
    // Our own dispose() loses its context on purpose; only a live renderer counts.
    if (!this.renderer || event.target !== this.renderer.canvas) return;
    event.preventDefault();
    this.losses++;
    this.unsubscribe();
    this.renderer = null;
    clearTimeout(this.restoreTimer);
    if (this.losses >= 2) {
      this.applyMode();
      return;
    }
    // Restore once, on a fresh canvas, after two seconds.
    this.restoreTimer = window.setTimeout(() => {
      this.restoreTimer = 0;
      this.initGL();
    }, 2000);
  };

  private resize(): void {
    const canvas = this.canvas,
      renderer = this.renderer;
    if (!canvas || !renderer) return;
    const dpr = devicePixelRatio || 1;
    this.css = { w: canvas.clientWidth || innerWidth, h: canvas.clientHeight || innerHeight };
    // Quality tiers and dynamic resolution trade pixels, never frame rate.
    const dyn = this.scale.dyn;
    this.outScale = Math.min(dpr, 1.25) * dyn;
    this.fboScale = (this.tier === 'high' ? Math.min(dpr, 1.5) : Math.min(dpr, 1)) * 0.5 * dyn;
    renderer.resize(this.css.w, this.css.h, this.outScale, this.fboScale);
  }

  private publish(): void {
    const now = performance.now();
    while (this.draws.length && now - this.draws[0] > 1000) this.draws.shift();
    const webgl = this.mode === 'webgl' && !!this.renderer,
      status = {
        mode: this.mode,
        scale: webgl ? Math.round(this.fboScale * 100) / 100 : 0,
        fps: webgl ? this.draws.length : 0,
        tier: this.tier,
        reason: this.statusReason(webgl),
      },
      root = document.documentElement;
    root.dataset.bg = status.mode;
    root.dataset.bgScale = String(status.scale);
    root.dataset.bgFps = String(status.fps);
    if (status.reason) root.dataset.bgReason = status.reason;
    else delete root.dataset.bgReason;
    fieldHost.publish(status);
  }

  private themeAt(now: number): number {
    const t = Math.min(1, Math.max(0, (now - this.theme.start) / 700));
    return this.theme.from + (this.theme.to - this.theme.from) * ease(t);
  }

  /** The mode's reason, or else the dynamic-resolution note while it applies. */
  private statusReason(webgl: boolean): string | null {
    if (this.reason === 'auto-tier' && this.scaleReason) return `auto-tier · ${this.scaleReason}`;
    return this.reason ?? (webgl ? this.scaleReason : null);
  }

  /** Every clock frame while anything moves, at the display's refresh rate;
   * nothing while the scene rests, and off the clock after two idle seconds. */
  private readonly tick = (dt: number): void => {
    if (!this.canDraw()) {
      this.unsubscribe();
      return;
    }
    const now = performance.now(),
      active =
        (!pointer.rest && now - pointer.moved < 1500) ||
        !this.settled ||
        this.running ||
        now - this.sweep < 1200 ||
        now - this.theme.start < 700 ||
        glassRegistry.refreshAnimating();
    if (active) this.lastActive = now;
    if (active || this.dirty) {
      this.frame(dt, now, false);
      if (active && dt > 0) this.pace(dt * 1000, now);
    } else if (now - this.lastActive > 2000) this.unsubscribe();
  };

  /** Dynamic resolution over windows of active frames: lower the render scale
   * before ever dropping frames, and step the tier down only at the floor. */
  private pace(gap: number, now: number): void {
    if (now < this.warmUntil || now < this.launchReadyAt || themeSwap()) {
      this.gaps = [];
      return;
    }
    this.gaps.push(gap);
    if (this.gaps.length < DYNAMIC.window) return;
    const signals = this.props!.clock.signals,
      budget = frameBudget(signals.targetFps, signals.refreshHz || signals.displayHz),
      decision = nextRenderScale(this.scale, this.gaps, budget, now);
    this.gaps = [];
    this.scale = { dyn: decision.dyn, good: decision.good, lastResize: decision.lastResize };
    if (!decision.reason) return;
    this.scaleReason = decision.stepTier || decision.dyn < 1 ? decision.reason : null;
    if (decision.stepTier) {
      this.autoTier = this.tier === 'high' ? 'medium' : 'static';
      this.warmUntil = now + 500;
      this.applyMode(true);
      return;
    }
    this.resize();
    this.drawNow();
    this.publish();
  }

  private drawNow(): void {
    if (!this.canDraw()) return;
    if (this.props!.reducedMotion) this.still();
    else this.frame(0, performance.now(), false);
  }

  /** Reduced motion: the rest light and the Bench pose, redrawn only on change. */
  private still(): void {
    if (!this.canDraw()) return;
    this.frame(0, performance.now(), true);
  }

  private frame(dt: number, now: number, still: boolean): void {
    const props = this.props!,
      renderer = this.renderer!;
    if (!this.css.w || !this.css.h) return;
    const shown = fieldRequests.preview ?? props.machine;
    if (shown !== this.shown) {
      this.shown = shown;
      this.anim.setModel(shown ? sceneOf(shown) : EMPTY_SCENE, still);
    }
    const machine = props.machine,
      snapshot = props.player.getSnapshot(),
      live =
        machine && shown === machine
          ? liveSignals({
              start: machine.start,
              cursor: snapshot.cursor,
              playing: snapshot.playing,
              steps: props.player.trace.steps,
              travel: props.player.travel.current,
              fault: props.player.trace.fault,
            })
          : null;
    if (live?.done && !this.wasDone && !still) this.sweep = now;
    this.wasDone = !!live?.done;
    this.running = !!live?.running;
    const focused = document.activeElement?.matches('input,textarea,select') ?? false,
      calm = this.running || pointer.overWork || focused ? 0.3 : 1,
      resting = pointer.rest || still,
      pose = still ? POSES.bench : POSES[props.page],
      hint = fieldRequests.navHint;
    let leanYaw = 0,
      leanPitch = 0;
    if (hint && !still) {
      if (hint in POSES && hint !== props.page) {
        const target = POSES[hint as keyof typeof POSES],
          dy = target.yaw - pose.yaw,
          dp = target.pitch - pose.pitch,
          length = Math.hypot(dy, dp) || 1;
        leanYaw = dy / length;
        leanPitch = dp / length;
      } else if (!(hint in POSES)) leanYaw = 0.8;
    }
    this.yaw.target = pose.yaw + leanYaw;
    this.pitch.target = pose.pitch + leanPitch;
    this.distance.target = pose.distance;
    this.shift.target = pose.shift;
    this.size.target = pose.scale;
    this.dollyHold.target = live?.done && !still ? 0.04 : 0;
    this.dim.target = props.panel ? 1 : 0;
    this.light.set(resting ? REST.x : pointer.x, resting ? REST.y : pointer.y);
    this.parallax.set(resting ? 0 : pointer.x * calm, resting ? 0 : pointer.y * calm);
    const springs = [
      this.yaw,
      this.pitch,
      this.distance,
      this.shift,
      this.size,
      this.dollyKick,
      this.dollyHold,
      this.dim,
    ];
    if (still) {
      for (const spring of springs) spring.snap();
      this.dollyKick.snap(0);
      this.light.snap(this.light.x.target, this.light.y.target);
      this.parallax.snap(0, 0);
      this.anim.snap();
      this.theme.start = -Infinity;
      this.theme.from = this.theme.to;
    } else {
      for (const spring of springs) spring.step(dt);
      this.light.step(dt);
      this.parallax.step(dt);
    }
    const theme = this.themeAt(now),
      palette = mixPalette(theme),
      { w, h } = this.css,
      px = this.parallax.x.value,
      py = this.parallax.y.value,
      worldPerPx = (2 * 13 * (this.distance.value / 10) * Math.tan((14 * Math.PI) / 180)) / h,
      cam = camera({
        yaw: this.yaw.value + 2.5 * px,
        pitch: this.pitch.value - 1.8 * py,
        distance: this.distance.value,
        dolly: this.dollyKick.value + this.dollyHold.value,
        slideX: 12 * worldPerPx * px,
        slideY: 12 * worldPerPx * py,
        aspect: w / h,
      }),
      groupScale = this.size.value,
      group = rigid(-12, -6, [1.1 + this.shift.value, 0.2, -3], groupScale),
      origin: Vec3 = [group[12], group[13], group[14]],
      lx = this.light.x.value,
      ly = this.light.y.value,
      lightDir = ray(cam, lx, ly),
      lightWorld = add(cam.eye, scale(lightDir, (1.5 - cam.eye[2]) / Math.min(lightDir[2], -1e-3)));
    // The floor pool sits where the light's ray meets the socket floor.
    let poolT = lightDir[1] < -1e-3 ? (-2.2 - cam.eye[1]) / lightDir[1] : Infinity;
    const farT = (-13.5 - cam.eye[2]) / Math.min(lightDir[2], -1e-3);
    if (!(poolT < farT)) poolT = farT;
    const pool = add(cam.eye, scale(lightDir, poolT)),
      sweepT = (now - this.sweep) / 1200,
      horizon = project(cam, [0, -2.2, -14]);
    this.anim.update({
      dt: still ? 0 : dt,
      cam,
      group,
      width: w,
      height: h,
      pointer: resting ? null : { x: lx, y: ly },
      light: scale(inverseDirection(group, sub(lightWorld, origin)), 1 / groupScale ** 2),
      calm: this.running || pointer.overWork ? 0.4 : 1,
      hover: fieldRequests.hover,
      live,
    });
    let bead: DrawFrame['bead'] = null;
    if (live?.bead && !still) {
      const local = this.anim.beadPosition(live.bead.cable, live.bead.progress);
      if (local) {
        const position = transformPoint(group, local),
          screen = project(cam, position);
        if (screen.w > 0)
          bead = { position, screen: [((screen.x + 1) / 2) * w, ((1 - screen.y) / 2) * h] };
      }
    }
    const liveIndex = live?.cable ? (this.anim.cableIndex.get(live.cable) ?? -1) : -1,
      groupDistance = Math.hypot(...sub(origin, cam.eye)),
      animating = glassRegistry.refreshAnimating();
    renderer.draw({
      viewProj: cam.viewProj,
      group,
      eye: cam.eye,
      right: cam.right,
      up: cam.up,
      light: lightWorld,
      palette,
      pool: [pool[0], pool[1], pool[2], resting ? 0.35 : 1],
      sweep:
        sweepT >= 0 && sweepT < 1
          ? [-13 + 26 * ease(sweepT), Math.sin(Math.PI * sweepT) * 1.2]
          : [0, 0],
      horizon: (horizon.y + 1) / 2,
      jacks: this.anim.jackData,
      jackCount: this.anim.jackCount,
      cables: this.anim.cableData,
      cableCount: this.anim.cableCount,
      live: liveIndex,
      haloRadius: CABLE_RADIUS + (6 * 2 * groupDistance * cam.tanHalf) / h / groupScale,
      ferrule: this.anim.ferrule.value,
      collar: this.anim.collar.value,
      bead,
      rects: glassRegistry.rects().map((entry) => ({
        x: entry.x,
        y: entry.y,
        w: entry.w,
        h: entry.h,
        radius: entry.radius,
        kind: GLASS_KIND[entry.kind],
      })),
      dim: this.dim.value,
      theme,
      css: this.css,
      outScale: this.outScale,
      fboScale: this.fboScale,
    });
    writeRims(((lx + 1) / 2) * w, ((1 - ly) / 2) * h, still);
    this.dirty = false;
    this.draws.push(now);
    if (this.draws.length > 512) this.draws.splice(0, 256);
    this.settled =
      springs.every((spring) => spring.settled()) &&
      this.light.settled() &&
      this.parallax.settled() &&
      this.anim.settled() &&
      !animating;
  }
}
