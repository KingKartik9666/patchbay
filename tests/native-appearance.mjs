import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { release } from 'node:os';
import { resolve } from 'node:path';
import {
  launchNative,
  artifacts,
  root,
  runSuffix,
  instantTheme,
  screencast,
} from './helpers/native.mjs';
import { decodePng } from './helpers/png.mjs';

const run = await launchNative(),
  { page } = run;
const checks = [],
  errors = [],
  sizes = [],
  legibility = [],
  deferred = [],
  field = {},
  plates = {},
  titles = {};
page.on('pageerror', (error) => errors.push(error.message));
const settle = () =>
  page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  );
// Lets a class or attribute change start its transitions before settling.
const frames = () =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
async function route(name, selector) {
  await page.locator(`[data-route=${name}]`).click();
  await page.locator(selector).waitFor();
  await settle();
}
const channel = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const relative = ([r, g, b]) =>
  channel(r / 255) * 0.2126 + channel(g / 255) * 0.7152 + channel(b / 255) * 0.0722;
const hexChannels = (hex) => {
  let value = hex.replace('#', '');
  if (value.length === 3) value = [...value].map((char) => char + char).join('');
  return value.match(/../g).map((part) => parseInt(part, 16));
};
const ratio = (x, y) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
const contrast = (a, b) => ratio(relative(hexChannels(a)), relative(hexChannels(b)));
const cssChannels = (color) =>
  color
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number);
const alphaOf = (color) => {
  const match = color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/);
  return match ? Number(match[1]) : /^rgb\(/.test(color) ? 1 : NaN;
};
const frame = () =>
  page.evaluate(() => {
    const root = document.documentElement;
    return {
      backdrop: root.dataset.backdrop,
      reducedTransparency: root.classList.contains('reduced-transparency'),
      html: getComputedStyle(root).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
    };
  });
