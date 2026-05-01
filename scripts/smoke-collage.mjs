// 临时脚本：验证拼贴 UI 流。
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PREVIEW_URL = 'https://127.0.0.1:4173';
const FIXTURES_DIR = './test-fixtures';

async function waitForPreview() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(PREVIEW_URL, { method: 'HEAD' });
      if (res.ok) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

async function startPreview() {
  const proc = spawn('npx', ['vite', '--port', '4173', '--host', '127.0.0.1'], {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const ok = await waitForPreview();
  if (!ok) throw new Error('vite dev failed');
  return proc;
}

async function main() {
  const preview = await startPreview();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
  const page = await context.newPage();
  await context.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices || {}, 'getUserMedia', {
      configurable: true,
      value: () => Promise.reject(new DOMException('NotAllowedError', 'NotAllowedError')),
    });
  });

  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  try {
    await page.goto(PREVIEW_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#preview');

    // 直接通过 IndexedDB 注入 6 张照片（绕过相机），然后 reload
    const fixtureNames = [
      'sample-red.png', 'sample-green.png', 'sample-blue.png',
      'sample-skin.png', 'sample-sky.png', 'sample-gray.png',
    ];
    const b64s = fixtureNames.map((n) => readFileSync(`${FIXTURES_DIR}/${n}`).toString('base64'));
    await page.evaluate(async (b64s) => {
      await new Promise((res) => {
        const r = indexedDB.deleteDatabase('dazz-cam');
        r.onsuccess = res; r.onerror = res; r.onblocked = res;
      });
      const db = await new Promise((resolve) => {
        const req = indexedDB.open('dazz-cam', 1);
        req.onupgradeneeded = (e) => {
          const d = e.target.result;
          if (!d.objectStoreNames.contains('photos')) {
            const s = d.createObjectStore('photos', { keyPath: 'id' });
            s.createIndex('ts', 'ts');
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
      });
      const tx = db.transaction('photos', 'readwrite');
      const store = tx.objectStore('photos');
      for (let i = 0; i < b64s.length; i += 1) {
        const bin = atob(b64s[i]);
        const buf = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k);
        const blob = new Blob([buf], { type: 'image/png' });
        const id = `bench_${i}_${Math.random().toString(36).slice(2, 8)}`;
        store.add({ id, ts: Date.now() - (b64s.length - i) * 100, blob, presetId: 'NC' });
      }
      await new Promise((res) => { tx.oncomplete = res; });
    }, b64s);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#preview');
    await sleep(300);

    // 打开相册
    await page.click('#thumbBtn');
    await sleep(300);
    const cellCount = await page.$$eval('.album-cell', (els) => els.length);
    console.log('cell count:', cellCount);

    // 点击拼贴按钮
    await page.click('.album-collage-btn');
    await sleep(150);
    const selectingClass = await page.$eval('.album', (el) => el.classList.contains('is-selecting'));
    console.log('is-selecting class:', selectingClass);

    // 选 3 张
    const cells = await page.$$('.album-cell');
    await cells[0].click();
    await cells[1].click();
    await cells[2].click();
    await sleep(100);
    const selectionCount = await page.$eval('.album-header-selection [data-role="count"]', (el) => el.textContent);
    console.log('selection count:', selectionCount);
    const nextDisabled = await page.$eval('.album-next-btn', (el) => el.disabled);
    console.log('next disabled:', nextDisabled);

    // 取消测试
    await page.click('.album-header-selection [data-act="cancel"]');
    await sleep(150);
    const stillSelecting = await page.$eval('.album', (el) => el.classList.contains('is-selecting'));
    console.log('after cancel, is-selecting:', stillSelecting);

    // 重进，选 6 张，进预览
    await page.click('.album-collage-btn');
    await sleep(100);
    const cells2 = await page.$$('.album-cell');
    for (let i = 0; i < 6; i += 1) await cells2[i].click();
    await sleep(80);
    await page.click('.album-next-btn');
    await sleep(800);
    const panelExists = await page.$('.collage-panel');
    console.log('collage panel exists:', !!panelExists);

    // 切到 3 列
    await page.click('.collage-seg[data-group="columns"] button[data-val="3"]');
    await sleep(600);

    // 触发导出
    const dlPromise = page.waitForEvent('download', { timeout: 10000 });
    const t0 = Date.now();
    await page.click('.collage-export');
    const dl = await dlPromise;
    const ms = Date.now() - t0;
    const path = await dl.path();
    const buf = readFileSync(path);
    console.log('exported file:', dl.suggestedFilename(), 'size:', buf.length, 'B', 'time approx:', ms, 'ms');

    console.log('console errors:', consoleErrors.length);
    if (consoleErrors.length) console.log(consoleErrors.slice(0, 3));
  } finally {
    await browser.close();
    preview.kill('SIGTERM');
    // taskkill 会把当前 node 也杀了，调试时禁用
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
