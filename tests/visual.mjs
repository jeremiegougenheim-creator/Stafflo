// Visual/audit regression harness for app.html — see README.md.
//
// Drives app.html headlessly via ?demo=1 (auth bypass, fake CRM data), across
// 5 screens + 3 modals, 3 widths, 2 languages. Runs auditContrast(),
// auditLabels(), auditTones() at each state (these land in COMMIT A of the
// portage — until then this harness reports SKIP for them, not FAIL).
//
// Safety: reuses launchTestContext() from browser-harness.js (blocks the
// service worker, mocks ai-proxy) and adds a broad supabase.co + Nominatim
// mock on top, so no combination can reach a real paid backend.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { launchTestContext } = require('./browser-harness.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(__dirname, 'shots');
const PORT = 8934;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let reqPath = decodeURIComponent(req.url.split('?')[0]);
      if (reqPath === '/') reqPath = '/app.html';
      const filePath = path.join(REPO_ROOT, reqPath);
      if (!filePath.startsWith(REPO_ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, () => resolve(server));
  });
}

const SCREENS = [
  { key: 'today', open: () => window.goTab('today') },
  { key: 'clients', open: () => window.goTab('clients') },
  { key: 'calendar', open: () => window.goTab('calendar') },
  { key: 'villa', open: () => window.goTab('home') },
  { key: 'inbox', open: () => { if (typeof window.showInbox === 'function') window.showInbox(); } },
];

const MODALS = [
  { key: 'aria', open: () => { if (typeof window.openAriaModal === 'function') window.openAriaModal(); } },
  { key: 'client', open: () => {
      const c = (window.clients || [])[0];
      if (c && typeof window.openDetail === 'function') window.openDetail(c.id);
    } },
  { key: 'settings', open: () => { if (typeof window.openSettings === 'function') window.openSettings(); } },
];

const WIDTHS = [390, 768, 1440];
const LANGS = ['fr', 'en'];

async function auditOrSkip(page, fnName) {
  return page.evaluate((name) => {
    if (typeof window[name] !== 'function') return { skipped: true };
    try {
      return { skipped: false, result: window[name]() };
    } catch (e) {
      return { skipped: false, error: String((e && e.message) || e) };
    }
  }, fnName);
}

function auditFailed(a) {
  return !a.skipped && (a.error || (Array.isArray(a.result) && a.result.length > 0));
}

function resetOverlays() {
  if (typeof window.closeInbox === 'function') window.closeInbox();
  if (typeof window.closeAriaModal === 'function') window.closeAriaModal();
  if (typeof window.closeSettings === 'function') window.closeSettings();
  if (typeof window.closeDetail === 'function') window.closeDetail();
}

async function captureOne(page, key, width, lang, openFn) {
  const consoleErrors = [];
  const onConsole = (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); };
  const onPageError = (err) => consoleErrors.push(String(err));
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  try {
    await page.evaluate(resetOverlays);
  } catch (e) {
    consoleErrors.push(`resetOverlays() threw: ${e}`);
  }
  await page.waitForTimeout(150);

  try {
    await page.evaluate(openFn);
  } catch (e) {
    consoleErrors.push(`open(${key}) threw: ${e}`);
  }
  await page.waitForTimeout(300);

  const contrast = await auditOrSkip(page, 'auditContrast');
  const labels = await auditOrSkip(page, 'auditLabels');
  const tones = await auditOrSkip(page, 'auditTones');

  const shotPath = path.join(SHOTS_DIR, `${key}-${width}-${lang}.png`);
  await page.screenshot({ path: shotPath });

  page.off('console', onConsole);
  page.off('pageerror', onPageError);

  const fail = auditFailed(contrast) || auditFailed(labels) || auditFailed(tones) || consoleErrors.length > 0;
  return { view: key, width, lang, contrast, labels, tones, consoleErrors, fail };
}

async function run() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const server = await startServer();
  const url = `http://localhost:${PORT}/app.html?demo=1`;
  const results = [];

  try {
    for (const width of WIDTHS) {
      for (const lang of LANGS) {
        const { browser, context, page } = await launchTestContext({
          viewport: { width, height: 900 },
        });

        // Broad safety net beyond ai-proxy (already mocked by launchTestContext):
        // demo mode bypasses auth but still calls several edge functions.
        // /rest/v1/ list endpoints (PostgREST) return arrays, not objects —
        // shape the stub accordingly or callers doing `data.filter(...)` throw.
        await context.route('**/*.supabase.co/**', (route) => {
          const isRestList = route.request().url().includes('/rest/v1/');
          route.fulfill({ status: 200, contentType: 'application/json', body: isRestList ? '[]' : '{}' });
        });
        await context.route('**/nominatim.openstreetmap.org/**', (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

        await page.addInitScript((l) => {
          try { localStorage.setItem('stafflo_lang', l); } catch (e) {}
        }, lang);

        try {
          await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        } catch (e) {
          results.push({ view: 'BOOT', width, lang, fail: true, consoleErrors: [String(e)], contrast: {skipped:true}, labels:{skipped:true}, tones:{skipped:true} });
          await browser.close();
          continue;
        }
        await page.waitForTimeout(800);
        await page.evaluate((l) => {
          if (typeof window.setLang === 'function') window.setLang(l);
        }, lang);
        await page.waitForTimeout(200);

        for (const screen of SCREENS) {
          results.push(await captureOne(page, screen.key, width, lang, screen.open));
        }

        for (const modal of MODALS) {
          await page.evaluate(() => { if (typeof window.goTab === 'function') window.goTab('today'); });
          await page.waitForTimeout(150);
          results.push(await captureOne(page, modal.key, width, lang, modal.open));
        }

        await browser.close();
      }
    }
  } finally {
    server.close();
  }

  const auditsExist = results.some((r) => !r.contrast.skipped || !r.labels.skipped || !r.tones.skipped);
  const anyFail = results.some((r) => r.fail);

  console.log('\n=== RÉSULTATS tests/visual.mjs ===');
  for (const r of results) {
    const status = r.fail ? 'FAIL' : (r.contrast.skipped ? 'SKIP (audits absents)' : 'PASS');
    console.log(`${r.view.padEnd(14)} ${String(r.width).padEnd(5)} ${r.lang}  ${status}`);
    for (const e of r.consoleErrors) console.log(`    console error: ${e}`);
    if (r.contrast.error) console.log(`    auditContrast() a levé: ${r.contrast.error}`);
    if (r.labels.error) console.log(`    auditLabels() a levé: ${r.labels.error}`);
    if (r.tones.error) console.log(`    auditTones() a levé: ${r.tones.error}`);
  }

  console.log(`\nCombinaisons testées: ${results.length}`);
  console.log(`Audits présents dans app.html: ${auditsExist ? 'oui' : 'non (normal avant COMMIT A)'}`);
  console.log(`Échecs: ${results.filter((r) => r.fail).length}`);
  console.log(anyFail ? '\n>>> HARNAIS: ROUGE' : '\n>>> HARNAIS: VERT');
  if (!auditsExist) {
    console.log('(auditContrast/auditLabels/auditTones absents — critères 3 à 5 non vérifiables avant COMMIT A)');
  }

  process.exitCode = anyFail ? 1 : 0;
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
