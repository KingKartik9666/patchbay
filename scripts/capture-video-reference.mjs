import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const source = process.argv[2];
if (!source) throw new Error('Provide the reference MP4 path.');
const output = resolve(import.meta.dirname, '../tmp/ref/video-depth');
await mkdir(output, { recursive: true });
const recording = await readFile(source);
const server = createServer((request, response) => {
  if (request.url !== '/reference.mp4') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<style>html,body{margin:0;background:#141414;width:100%;height:100%}video{width:100%;height:100%;object-fit:contain;display:block}</style><video muted preload="auto" src="/reference.mp4"></video>');
    return;
  }
  const match = request.headers.range?.match(/bytes=(\d+)-(\d*)/);
  const start = match ? Number(match[1]) : 0;
  const end = match?.[2] ? Math.min(Number(match[2]), recording.length - 1) : recording.length - 1;
  response.setHeader('Content-Type', 'video/mp4');
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Length', end - start + 1);
  if (match) { response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${recording.length}`); }
  response.end(recording.subarray(start, end + 1));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  const metadata = await page.locator('video').evaluate(video => ({ width: video.videoWidth, height: video.videoHeight, duration: video.duration }));
  const frames = [];
  for (const [index, fraction] of [0, .12, .28, .45, .64, .82, .97].entries()) {
    const time = Math.min(metadata.duration - .04, metadata.duration * fraction);
    await page.locator('video').evaluate(async (video, time) => {
      if (Math.abs(video.currentTime - time) > .01) {
        await new Promise(done => { video.addEventListener('seeked', done, { once: true }); video.currentTime = time; });
      }
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    }, time);
    const file = `frame-${String(index).padStart(2, '0')}.png`;
    await page.screenshot({ path: resolve(output, file) });
    frames.push({ time, file });
  }
  await writeFile(resolve(output, 'capture.json'), JSON.stringify({ source: resolve(source), bytes: recording.length, viewport: { width: 1440, height: 900 }, ...metadata, frames }, null, 2));
  console.log(JSON.stringify({ output, ...metadata, frames }, null, 2));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
