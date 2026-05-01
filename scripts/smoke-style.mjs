// 离线 smoke：直接在 chromium 里 import 我们的 style-transfer.js（dev server）
// 跑一次 styleTransfer，输出耗时、输出尺寸。
//
// 用法：node scripts/smoke-style.mjs
//
// 前置：npm run build && npm run preview （或者 npx vite dev），preview 在 4173。
// 这里我们走 preview。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const PREVIEW_URL = 'https://127.0.0.1:5174';

async function waitForPreview() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(PREVIEW_URL, { method: 'HEAD' });
      if (res.ok || res.status === 404) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

async function startPreview() {
  // 用 vite dev 服务（serve 源文件，方便直接 import('/src/...')）
  const proc = spawn('npx', ['vite', '--port', '5174', '--host', '127.0.0.1'], {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => process.stderr.write('[vite] ' + d.toString()));
  proc.stderr.on('data', (d) => process.stderr.write('[vite-err] ' + d.toString()));
  const ok = await waitForPreview();
  if (!ok) throw new Error('dev server failed to start');
  return proc;
}

async function main() {
  console.log('starting preview…');
  const preview = await startPreview();
  const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));

  try {
    await page.goto(PREVIEW_URL);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const result = await page.evaluate(async () => {
      const t0 = performance.now();
      // 生成两张测试图（content + style），256x256 RGBA gradient
      function makeBitmap(seedR, seedG, seedB, w = 256, h = 256) {
        const c = new OffscreenCanvas(w, h);
        const ctx = c.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, `rgb(${seedR},${seedG},${seedB})`);
        grad.addColorStop(1, `rgb(${255 - seedR},${255 - seedG},${255 - seedB})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        // 加几条线增加结构
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 6;
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.moveTo(0, (i + 1) * h / 6);
          ctx.lineTo(w, (i + 1) * h / 6 + (seedR - 128));
          ctx.stroke();
        }
        return c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      }

      const contentBlob = await makeBitmap(80, 120, 200);
      const styleBlob = await makeBitmap(220, 60, 30);

      const tLoad0 = performance.now();
      const mod = await import('/src/style-transfer.js');
      const tLoad1 = performance.now();

      const tWarm0 = performance.now();
      await mod.warmupModel((s) => console.log('[warmup]', s));
      const tWarm1 = performance.now();

      const tInfer0 = performance.now();
      const r = await mod.styleTransfer(contentBlob, styleBlob, {
        onProgress: (s) => console.log('[infer]', s),
      });
      const tInfer1 = performance.now();

      return {
        moduleLoadMs: Math.round(tLoad1 - tLoad0),
        modelDownloadMs: Math.round(tWarm1 - tWarm0),
        inferenceMs: Math.round(tInfer1 - tInfer0),
        totalMs: Math.round(performance.now() - t0),
        outputW: r.w,
        outputH: r.h,
        outputBytes: r.blob.size,
        innerMs: r.ms,
      };
    });

    console.log('=== style transfer smoke result ===');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
    preview.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
