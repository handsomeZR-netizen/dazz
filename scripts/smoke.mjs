// 端到端 smoke 测试：起 vite preview，用 headless Chromium 跑 7 条主路径。
// 用法：node scripts/smoke.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const PREVIEW_URL = 'https://127.0.0.1:4173';
const FIXTURES_DIR = './test-fixtures';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? '  — ' + detail : ''}`);
}

async function waitForPreview() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(PREVIEW_URL, { method: 'HEAD' });
      if (res.ok) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

async function startPreview() {
  const proc = spawn('npx', ['vite', 'preview', '--port', '4173', '--host', '127.0.0.1'], {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  // ignore TLS for localhost self-signed
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const ok = await waitForPreview();
  if (!ok) throw new Error('preview server failed to start');
  return proc;
}

async function clearIndexedDB(page) {
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases?.();
    for (const { name } of dbs || []) {
      if (!name) continue;
      await new Promise((res) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = res;
        req.onerror = res;
        req.onblocked = res;
      });
    }
  });
}

async function getRecordCount(page) {
  return await page.evaluate(async () => {
    return await new Promise((resolve) => {
      const req = indexedDB.open('dazz-cam');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('photos')) {
          db.close();
          return resolve(0);
        }
        const tx = db.transaction('photos', 'readonly');
        tx.objectStore('photos').count().onsuccess = (e) => {
          resolve(e.target.result);
          db.close();
        };
      };
      req.onerror = () => resolve(0);
    });
  });
}

async function waitForToast(page, contains, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const toast = await page.$('#toast:not([hidden])');
    if (toast) {
      const text = await toast.textContent();
      if (text && text.includes(contains)) return text;
    }
    await sleep(80);
  }
  throw new Error(`toast "${contains}" not seen within ${timeoutMs}ms`);
}

async function main() {
  console.log('starting vite preview…');
  const preview = await startPreview();
  console.log('preview up');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    // Stub getUserMedia so the page boots without a real camera.
    await context.addInitScript(() => {
      // Pretend camera is not available — main.js will skip startCamera path.
      Object.defineProperty(navigator.mediaDevices || {}, 'getUserMedia', {
        configurable: true,
        value: () => Promise.reject(new DOMException('NotAllowedError', 'NotAllowedError')),
      });
    });

    // ====== L0: 启动 ======
    const t0 = Date.now();
    await page.goto(PREVIEW_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#preview', { timeout: 5000 });
    const chips = await page.$$('.preset-chip');
    record('L0 启动', chips.length === 10, `${chips.length} preset chips, ${Date.now() - t0}ms`);

    // ====== L1: 切预设 ======
    const ids = [];
    for (let i = 0; i < chips.length; i++) {
      await chips[i].click();
      const active = await page.$('.preset-chip.active .chip-id');
      ids.push(await active.textContent());
      await sleep(50);
    }
    const expected = ['NC', 'FX', 'G', 'D', 'P', 'C', 'E', 'H', 'I', 'L'];
    const idsTrim = ids.map((s) => s.trim());
    record('L1 切 10 个预设', JSON.stringify(idsTrim) === JSON.stringify(expected),
      `got=${idsTrim.join(',')}`);

    // 重置回 NC
    await chips[0].click();
    await clearIndexedDB(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#preview');

    // ====== L2: 单选导入 + 拍照 ======
    const single = `${FIXTURES_DIR}/sample-red.png`;
    const fileInput = await page.$('#importInput');
    await fileInput.setInputFiles(single);
    await waitForToast(page, '已导入图片');
    // 让一帧渲染
    await sleep(400);
    await page.click('#shutterBtn');
    // 给 toBlob + IndexedDB add 一些时间
    await sleep(800);
    let count = await getRecordCount(page);
    record('L2 单选导入 + 快门入库', count === 1, `IndexedDB count = ${count}`);

    // ====== L3: 多选批量 ======
    const fivePngs = [
      `${FIXTURES_DIR}/sample-red.png`,
      `${FIXTURES_DIR}/sample-green.png`,
      `${FIXTURES_DIR}/sample-blue.png`,
      `${FIXTURES_DIR}/sample-skin.png`,
      `${FIXTURES_DIR}/sample-sky.png`,
    ];
    await fileInput.setInputFiles(fivePngs);
    await waitForToast(page, '已导入', 15000);
    await sleep(500);
    count = await getRecordCount(page);
    record('L3 多选批量 5 张', count >= 6, `IndexedDB count = ${count}`);

    // ====== L4: 详情 + share 按钮显隐 ======
    await page.click('#thumbBtn'); // 打开相册
    await sleep(300);
    const firstCell = await page.$('.album-cell');
    if (!firstCell) throw new Error('no album cell');
    await firstCell.click();
    await sleep(300);
    const shareHidden = await page.$eval('#shareBtn', (el) => el.hidden);
    const downloadHref = await page.$eval('#downloadBtn', (a) => a.getAttribute('href'));
    record('L4 详情 + share 显隐', shareHidden === true && /^blob:/.test(downloadHref || ''),
      `shareBtn hidden=${shareHidden}, download=${(downloadHref || '').slice(0, 32)}`);

    // ====== L5: PWA artifacts ======
    // Use plain Node fetch (NODE_TLS_REJECT_UNAUTHORIZED=0) — page.request goes
    // through the SW which routes anything-not-precached back to index.html.
    const manifestRes = await fetch(`${PREVIEW_URL}/manifest.webmanifest`);
    const swRes = await fetch(`${PREVIEW_URL}/sw.js`);
    const manifestJson = manifestRes.ok ? await manifestRes.json() : null;
    const swReady = await page.evaluate(() => navigator.serviceWorker?.ready?.then(() => true).catch(() => false) || false);
    const swActivated = swReady === true;
    record('L5 PWA manifest+sw',
      manifestRes.ok && swRes.ok && manifestJson?.name === 'Dazz Web' && swActivated,
      `manifest ${manifestRes.status}, sw ${swRes.status}, name="${manifestJson?.name}", swReady=${swActivated}`);

    // ====== L6: 离线访问 ======
    await context.setOffline(true);
    let offlineOk = false;
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 5000 });
      await page.waitForSelector('#preview', { timeout: 3000 });
      offlineOk = true;
    } catch (e) {
      offlineOk = false;
    }
    record('L6 离线刷新', offlineOk);
    await context.setOffline(false);

    // ====== L7: 画幅切换 (P1-8) ======
    await context.setOffline(false);
    const ratioStates = [];
    for (let i = 0; i < 4; i++) {
      await page.click('#ratioBtn');
      await sleep(120);
      ratioStates.push(await page.$eval('.frame', (el) => el.dataset.aspect));
    }
    // 期望循环一遍后，结尾正好回到起点的下一个（4 次点击 = 完整循环）
    const distinctAspects = new Set(ratioStates);
    record('L7 画幅切换 4 比例', distinctAspects.size === 4,
      `seen=[${ratioStates.join(',')}]`);

    // ====== L8: 相册分组 tab (P1-9) ======
    await page.click('#thumbBtn');
    await sleep(300);
    const tabs = await page.$$('#albumTabs .album-tab, #albumTabs .album-tab-add');
    const tabsCount = tabs.length;
    const allTabText = await page.$eval('#albumTabs .album-tab', (el) => el.textContent.trim()).catch(() => '');
    record('L8 相册分组 tab 条', tabsCount >= 2 && /ALL/.test(allTabText),
      `tabs=${tabsCount}, first="${allTabText}"`);

    // ====== L9: 拼贴入口 (P1-11) ======
    const collageBtn = await page.$('.album-collage-btn');
    record('L9 拼贴按钮存在', !!collageBtn);

    // ====== L10: 控制台无错误 ======
    record('L10 控制台无错误', consoleErrors.length === 0,
      consoleErrors.length ? `${consoleErrors.length} errors: ${consoleErrors[0].slice(0, 80)}` : '');
  } finally {
    await browser.close();
    preview.kill('SIGTERM');
    if (process.platform === 'win32') {
      // vite preview 在 Windows 下经常残留 node 进程，强杀
      try {
        spawn('taskkill', ['/F', '/IM', 'node.exe'], { stdio: 'ignore' });
      } catch {}
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n=== ${passed}/${total} passed ===`);
  if (passed < total) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
