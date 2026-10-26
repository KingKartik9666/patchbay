import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchNative, artifacts } from './helpers/native.mjs';

const run = await launchNative(),
  { page } = run;
const checks = [],
  errors = [],
  sizes = [];
page.on('pageerror', (error) => errors.push(error.message));
const settle = () =>
  page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  );
async function route(name, selector) {
  await page.locator(`[data-route=${name}]`).click();
  await page.locator(selector).waitFor();
  await settle();
}
function luminance(hex) {
  let value = hex.replace('#', '');
  if (value.length === 3) value = [...value].map((char) => char + char).join('');
  const rgb = value
    .match(/../g)
    .map((value) => parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
try {
  assert.equal(await page.locator('.depth-scene,#depth-canvas,.theme-wave').count(), 0);
  for (const theme of ['light', 'dark']) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
      await page.locator('#theme-toggle').click();
      await page.locator(`html[data-theme=${theme}]`).waitFor();
    }
    await settle();
    const palette = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        ['deep', 'silk', 'muted', 'brand', 'accent', 'on-brand', 'mask'].map((key) => [
          key,
          css.getPropertyValue('--' + key).trim(),
        ]),
      );
    });
    for (const [foreground, background] of [
      ['silk', 'deep'],
      ['muted', 'deep'],
      ['on-brand', 'brand'],
      ['brand', 'deep'],
      ['accent', 'deep'],
    ])
      assert.ok(
        contrast(palette[foreground], palette[background]) >= 4.5,
        `${theme}: ${foreground}/${background} contrast`,
      );
    const surfaces = await page.locator('#sheet,#dock,#rail').evaluateAll((elements) =>
      elements.map((element) => {
        const css = getComputedStyle(element);
        return {
          background: css.backgroundColor,
          backdrop: css.backdropFilter,
          image: css.backgroundImage,
        };
      }),
    );
    for (const surface of surfaces) {
      assert.equal(surface.backdrop, 'none');
      assert.equal(surface.image, 'none');
      assert.match(surface.background, /^rgb\(/);
    }
    assert.match(
      await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily),
      /Nunito/,
    );
    await page.screenshot({ path: resolve(artifacts, `solid-${theme}.png`) });
    checks.push(`${theme}: solid surfaces, local rounded font, text and action contrast >=4.5`);
  }
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
    }
    await route('bench', '#view-bench');
    if (width === 1366 && height === 768) {
      await page.evaluate(() => scrollTo(0, 0));
      const dock = await page.locator('#dock').boundingBox();
      assert.ok(dock.y + dock.height <= height, 'Bench transport fits a 1366×768 laptop viewport');
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
    'Bench, editor, library and Learn scale from 360 to 2560 CSS pixels without page overflow',
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
  await page.keyboard.press('Enter');
  await page.locator('#view-machines').waitFor();
  await settle();
  checks.push('Custom navigation supports keyboard focus and activation');
  await route('bench', '#view-bench');
  const before = await page
    .locator('body')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.locator('#theme-toggle').click();
  await page.waitForTimeout(220);
  const middle = await page
    .locator('body')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.waitForTimeout(700);
  const after = await page
    .locator('body')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.notEqual(before, middle);
  assert.notEqual(middle, after);
  checks.push('Theme colors visibly interpolate over time');
  await route('editor', '#view-editor');
  await page.locator('[data-route=settings]').click();
  await page.locator('#panel-settings').waitFor();
  assert.ok(
    await page.locator('#view-editor').isVisible(),
    'Settings preserves the current workspace',
  );
  assert.equal(await page.locator('#drawer').evaluate((dialog) => dialog.matches(':modal')), false);
  await page.locator('[data-route=machines]').click();
  await page.locator('#view-machines').waitFor();
  await page.locator('#drawer').waitFor({ state: 'hidden' });
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
  await page.locator('[data-route=settings]').click();
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
  assert.deepEqual(errors, []);
  const report = { checks, sizes, errors };
  await writeFile(resolve(artifacts, 'appearance-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await run.close();
}