// Under Mica the page is clear and body carries the tint; otherwise both are opaque.
function assertFrame(state, mica, label) {
  assert.equal(state.backdrop, mica ? 'mica' : 'solid', `${label}: data-backdrop`);
  if (mica) {
    assert.equal(state.html, 'rgba(0, 0, 0, 0)', `${label}: html is clear over Mica`);
    const alpha = alphaOf(state.body);
    assert.ok(alpha >= 0.6 && alpha < 1, `${label}: body tint alpha ${state.body}`);
  } else {
    assert.match(state.html, /^rgb\(/, `${label}: html is opaque`);
    assert.match(state.body, /^rgb\(/, `${label}: body is opaque`);
  }
}
// The field: mode, canvas contract and status attributes written by its owner.
const fieldState = () =>
  page.evaluate(() => {
    const root = document.documentElement,
      canvas = document.getElementById('field');
    const css = canvas && getComputedStyle(canvas);
    let debug;
    try {
      debug = JSON.parse(document.getElementById('debug')?.textContent ?? 'null')?.background;
    } catch {
      debug = 'unparsable';
    }
    return {
      mode: root.dataset.bg,
      scale: root.dataset.bgScale,
      fps: root.dataset.bgFps,
      window: root.dataset.window,
      debug,
      canvas: canvas && {
        tag: canvas.tagName,
        ariaHidden: canvas.getAttribute('aria-hidden'),
        tabIndex: canvas.tabIndex,
        pointerEvents: css.pointerEvents,
        position: css.position,
        display: css.display,
        visibility: css.visibility,
        backgroundImage: css.backgroundImage,
        beforeApp: canvas.nextElementSibling?.classList.contains('react-app') ?? false,
        inPage: !!canvas.closest('.page-host, .react-app'),
      },
    };
  });
function assertField(state, modes, label) {
  assert.ok(modes.includes(state.mode), `${label}: html[data-bg] is ${state.mode}`);
  assert.ok(state.canvas, `${label}: #field canvas exists`);
  assert.equal(state.canvas.tag, 'CANVAS');
  assert.equal(state.canvas.ariaHidden, 'true', `${label}: #field is aria-hidden`);
  assert.equal(state.canvas.tabIndex, -1, `${label}: #field is not focusable`);
  assert.equal(state.canvas.pointerEvents, 'none', `${label}: #field takes no pointer input`);
  assert.equal(state.canvas.position, 'fixed', `${label}: #field is fixed behind the app`);
  assert.ok(state.canvas.beforeApp, `${label}: #field is the sibling before .react-app`);
  assert.ok(!state.canvas.inPage, `${label}: #field is outside the app and page host`);
  assert.match(state.window ?? '', /^(?:active|inactive)$/, `${label}: html[data-window]`);
  assert.match(state.fps ?? '', /^\d+$/, `${label}: html[data-bg-fps] is an integer`);
  if (state.mode === 'off') assert.equal(state.canvas.display, 'none', `${label}: off hides`);
  if (state.mode === 'static')
    assert.match(state.canvas.backgroundImage, /gradient/, `${label}: static paints the field`);
  if (state.mode === 'webgl')
    assert.ok(Number(state.scale) > 0, `${label}: html[data-bg-scale] ${state.scale}`);
}
// Every element or generated box with a non-none backdrop filter, and whether
// it touches the patch panel, the diagram or the editor stage. Generated boxes
// are measured by their host element.
const glass = () =>
  page.evaluate(() => {
    const stages = [...document.querySelectorAll('.patch-panel, #diagram, .graph-stage')]
      .map((element) => element.getBoundingClientRect())
      .filter((box) => box.width && box.height);
    const found = [];
    for (const element of document.querySelectorAll('*')) {
      for (const pseudo of [null, '::before', '::after']) {
        const css = getComputedStyle(element, pseudo);
        if (css.backdropFilter === 'none' || (pseudo && css.content === 'none')) continue;
        const box = element.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        found.push({
          name:
            (element.id ? '#' + element.id : element.tagName.toLowerCase()) +
            [...element.classList].map((name) => '.' + name).join('') +
            (pseudo ?? ''),
          allowed:
            (pseudo === '::after' && element.matches('.tape-overflow')) ||
            (!pseudo &&
              element.matches(
                '.titlebar, #rail, #drawer[data-mode=docked], #toast, .library .view-heading[data-scrolled]',
              )),
          overlaps: stages.some(
            (stage) =>
              box.left < stage.right &&
              stage.left < box.right &&
              box.top < stage.bottom &&
              stage.top < box.bottom,
          ),
        });
      }
    }
    return found;
  });
async function assertGlass(label) {
  const found = await glass();
  for (const item of found) {
    assert.ok(item.allowed, `${label}: unexpected backdrop filter on ${item.name}`);
    assert.ok(!item.overlaps, `${label}: ${item.name} blurs over a diagram or graph surface`);
  }
  return found;
}
// The canvas is atmosphere only: no control centre may ever resolve to it.
async function assertControlsReachable(label) {
  const blocked = await page.evaluate(() => {
    const field = document.getElementById('field'),
      failures = [];
    for (const control of document.querySelectorAll(
      'button, input, select, textarea, a[href], [role=button], [tabindex="0"]',
    )) {
      const box = control.getBoundingClientRect(),
        css = getComputedStyle(control);
      if (!box.width || !box.height || css.visibility !== 'visible') continue;
      const x = box.left + box.width / 2,
        y = box.top + box.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || hit === field || document.elementsFromPoint(x, y).includes(field))
        failures.push(control.id || control.className || control.tagName);
    }
    return failures;
  });
  assert.deepEqual(blocked, [], `${label}: #field never sits under a control centre`);
}
const glassSurface = (selector) =>
  page.locator(selector).evaluate((element) => {
    const css = getComputedStyle(element);
    return {
      background: css.backgroundColor,
      backdrop: css.backdropFilter,
      image: css.backgroundImage,
    };
  });
// Over-field glass: translucent in a legible band while in-page glass is on;
// the shader owns the frost under data-bg=webgl, CSS blur under static. The
// field may step itself down from webgl to static, so the mode is read live.
async function assertChromeGlass(selector, translucent, label) {
  const surface = await glassSurface(selector),
    mode = await page.locator('html').getAttribute('data-bg');
  if (translucent) {
    const alpha = alphaOf(surface.background);
    assert.ok(
      alpha >= 0.55 && alpha < 1,
      `${label}: ${selector} glass alpha ${surface.background}`,
    );
    if (mode === 'webgl')
      assert.equal(surface.backdrop, 'none', `${label}: ${selector} frost is drawn by the field`);
    else assert.match(surface.backdrop, /blur\(/, `${label}: ${selector} blurs the static field`);
  } else {
    assert.match(surface.background, /^rgb\(/, `${label}: ${selector} is solid`);
    assert.equal(surface.backdrop, 'none', `${label}: ${selector} has no backdrop filter`);
  }
}
// Pixels behind real chrome text, measured from a CDP capture with the text
// hidden. Every text colour must clear 4.5:1 against the worst pixel under it,
// with the cursor key light parked on the chrome (the brightest dark field).
async function measureChromeText(label) {
  const targets = await page.evaluate(() => {
    const found = [];
    const selectors =
      '.titlebar-logo, .titlebar-caption, #rail .nav-label, #rail .rail-group-label, #rail .rail-status';
    for (const element of document.querySelectorAll(selectors)) {
      const box = element.getBoundingClientRect(),
        css = getComputedStyle(element);
      if (box.width < 4 || box.height < 4 || css.visibility !== 'visible' || css.opacity === '0')
        continue;
      if (!element.textContent.trim()) continue;
      const colors = new Set();
      for (const node of [element, ...element.querySelectorAll('*')])
        if ([...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim()))
          colors.add(getComputedStyle(node).color);
      element.dataset.legibilityProbe = String(found.length);
      found.push({
        name: element.className.baseVal ?? element.className,
        text: element.textContent.trim().slice(0, 32),
        colors: [...colors],
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
    }
    const style = document.createElement('style');
    style.id = 'legibility-probe';
    style.textContent =
      '[data-legibility-probe],[data-legibility-probe] *{visibility:hidden!important}';
    document.head.append(style);
    return found;
  });
  try {
    await frames();
    const shot = decodePng(await page.screenshot());
    const scale = shot.width / (await page.evaluate(() => innerWidth));
    for (const target of targets) {
      let worst = Infinity,
        surface = null;
      const x0 = Math.ceil((target.box.x + 1) * scale),
        x1 = Math.floor((target.box.x + target.box.width - 1) * scale),
        y0 = Math.ceil((target.box.y + 1) * scale),
        y1 = Math.floor((target.box.y + target.box.height - 1) * scale);
      for (const color of target.colors) {
        const text = relative(cssChannels(color));
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const pixel = shot.pixel(x, y),
              value = ratio(text, relative(pixel));
            if (value < worst) {
              worst = value;
              surface = pixel;
            }
          }
      }
      legibility.push({
        label,
        element: target.name,
        text: target.text,
        colors: target.colors,
        worstPixel: surface,
        ratio: Number(worst.toFixed(2)),
      });
      assert.ok(
        worst >= 4.5,
        `${label}: "${target.text}" (${target.name}) reaches only ${worst.toFixed(2)}:1 on rendered glass ${surface}`,
      );
    }
  } finally {
    await page.evaluate(() => {
      document.getElementById('legibility-probe')?.remove();
      for (const element of document.querySelectorAll('[data-legibility-probe]'))
        delete element.dataset.legibilityProbe;
    });
  }
  return targets.length;
}
// Parks the pointer (the field's key light) on an element and lets the light
// and parallax springs settle.
async function light(selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await page.waitForTimeout(1600);
  return true;
}
// A point where nothing but the field paints: every element up to body is
// transparent, so the capture reads the canvas itself.
const fieldPoint = () =>
  page.evaluate(() => {
    const clear = (element) => {
      const css = getComputedStyle(element);
      return (
        css.backgroundColor === 'rgba(0, 0, 0, 0)' &&
        css.backgroundImage === 'none' &&
        css.backdropFilter === 'none' &&
        css.boxShadow === 'none'
      );
    };
    for (let y = 72; y < innerHeight - 24; y += 23)
      for (let x = 8; x < innerWidth - 8; x += 17) {
        const hit = document.elementFromPoint(x, y);
        if (!hit) continue;
        let open = true;
        for (let node = hit; node && node !== document.body; node = node.parentElement)
          if (node !== document.documentElement && !clear(node)) {
            open = false;
            break;
          }
        if (open) return { x, y, element: hit.className || hit.tagName };
      }
    return null;
  });
async function sampleField(theme) {
  const point = await fieldPoint();
  assert.ok(point, `${theme}: some part of the field is visible between the cards`);
  const shot = decodePng(
    await page.screenshot({ clip: { x: point.x - 3, y: point.y - 3, width: 6, height: 6 } }),
  );
  const pixels = [];
  for (let y = 0; y < shot.height; y++)
    for (let x = 0; x < shot.width; x++) pixels.push(shot.pixel(x, y));
  assert.equal(shot.minimumAlpha, 255, `${theme}: the field is opaque`);
  const levels = pixels.map(relative),
    brightest = Math.max(...levels);
  assert.ok(
    pixels.some((pixel) => pixel.some((value) => value > 0)),
    `${theme}: the WebGL field drew (pixels are not pure black)`,
  );
  if (theme === 'light')
    assert.ok(Math.min(...levels) > 0.3, `${theme}: the light field is bright`);
  else
    // Outside glass the shader caps the field at L 0.214 (#7A808A); the live
    // bead is exempt but never sits in a gutter at rest.
    assert.ok(brightest <= 0.23, `${theme}: the dark field stays under its luminance cap`);
  field[theme] = { point, brightest: Number(brightest.toFixed(4)), sample: pixels[0] };
}
// A keyboard route must be in place on the very next frame, with no page
// entrance or exit running: keys are never delayed by animation.
async function keyboardSwap(press, viewSelector, label) {
  await page.evaluate((viewSelector) => {
    window.__swap = null;
    addEventListener(
      'keydown',
      () =>
        requestAnimationFrame(() => {
          const view = document.querySelector(viewSelector),
            host = document.querySelector('.page-host');
          const running = (element) =>
            element
              ? element.getAnimations().filter((animation) => animation.playState === 'running')
                  .length
              : 0;
          window.__swap = {
            present: !!view && view.getClientRects().length > 0,
            animations: running(host) + running(view),
            opacity: host ? getComputedStyle(host).opacity : null,
          };
        }),
      { once: true },
    );
  }, viewSelector);
  await press();
  const swap = await (await page.waitForFunction(() => window.__swap)).jsonValue();
  assert.ok(swap.present, `${label}: ${viewSelector} is shown on the next frame`);
  assert.equal(swap.animations, 0, `${label}: no page animation delays a keyboard route`);
  assert.equal(swap.opacity, '1', `${label}: the page is fully opaque on the next frame`);
}
const emulateMedia = async (features) => {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setEmulatedMedia', { features });
  await session.detach();
};
try {
  // No retired layers, and the wave leaves nothing behind: its foam canvas is
  // attached only while a wave plays, and there is never a .theme-wave element.
  assert.equal(
    await page.locator('.depth-scene,#depth-canvas,.theme-wave,.theme-wave-foam').count(),
    0,
  );
  // The test data directory turns the launch off: no data-launch, no stage.
  const launchAtRest = await page.evaluate(() => ({
    attribute: document.documentElement.dataset.launch ?? null,
    shown: [...document.querySelectorAll('.launch')].some(
      (stage) => getComputedStyle(stage).display !== 'none',
    ),
    boot: window.__patchbayBoot ?? null,
  }));
  assert.equal(launchAtRest.attribute, null, 'Native suites run with the launch off');
  assert.equal(launchAtRest.shown, false, 'The launch stage is hidden when off');
  assert.equal(launchAtRest.boot?.launch, 'off', 'The boot payload reports launch off');
  const material = await page.evaluate(async () => {
    const root = document.documentElement;
    return {
      native: (await window.__TAURI_INTERNALS__.invoke('startup')).backdrop,
      reducedTransparency: root.classList.contains('reduced-transparency'),
      highContrast: root.classList.contains('high-contrast'),
      theme: root.dataset.theme,
    };
  });
  assert.ok(
    ['mica', 'none'].includes(material.native?.kind),
    'Startup reports the native window material',
  );
  if (run.opaque) {
    assert.equal(material.native.kind, 'none', 'PATCHBAY_OPAQUE=1 keeps the window opaque');
    assert.ok(material.native.reason, 'An opaque window reports why');
  } else if (Number(release().split('.')[2]) >= 22000)
    assert.equal(
      material.native.kind,
      'mica',
      'Windows 11 applies Mica: ' + material.native.reason,
    );
  // Reported at the end so the rest of the suite still runs and reports.
  if (material.theme !== 'dark')
    deferred.push(`A fresh session opens in ${material.theme}; Night (dark) is the default`);
  assert.equal(launchAtRest.boot?.theme, material.theme, 'The boot script set the startup theme');
  // The OS can ask for an opaque page (reduced transparency, high contrast).
  const inPageGlass = !material.reducedTransparency && !material.highContrast;
  const mica = material.native.kind === 'mica' && inPageGlass;
  checks.push(
    `Window material: native ${material.native.kind}${material.native.reason ? ` (${material.native.reason})` : ''}, page ${mica ? 'mica' : 'solid'}`,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await frames();
  const initialField = await fieldState();
  assertField(initialField, inPageGlass ? ['webgl', 'static'] : ['off'], 'Startup');
  // #debug carries field.status() for diagnostics; it must follow mode changes.
  const debugAgrees = await page
    .waitForFunction(
      () =>
        JSON.parse(document.getElementById('debug')?.textContent || '{}').background?.mode ===
        document.documentElement.dataset.bg,
      undefined,
      { timeout: 3000 },
    )
    .then(
      () => true,
      () => false,
    );
  if (!debugAgrees)
    deferred.push(
      `#debug background ${JSON.stringify((await fieldState()).debug)} does not follow html[data-bg=${initialField.mode}]`,
    );
  // PATCHBAY_OPAQUE only changes the window material; the field is opaque and
  // runs on both native paths.
  if (run.opaque && inPageGlass)
    assert.notEqual(initialField.mode, 'off', 'PATCHBAY_OPAQUE=1 keeps the field on');
  const mode = initialField.mode;
  // Waits for the field to come back on after an opaque mode.
  const fieldOn = inPageGlass ? 'html:is([data-bg=webgl],[data-bg=static])' : 'html[data-bg=off]';
  const liveMode = () => page.locator('html').getAttribute('data-bg');
  checks.push(
    `Field: html[data-bg=${mode}] at ${initialField.scale ?? '-'}× on a ${run.opaque ? 'opaque' : 'Mica'} window; canvas is aria-hidden, unfocusable, pointer-transparent and outside the page`,
  );
  for (const theme of ['dark', 'light']) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
      await page.locator('#theme-toggle').click();
      await page.locator(`html[data-theme=${theme}]`).waitFor();
    }
    await frames();
    await settle();
    await page.waitForTimeout(800);
    const palette = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        [
          'deep',
          'silk',
          'muted',
          'brand',
          'accent',
          'on-brand',
          'mask',
          'select',
          'on-select',
          'panel',
          'panel-ink',
          'panel-signal',
        ].map((key) => [key, css.getPropertyValue('--' + key).trim()]),
      );
    });
    for (const [foreground, background] of [
      ['silk', 'deep'],
      ['muted', 'deep'],
      ['on-brand', 'brand'],
      ['brand', 'deep'],
      ['accent', 'deep'],
      ['on-select', 'select'],
    ])
      assert.ok(
        contrast(palette[foreground], palette[background]) >= 4.5,
        `${theme}: ${foreground}/${background} contrast`,
      );
    assert.ok(
      contrast(palette['panel-signal'], palette['panel-ink']) >= 3,
      `${theme}: the live signal stands 3:1 apart from the idle ink`,
    );
    plates[theme] = palette;
    // The plate the canvases read is the one painted: #diagram resolves the
    // same --panel as the document, and the native window background follows
    // the theme mask (checked on the opaque frame).
    const painted = await page.evaluate(() => ({
      diagram: getComputedStyle(document.getElementById('diagram') ?? document.body)
        .getPropertyValue('--panel')
        .trim(),
      selection: getComputedStyle(document.getElementById('machine-title'), '::selection')
        .backgroundColor,
      selectionToken: getComputedStyle(document.documentElement)
        .getPropertyValue('--selection')
        .trim(),
    }));
    assert.equal(painted.diagram, palette.panel, `${theme}: the diagram reads the themed plate`);
    assert.equal(
      painted.selection,
      `rgb(${hexChannels(painted.selectionToken).join(', ')})`,
      `${theme}: text selection uses --selection`,
    );
    const surfaces = await page.locator('#sheet,#dock').evaluateAll((elements) =>
      elements.map((element) => {
        const css = getComputedStyle(element);
        return {
          id: element.id,
          background: css.backgroundColor,
          backdrop: css.backdropFilter,
          image: css.backgroundImage,
        };
      }),
    );
    assert.deepEqual(surfaces.map((surface) => surface.id).sort(), ['dock', 'sheet']);
    for (const surface of surfaces) {
      assert.equal(surface.backdrop, 'none', `${theme}: #${surface.id} has no backdrop filter`);
      assert.equal(surface.image, 'none', `${theme}: #${surface.id} has no background image`);
      assert.match(surface.background, /^rgb\(/, `${theme}: #${surface.id} is an opaque plate`);
    }
    for (const selector of ['.titlebar', '#rail'])
      await assertChromeGlass(selector, inPageGlass, theme);
    assertFrame(await frame(), mica, theme);
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        body: getComputedStyle(document.body).fontFamily,
        inter: document.fonts.check('600 17px "Inter Variable"'),
        mono: document.fonts.check('500 28px "IBM Plex Mono"'),
        serif: document.fonts.check('400 36px Newsreader'),
        tape: getComputedStyle(document.querySelector('.tape-cell') ?? document.body).fontFamily,
        title: (() => {
          const css = getComputedStyle(document.getElementById('machine-title'));
          return { family: css.fontFamily, size: parseFloat(css.fontSize), weight: css.fontWeight };
        })(),
      };
    });
    assert.match(fonts.body, /Inter Variable/, `${theme}: body is set in Inter Variable`);
    assert.ok(fonts.inter, `${theme}: the local Inter Variable face is loaded`);
    assert.ok(fonts.mono, `${theme}: the local IBM Plex Mono face is loaded`);
    assert.ok(fonts.serif, `${theme}: the local Newsreader face is loaded`);
    assert.match(fonts.title.family, /^"?Newsreader/, `${theme}: the machine title is serif`);
    assert.ok(fonts.title.size >= 28, `${theme}: the serif is never below 28px`);
    assert.equal(fonts.title.weight, '400', `${theme}: the serif title is weight 400`);
    titles[theme] = fonts.title;
    await assertGlass(theme);
    await assertControlsReachable(`${theme} Bench`);
    if ((await liveMode()) === 'webgl') await sampleField(theme);
    if (inPageGlass) {
      let measured = 0;
      for (const target of ['#rail .rail-group-label', '.titlebar-caption', '#rail'])
        if (await light(target)) measured = await measureChromeText(`${theme}, light on ${target}`);
      assert.ok(measured >= 5, `${theme}: chrome labels were measured (${measured})`);
    }
    await page.mouse.move(720, 500);
    await page.screenshot({ path: resolve(artifacts, `appearance${runSuffix}-${theme}.png`) });
    checks.push(
      `${theme}: opaque sheet and dock, ${inPageGlass ? 'glass' : 'solid'} title bar and sidebar on a ${mica ? 'Mica' : 'solid'} frame, local Inter Variable and IBM Plex Mono, token and rendered chrome text contrast >=4.5`,
    );
  }
  checks.push(
    `Rendered chrome text over the field measured from CDP captures with the key light parked on it (${legibility.length} samples, worst ${Math.min(...legibility.map((item) => item.ratio))}:1)`,
  );
  // One product, two palettes: the plate is themed, the type is identical.
  for (const token of ['mask', 'panel', 'panel-ink', 'panel-signal'])
    assert.notEqual(plates.dark[token], plates.light[token], `--${token} differs per theme`);
  assert.deepEqual(titles.dark, titles.light, 'The serif title is identical in both themes');
  checks.push(
    `Night and Pearl paint their own plate (signal ${plates.dark['panel-signal']} / ${plates.light['panel-signal']}), neutral selection, and identical Newsreader ${titles.dark.size}px titles`,
  );
  if (field.dark || field.light)
    checks.push('The WebGL field paints opaque, non-black pixels and stays under its dark cap');
  for (const [width, height] of [
    [360, 800],
    [768, 800],
    [1024, 640],
    [1366, 768],
    [1920, 1080],
    [2560, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    for (const [name, selector] of [
      ['bench', '#view-bench'],
      ['editor', '#view-editor'],
      ['machines', '#view-machines'],
      ['learn', '#view-learn'],
    ]) {
      await route(name, selector);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${name} has horizontal overflow at ${width}`,
      );
      assert.ok(await page.locator('#rail').isVisible());
      await assertGlass(`${name} at ${width}×${height}`);
      await assertControlsReachable(`${name} at ${width}×${height}`);
    }
    // At phone width the rail is a five-item tab bar; Trace and Text are
    // reached from the Bench shortcuts instead.
    const tabs = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('#rail .nav-item')].map((item) => [
          item.dataset.route,
          item.getClientRects().length > 0,
        ]),
      ),
    );
    assert.deepEqual(
      Object.keys(tabs).sort(),
      ['bench', 'editor', 'learn', 'machines', 'settings', 'text', 'trace'],
      'The rail carries four pages and three panels',
    );
    for (const name of ['bench', 'machines', 'editor', 'learn', 'settings'])
      assert.ok(tabs[name], `${name} is reachable from the rail at ${width}`);
    for (const name of ['trace', 'text'])
      assert.equal(tabs[name], width > 719, `${name} rail item visibility at ${width}`);
    await route('bench', '#view-bench');
    if (width === 1366 && height === 768) {
      await page.evaluate(() => {
        scrollTo(0, 0);
        const sheet = document.querySelector('.page-host');
        if (sheet) sheet.scrollTop = 0;
      });
      const dock = await page.locator('#dock').boundingBox();
      if (dock.y + dock.height > height)
        deferred.push(
          `Bench dock must fit 1366×768: it spans y ${Math.round(dock.y)}–${Math.round(dock.y + dock.height)} (sheet ${JSON.stringify(await page.locator('#sheet').boundingBox())})`,
        );
    }
    await page.locator('#play').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('#play').isVisible());
    sizes.push({
      width,
      height,
      document: await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      })),
    });
  }
  checks.push(
    'Bench, editor, library and Learn scale from 360 to 2560 CSS pixels without page overflow; the rail becomes a five-item tab bar at phone width',
  );
  checks.push(
    'Backdrop filters stay on the six allow-listed surfaces, never touch a diagram or graph, and #field never sits under a control',
  );
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator('[data-route=bench]').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(
    await page
      .locator('[data-route=machines]')
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await keyboardSwap(() => page.keyboard.press('Enter'), '#view-machines', 'Rail Enter');
  await settle();
  checks.push('Custom navigation supports keyboard focus and activation');
  await page.locator('#view-machines .preset-row').last().scrollIntoViewIfNeeded();
  await page.locator('.library .view-heading[data-scrolled]').waitFor();
  await frames();
  await settle();
  const heading = await assertGlass('scrolled Machines');
  assert.equal(
    heading.some((item) => item.name.includes('view-heading')),
    inPageGlass,
    'The Machines heading turns to glass once the list scrolls under it',
  );
  await page.evaluate(() => {
    // The list may scroll in the window or in the sheet; reset both.
    let element = document.querySelector('.library .view-heading');
    for (; element; element = element.parentElement) element.scrollTop = 0;
    scrollTo(0, 0);
  });
  await page.locator('.library .view-heading:not([data-scrolled])').waitFor();
  checks.push('The Machines heading is glass only while rows scroll beneath it');
  await route('bench', '#view-bench');
  await page.locator('#machine-description').click();
  await keyboardSwap(() => page.keyboard.press('e'), '#view-editor', 'E key');
  await settle();
  // The editor owns its keys, so the global ? shortcut is tried from the Bench.
  await route('bench', '#view-bench');
  await page.evaluate(() => document.activeElement?.blur());
  await keyboardSwap(() => page.keyboard.press('?'), '#view-learn', '? key');
  await settle();
  checks.push(
    'Keyboard routes (rail Enter, E, ?) are in place on the next frame with no animation',
  );
  // The theme wave (DESIGN.md › The theme wave). Everywhere else the suites
  // switch themes instantly through html[data-theme-instant]; this block plays
  // the real wave on a 1440×900 Bench. It checks that the live page is fully
  // themed on every frame (colours never tween), that the wave spreads from the
  // button, that a second press reverses it, that any other click or key ends
  // it and still lands, and that the native window theme is pinned only after
  // the transition, while the Mica frame paints a solid mask.
  await page.setViewportSize({ width: 1440, height: 900 });
  await route('bench', '#view-bench');
  await page.locator('#reset').click();
  await page.locator('#machine-description').click();
  const themedSurfaces = () =>
    page.evaluate(() => {
      const read = (selector, property) => {
        const element = document.querySelector(selector);
        return element ? getComputedStyle(element)[property] : null;
      };
      return {
        sheet: read('#sheet', 'backgroundColor'),
        dock: read('#dock', 'backgroundColor'),
        title: read('#machine-title', 'color'),
        play: read('#play', 'backgroundColor'),
        titlebar: read('.titlebar', 'backgroundColor'),
        plate: getComputedStyle(document.documentElement).getPropertyValue('--panel').trim(),
      };
    });
  const themed = {};
  for (const theme of ['light', 'dark']) {
    await page.locator('#theme-toggle').click();
    await page.locator(`html[data-theme=${theme}]`).waitFor();
    await settle();
    themed[theme] = await themedSurfaces();
  }
  await page.evaluate(() => {
    const root = document.documentElement,
      log = (window.__wave = { events: [], ipc: [] }),
      now = () => performance.now();
    new MutationObserver((records) => {
      for (const record of records)
        log.events.push({
          t: now(),
          name: record.attributeName,
          value: root.getAttribute(record.attributeName),
        });
    }).observe(root, {
      attributes: true,
      attributeFilter: [
        'data-theme',
        'data-theme-wave',
        'data-theme-fade',
        'data-theme-intent',
        'data-wave-fps',
      ],
    });
    addEventListener('patchbay:theme-settled', (event) =>
      log.events.push({ t: now(), name: 'settled', value: event.detail?.theme }),
    );
    // Tauri's IPC travels over fetch; record when the window theme is set.
    const fetch = window.fetch;
    window.fetch = (url, ...args) => {
      if (/set_theme/.test(decodeURIComponent(String(url)))) log.ipc.push({ t: now() });
      return fetch.call(window, url, ...args);
    };
    window.__clip = () =>
      document
        .getAnimations()
        .find((animation) => animation.effect?.pseudoElement === '::view-transition-new(root)');
  });
  await instantTheme(page, false);
  const toggleBox = await page.locator('#theme-toggle').boundingBox(),
    toggleAt = { x: toggleBox.x + toggleBox.width / 2, y: toggleBox.y + toggleBox.height / 2 };
  const pageNow = () => page.evaluate(() => performance.now());
  // Presses go through page.mouse at coordinates: during a view transition
  // Chromium hit-tests <html>, so a locator click would wait for the wave.
  const pressToggle = async () => {
    const at = await pageNow();
    await page.mouse.click(toggleAt.x, toggleAt.y);
    return at;
  };
  const waveRunning = () =>
    page.waitForFunction(
      () => document.documentElement.hasAttribute('data-theme-wave') && !!window.__clip(),
      undefined,
      { timeout: 1000 },
    );
  const waveEnded = (timeout) =>
    page.waitForFunction(() => !window.__clip(), undefined, { timeout, polling: 'raf' });
  // patchbay:theme-settled after a press. The instant switches above settle
  // asynchronously too, so only events after the press count.
  const settledAfter = (from) =>
    page.waitForFunction(
      (from) => window.__wave.events.some((event) => event.name === 'settled' && event.t >= from),
      from,
      { timeout: 6000 },
    );
  const waitUntil = async (from, ms) => {
    const elapsed = (await pageNow()) - from;
    if (elapsed < ms) await page.waitForTimeout(ms - elapsed);
  };
  const waveLog = () => page.evaluate(() => window.__wave);
  // 1. Night → Pearl, played to the end and filmed.
  const cast = await screencast(page, { maxWidth: 720 });
  const forwardAt = await pressToggle();
  await waveRunning();
  const start = await page.evaluate(() => {
    const root = document.documentElement,
      clip = window.__clip(),
      toggle = document.getElementById('theme-toggle'),
      glyph = toggle.querySelector('.theme-glyph');
    clip.finished.then(
      () => window.__wave.events.push({ t: performance.now(), name: 'clip-finished' }),
      () => window.__wave.events.push({ t: performance.now(), name: 'clip-cancelled' }),
    );
    return {
      theme: root.dataset.theme,
      intent: root.dataset.themeIntent,
      duration: Number(clip.effect.getTiming().duration),
      pressed: toggle.getAttribute('aria-pressed'),
      label: toggle.getAttribute('aria-label'),
      glyph:
        glyph?.getAttribute('aria-hidden') === 'true' &&
        ['.core', '.cut', '.rays'].every((part) => glyph.querySelector(part)),
      motionTheme: parseFloat(getComputedStyle(root).getPropertyValue('--motion-theme')) || 0,
      foam: !!document.querySelector('.theme-wave-foam'),
    };
  });
  assert.equal(start.theme, 'light', 'The new theme is committed inside the transition update');
  assert.equal(start.intent, 'light', 'html[data-theme-intent] flips on the press');
  assert.ok(start.duration >= 1200 && start.duration <= 1800, `Wave length ${start.duration}ms`);
  assert.equal(
    start.pressed,
    null,
    'The theme toggle is an action button (its label names the next theme), not a toggle with aria-pressed',
  );
  assert.equal(start.label, 'Switch to dark theme', 'The label names the next theme at once');
  assert.ok(start.glyph, 'The toggle holds the aria-hidden sun/moon glyph');
  assert.equal(start.motionTheme, 0, '--motion-theme is 0ms during the wave');
  assert.ok(start.foam, 'The foam canvas rides the wave at medium quality');
  await waitUntil(forwardAt, 700);
  const middle = await page.evaluate(() => ({
    wave: document.documentElement.hasAttribute('data-theme-wave'),
    body: getComputedStyle(document.body).backgroundColor,
    mask: getComputedStyle(document.documentElement).getPropertyValue('--mask').trim(),
  }));
  assert.ok(middle.wave, 'The wave is still travelling at 700ms');
  assert.deepEqual(
    await themedSurfaces(),
    themed.light,
    'Mid-wave the live page is fully Pearl: no surface is half-themed or tweening',
  );
  if (mica)
    assert.equal(
      middle.body,
      `rgb(${hexChannels(middle.mask).join(', ')})`,
      'During the wave the Mica frame paints the solid --mask',
    );
  await settledAfter(forwardAt);
  const frames = await cast.stop();
  const forward = await waveLog();
  const timeOf = (log, name, value) =>
    log.events.find(
      (event) =>
        event.name === name &&
        event.t >= forwardAt &&
        (value === undefined || event.value === value),
    )?.t;
  const clipDone = timeOf(forward, 'clip-finished'),
    themeSet = forward.ipc.find((call) => call.t >= forwardAt)?.t,
    waveOff = timeOf(forward, 'data-theme-wave', null),
    settledAt = timeOf(forward, 'settled', 'light');
  assert.ok(clipDone, 'The wave clip ran to the end');
  assert.ok(themeSet !== undefined, 'The native window theme is set after the wave');
  assert.ok(themeSet >= clipDone - 1, 'set_theme waits for the view transition to finish');
  assert.ok(waveOff >= themeSet, 'Mica returns only after the native theme is pinned');
  assert.ok(settledAt >= waveOff, 'patchbay:theme-settled fires once the frame is back');
  assert.ok(
    settledAt - forwardAt >= 1300 && settledAt - forwardAt <= 2600,
    `The wave settles ${Math.round(settledAt - forwardAt)}ms after the press`,
  );
  const waveFps = Number(await page.locator('html').getAttribute('data-wave-fps'));
  assert.ok(Number.isFinite(waveFps) && waveFps > 0, `html[data-wave-fps] is ${waveFps}`);
  assertFrame(await frame(), mica, 'After the wave');
  assert.deepEqual(await themedSurfaces(), themed.light, 'The settled page is Pearl');
  // The film: the wave starts at the button and the far corner turns last; the
  // new snapshot (field, plates, chrome) is already Pearl wherever it shows.
  const origin = await page.evaluate(() => performance.timeOrigin);
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const film = frames
    .map((item) => ({ ...item, at: item.time - origin - forwardAt }))
    .filter((item) => item.at >= 0 && item.at <= 2000)
    .map((item) => {
      // Median luminance of a 7×7 CSS-pixel patch, so a glyph or a hairline
      // under the probe does not decide which theme a region shows.
      const shot = decodePng(item.png),
        scale = shot.width / viewport.width,
        level = (x, y) => {
          const values = [];
          for (let dy = -3; dy <= 3; dy++)
            for (let dx = -3; dx <= 3; dx++) {
              const px = Math.min(shot.width - 1, Math.max(0, (x + dx) * scale)),
                py = Math.min(shot.height - 1, Math.max(0, (y + dy) * scale));
              values.push(relative(shot.pixel(px, py)));
            }
          return values.sort((a, b) => a - b)[values.length >> 1];
        };
      return {
        ...item,
        near: level(toggleAt.x - 80, toggleAt.y),
        centre: level(viewport.width / 2, viewport.height / 2),
        far: level(8, viewport.height - 8),
      };
    });
  const pearlish = 0.4,
    nightish = 0.15;
  assert.ok(
    film.some(
      (item) => item.at >= 120 && item.at <= 500 && item.near > pearlish && item.far < nightish,
    ),
    'Early in the wave the titlebar beside the button is Pearl while the far corner is still Night',
  );
  assert.ok(
    film.some((item) => item.at >= 1000 && item.at <= 1550 && item.centre > pearlish),
    'Late in the wave the centre of the Bench shows the Pearl snapshot',
  );
  // The front passes 80px from the button's centre after about 120ms.
  assert.ok(
    film.every((item) => item.near > pearlish || item.at < 200),
    'Once covered, the button side never shows Night again',
  );
  const strip = resolve(root, '.taste-skill/theme', `wave-strip${runSuffix}`);
  await mkdir(strip, { recursive: true });
  const picks = [0, 120, 300, 500, 750, 1000, 1250, 1500, 1700].map((target) =>
    film.reduce((best, item) =>
      Math.abs(item.at - target) < Math.abs(best.at - target) ? item : best,
    ),
  );
  for (const [index, item] of picks.entries())
    await writeFile(
      resolve(strip, `${String(index).padStart(2, '0')}-${Math.round(item.at)}ms.png`),
      item.png,
    );
  checks.push(
    `Theme wave Night → Pearl: ${start.duration}ms clip from the button, foam on the clock, live page fully themed mid-wave, set_theme after the transition and before Mica returns, ${waveFps} fps (${film.length} frames filmed)`,
  );
  // 2. A second press reverses the wave and lands on the original theme.
  const reverseAt = await pressToggle();
  await waveRunning();
  await waitUntil(reverseAt, 500);
  await page.mouse.click(toggleAt.x, toggleAt.y);
  const reversed = await (
    await page.waitForFunction(
      () => {
        const clip = window.__clip();
        return clip && clip.playbackRate < 0
          ? { rate: clip.playbackRate, intent: document.documentElement.dataset.themeIntent }
          : null;
      },
      undefined,
      { timeout: 1000, polling: 'raf' },
    )
  ).jsonValue();
  assert.ok(reversed.rate <= -1.5, `The wave rolls back at ${reversed.rate}×`);
  assert.equal(reversed.intent, 'light', 'The intent returns to Pearl on the second press');
  await settledAfter(reverseAt);
  const back = await waveLog();
  const backSettled = back.events.find((event) => event.name === 'settled' && event.t >= reverseAt);
  assert.equal(backSettled.value, 'light', 'The reversed wave lands on Pearl');
  assert.ok(backSettled.t - reverseAt <= 1500, 'The reversal lands faster than a full wave');
  assert.deepEqual(await themedSurfaces(), themed.light, 'After the reversal the page is Pearl');
  checks.push(
    'A second press mid-wave rolls it back to the button and lands on the original theme',
  );
  // 3. Another click ends the wave at once on the new theme and still lands.
  const step = await page.locator('#step').boundingBox();
  const clickAt = await pressToggle();
  await waveRunning();
  await waitUntil(clickAt, 400);
  await page.mouse.click(step.x + step.width / 2, step.y + step.height / 2);
  await waveEnded(300);
  await page.waitForFunction(
    () => Number(document.getElementById('progress').value) === 1,
    undefined,
    {
      timeout: 3000,
    },
  );
  await settledAfter(clickAt);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.deepEqual(await themedSurfaces(), themed.dark, 'The interrupted wave ends on Night');
  // 4. So does a key, which reaches its handler (R resets playback).
  const keyAt = await pressToggle();
  await waveRunning();
  await waitUntil(keyAt, 400);
  await page.keyboard.press('r');
  await waveEnded(300);
  await page.waitForFunction(
    () => Number(document.getElementById('progress').value) === 0,
    undefined,
    {
      timeout: 3000,
    },
  );
  await settledAfter(keyAt);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  checks.push(
    'A click or key during the wave ends it at once on the new theme and still reaches its target (Step, R)',
  );
  // 5. Reduced motion: a short cross-fade, no wave.
  await page.locator('[data-route=settings]').click();
  await page.locator('#panel-settings').waitFor();
  await page.locator('#reduced-motion').check();
  await page.locator('#close-drawer').click();
  await page.locator('#drawer').waitFor({ state: 'hidden' });
  const fadeAt = await pressToggle();
  await settledAfter(fadeAt);
  const fade = await waveLog();
  const fadeEvents = fade.events.filter((event) => event.t >= fadeAt);
  assert.ok(
    fadeEvents.some((event) => event.name === 'data-theme-fade' && event.value !== null),
    'Reduced motion uses html[data-theme-fade]',
  );
  assert.ok(
    !fadeEvents.some((event) => event.name === 'data-theme-wave' && event.value !== null),
    'Reduced motion plays no wave',
  );
  const fadeDone = fadeEvents.find((event) => event.name === 'settled').t - fadeAt;
  assert.ok(fadeDone <= 350, `The reduced-motion cross-fade settles in ${Math.round(fadeDone)}ms`);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.locator('[data-route=settings]').click();
  await page.locator('#panel-settings').waitFor();
  await page.locator('#reduced-motion').uncheck();
  await page.locator('#close-drawer').click();
  await page.locator('#drawer').waitFor({ state: 'hidden' });
  checks.push(`Reduced motion swaps the wave for a cross-fade (${Math.round(fadeDone)}ms)`);
  // The rest of the suite switches instantly and runs in the default Night.
  await instantTheme(page);
  if ((await page.locator('html').getAttribute('data-theme')) !== 'dark')
    await page.locator('#theme-toggle').click();
  await page.locator('html[data-theme=dark]').waitFor();
  await settle();
  // Docked glass sheet at 1200 and wider; a solid, non-modal overlay below.
  for (const [width, expected] of [
    [1440, 'docked'],
    [1024, 'overlay'],
  ]) {
    await page.setViewportSize({ width, height: 800 });
    await route('editor', '#view-editor');
    await page.locator('[data-route=settings]').click();
    await page.locator('#panel-settings').waitFor();
    await settle();
    assert.equal(
      await page.locator('#drawer').getAttribute('data-mode'),
      expected,
      `The drawer is ${expected} at ${width}`,
    );
    assert.ok(
      await page.locator('#view-editor').isVisible(),
      'Settings preserves the current workspace',
    );
    assert.equal(
      await page.locator('#drawer').evaluate((dialog) => dialog.matches(':modal')),
      false,
    );
    const drawer = await glassSurface('#drawer');
    if (expected === 'docked' && inPageGlass)
      await assertChromeGlass('#drawer', true, `Docked drawer at ${width}`);
    else {
      assert.match(drawer.background, /^rgb\(/, `The ${expected} drawer is solid at ${width}`);
      assert.equal(drawer.backdrop, 'none', `The ${expected} drawer does not blur at ${width}`);
    }
    await assertGlass(`${expected} drawer at ${width}`);
    await assertControlsReachable(`${expected} drawer at ${width}`);
    await page.locator('[data-route=machines]').click();
    await page.locator('#view-machines').waitFor();
    await page.locator('#drawer').waitFor({ state: 'hidden' });
  }
  checks.push(
    'The drawer docks as glass at 1200px and wider and is a solid, non-modal overlay below',
  );
  await page.setViewportSize({ width: 1366, height: 768 });
  await route('bench', '#view-bench');
  await page.locator('#trace-shortcut').click();
  await page.locator('#trace-progress').waitFor();
  assert.ok(await page.locator('#sheet').isVisible(), 'Trace retains the live diagram');
  await page.locator('#trace-progress').focus();
  await page.keyboard.press('End');
  assert.equal(
    await page.locator('#step-counter').innerText(),
    await page.locator('#total-counter').innerText(),
  );
  await page.locator('#copy').click();
  await page.locator('#toast').waitFor();
  await settle();
  const toast = await assertGlass('toast over the Bench');
  assert.equal(
    toast.some((item) => item.name.startsWith('#toast')),
    inPageGlass,
    'The toast is frosted while it is shown',
  );
  checks.push('The frosted toast lands clear of the patch panel and diagram');
  await page.locator('[data-route=learn]').click();
  await page.locator('#view-learn').waitFor();
  await page.locator('#drawer').waitFor({ state: 'hidden' });
  checks.push(
    'Settings and trace preserve the workspace; navigation remains usable and the trace scrubber seeks',
  );
  await route('bench', '#view-bench');
  await page.locator('#text-shortcut').click();
  await page.locator('#source').focus();
  await page.keyboard.press('Escape');
  await page.locator('#drawer').waitFor({ state: 'hidden' });
  checks.push('Escape closes a side panel even while its text field has focus');
  assert.ok(
    await page.locator('html').evaluate((element) => {
      const css = getComputedStyle(element);
      const rgb = (name) =>
        `rgb(${css
          .getPropertyValue(name)
          .trim()
          .slice(1)
          .match(/../g)
          .map((channel) => parseInt(channel, 16))
          .join(', ')})`;
      return css.scrollbarColor === `${rgb('--strong-line')} ${rgb('--mask')}`;
    }),
    'Page scrollbar uses the current theme palette',
  );
  checks.push('Page scrollbar matches the current palette');
  // Screenshots: the canvas hides and every glass surface turns solid, so a
  // capture never depends on how PrintWindow reads WebGL.
  await page.evaluate(() => {
    document.documentElement.dataset.capture = '';
  });
  await frames();
  await settle();
  const captured = await fieldState();
  assert.ok(
    captured.canvas.visibility === 'hidden' || captured.canvas.display === 'none',
    'html[data-capture] hides #field',
  );
  for (const selector of ['.titlebar', '#rail'])
    await assertChromeGlass(selector, false, 'Screenshot capture');
  assert.match((await frame()).body, /^rgb\(/, 'Screenshot capture paints an opaque body');
  await page.evaluate(() => {
    delete document.documentElement.dataset.capture;
  });
  await frames();
  checks.push('html[data-capture] hides the field and makes the chrome glass solid');
  await page.locator('[data-route=settings]').click();
  await page.locator('#panel-settings').waitFor();
  const toastFilter = () =>
    page.locator('#toast').evaluate((element) => getComputedStyle(element).backdropFilter);
  assert.equal((await toastFilter()) !== 'none', inPageGlass, 'In-page glass is on by default');
  const background = await page.locator('#metric-background').innerText();
  // mode · render scale · fps, plus the reason for a dynamic-resolution or
  // tier step when there is one.
  assert.match(
    background,
    new RegExp(`^${await liveMode()} · [\\d.]+× · \\d+ fps(?: · .+)?$`),
    'Local diagnostics report the field mode, scale, frame rate and any step reason',
  );
  assert.match(
    await page.locator('#metric-hz').innerText(),
    /^\d+ Hz$/,
    'Local diagnostics show the detected display refresh rate',
  );
  checks.push(`Local diagnostics read "${background}"`);
  const materialSwitch = page.locator('#window-material');
  const opaqueField = async (label) => {
    const state = await fieldState();
    assertField(state, ['off'], label);
    for (const selector of ['.titlebar', '#rail']) await assertChromeGlass(selector, false, label);
    assert.equal(await toastFilter(), 'none', `${label} removes in-page blur`);
  };
  if (material.native.kind === 'mica') {
    assert.equal(await materialSwitch.isDisabled(), false);
    await materialSwitch.uncheck();
    await page.locator('html.reduced-transparency[data-backdrop=solid][data-bg=off]').waitFor();
    await frames();
    await settle();
    assertFrame(await frame(), false, 'Window material off');
    await opaqueField('Window material off');
    await materialSwitch.check();
    await page.locator(`html[data-backdrop=${mica ? 'mica' : 'solid'}]`).waitFor();
    await page.locator(fieldOn).waitFor();
    await frames();
    await settle();
    assertFrame(await frame(), mica, 'Window material on');
    checks.push('The Window material switch toggles Mica, the field and in-page blur together');
  } else {
    assert.equal(await materialSwitch.isDisabled(), true);
    checks.push('The Window material switch is unavailable on an opaque window');
  }
  // The OS reduced-transparency request reaches the same opaque look.
  await emulateMedia([{ name: 'prefers-reduced-transparency', value: 'reduce' }]);
  if (await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)) {
    await page.locator('html.reduced-transparency[data-bg=off]').waitFor();
    await frames();
    await settle();
    await opaqueField('prefers-reduced-transparency');
    checks.push('prefers-reduced-transparency turns the field off and every glass surface solid');
  } else checks.push('prefers-reduced-transparency could not be emulated in this WebView2');
  await emulateMedia([]);
  await page.locator(fieldOn).waitFor();
  if (!material.highContrast) {
    await page.locator('#high-contrast').check();
    await page.locator('html.high-contrast[data-backdrop=solid][data-bg=off]').waitFor();
    await frames();
    await settle();
    assertFrame(await frame(), false, 'High contrast');
    await opaqueField('High contrast');
    await page.locator('#high-contrast').uncheck();
    await page.locator('html:not(.high-contrast)').waitFor();
    await page.locator(fieldOn).waitFor();
    await frames();
    await settle();
    assertFrame(await frame(), mica, 'High contrast off');
    checks.push('High contrast turns the field off and returns an opaque frame without blur');
  }
  if (inPageGlass) {
    await page.locator('#quality').selectOption('low');
    await page.locator('html[data-quality=low][data-bg=static]').waitFor();
    await frames();
    await settle();
    assertField(await fieldState(), ['static'], 'Low quality');
    for (const selector of ['.titlebar', '#rail'])
      await assertChromeGlass(selector, false, 'Low quality');
    await page.locator('#quality').selectOption('medium');
    await page.locator('html[data-quality=medium]').waitFor();
    await page.locator(fieldOn).waitFor();
    checks.push('Low quality paints the static field and solid glass');
  }
  await page.locator('#reduced-motion').check();
  await page.locator('#close-drawer').click();
  await page.locator('#drawer').waitFor({ state: 'hidden' });
  assert.equal(
    await page
      .locator('#sheet')
      .evaluate((element) => getComputedStyle(element).transitionDuration)
      .then((value) => value.split(',').every((item) => parseFloat(item) < 0.01)),
    true,
  );
  checks.push('Reduced motion removes long transitions');
  if (inPageGlass) {
    // A still frame: nothing redraws while idle, but the field stays visible.
    await page.mouse.move(700, 400);
    await page.locator('html[data-bg-fps="0"]').waitFor({ timeout: 8000 });
    assertField(await fieldState(), ['webgl', 'static'], 'Reduced motion');
    checks.push('Reduced motion freezes the field to a still frame (data-bg-fps 0 when idle)');
  }
  assert.deepEqual(errors, []);
  const report = {
    material: material.native,
    field: { startup: mode, final: await fieldState(), samples: field },
    checks,
    deferred,
    legibility,
    sizes,
    errors,
  };
  await writeFile(
    resolve(artifacts, `appearance-report${runSuffix}.json`),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(deferred, [], 'Deferred appearance failures');
} catch (error) {
  await page
    .screenshot({ path: resolve(artifacts, `appearance-failure${runSuffix}.png`) })
    .catch(() => {});
  throw error;
} finally {
  await run.close();
}
