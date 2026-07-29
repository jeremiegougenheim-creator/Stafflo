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
//
// Ratchet, not tolerance (per-combination, tests/baseline.json): the current
// app.html carries real pre-existing contrast/label debt (hundreds of hits,
// dominated by a handful of color pairs — see RAPPORT-PORTAGE.md, COMMIT A).
// Fixing all of it is COMMIT B/D's job, not every commit's. So the gate is:
// for each (view, width, lang), auditContrast()/auditLabels() failure counts
// must never EXCEED the last recorded baseline. A commit that lowers a count
// tightens the ratchet (baseline.json is rewritten to the new, lower value);
// a commit that raises any single count is a hard regression and fails the
// run, full stop — no averaging across combinations. auditTones() has no
// ratchet: any "couleur d'état sur une action" is a hard fail, always.

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
const BASELINE_PATH = path.join(__dirname, 'baseline.json');
const PORT = 8934;

function loadBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveBaseline(data) {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(data, null, 2) + '\n');
}

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

// Tones has no ratchet: auditTones() returns {etats, fautes}, not an array —
// any non-empty `fautes` (state color on an action element) is a hard fail.
function tonesFailed(a) {
  return !a.skipped && (a.error || (a.result && Array.isArray(a.result.fautes) && a.result.fautes.length > 0));
}

// Count of findings for a ratchet-tracked audit (contrast/labels), or null
// when the audit doesn't exist yet (pre-COMMIT-A) or threw. auditLabels()
// still returns a bare array; auditContrast() returns {echecs, indetermines}
// since COMMIT A-bis — the ratchet only ever counts echecs (real failures).
function auditCount(a) {
  if (a.skipped || a.error) return null;
  if (Array.isArray(a.result)) return a.result.length;
  if (a.result && Array.isArray(a.result.echecs)) return a.result.echecs.length;
  return null;
}

// Indéterminés (dégradés non résolus) sur auditContrast() — informatif
// uniquement, hors cliquet.
function indetermineCount(a) {
  if (a.skipped || a.error || !a.result || !Array.isArray(a.result.indetermines)) return null;
  return a.result.indetermines.length;
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

  // COMMIT P : débordement horizontal — mesurable, donc jamais toléré, sur
  // aucune combinaison. Pas de cliquet ici (contrairement à contraste/labels) :
  // scrollWidth > innerWidth est un fait binaire, pas un compte qui peut
  // légitimement varier d'une passe à l'autre.
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  const overflowFail = overflow.scrollWidth > overflow.innerWidth;

  const shotPath = path.join(SHOTS_DIR, `${key}-${width}-${lang}.png`);
  await page.screenshot({ path: shotPath });

  page.off('console', onConsole);
  page.off('pageerror', onPageError);

  // Hard fails: console/page errors, thrown audits, a tone violation, or
  // horizontal overflow. Ratchet comparison (contrast/labels counts vs
  // baseline) happens in run(), once every combo's counts are known.
  const hardFail = tonesFailed(tones) || contrast.error || labels.error || consoleErrors.length > 0 || overflowFail;
  return {
    view: key, width, lang, contrast, labels, tones, consoleErrors,
    contrastCount: auditCount(contrast), labelsCount: auditCount(labels),
    indetermineCount: indetermineCount(contrast),
    overflow, overflowFail,
    hardFail,
  };
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
          reducedMotion: 'reduce',
        });

        // app.html has ~11 setInterval-driven re-renders (tagline rotation,
        // ARIA counter, autosave/inbox refresh, kebab injection...). Left
        // running, one can fire mid-capture at a wall-clock-dependent moment
        // and change the DOM out from under a later screen in the same
        // session — this made auditContrast()/auditLabels() counts flaky
        // (same code, same combo, different count between two full runs).
        // Freeze all of them; setTimeout (used for the one-shot demo boot
        // chain: generateAlerts/loadMorningBrief) is untouched.
        await page.addInitScript(() => { window.setInterval = () => 0; });

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
        await context.route('**/api.exchangerate-api.com/**', (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rates: { USD: 1.08, MAD: 10.8, GBP: 0.85 } }) }));

        await page.addInitScript((l) => {
          try { localStorage.setItem('stafflo_lang', l); } catch (e) {}
        }, lang);

        try {
          await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        } catch (e) {
          results.push({
            view: 'BOOT', width, lang, hardFail: true, consoleErrors: [String(e)],
            contrast: { skipped: true }, labels: { skipped: true }, tones: { skipped: true },
            contrastCount: null, labelsCount: null,
          });
          await browser.close();
          continue;
        }
        await page.waitForTimeout(800);
        await page.evaluate((l) => {
          if (typeof window.setLang === 'function') window.setLang(l);
        }, lang);
        // setLang() schedules generateAlerts (+200ms) and loadMorningBrief
        // (+500ms) via setTimeout. Wait past both here, once, instead of
        // letting them fire mid-run and land on an arbitrary later screen —
        // that's what made contrast/label counts non-deterministic run to run.
        await page.waitForTimeout(700);

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
  const oldBaseline = loadBaseline();
  const bootstrapping = auditsExist && !oldBaseline;

  // Per-combo ratchet comparison: current count must never exceed the last
  // recorded baseline for that exact (view, width, lang). No global average.
  const newBaseline = {};
  let regression = false;
  for (const r of results) {
    const key = `${r.view}-${r.width}-${r.lang}`;
    if (r.contrastCount === null && r.labelsCount === null) continue; // audits absent, nothing to ratchet
    const prev = oldBaseline && oldBaseline[key];
    r.prevContrast = prev ? prev.contrast : null;
    r.regressed = [];
    if (prev) {
      if (r.contrastCount !== null && r.contrastCount > prev.contrast) {
        r.regressed.push(`contrast ${prev.contrast} -> ${r.contrastCount}`);
      }
      if (r.labelsCount !== null && r.labelsCount > prev.labels) {
        r.regressed.push(`labels ${prev.labels} -> ${r.labelsCount}`);
      }
    }
    if (r.regressed.length) regression = true;
    newBaseline[key] = {
      contrast: r.contrastCount !== null ? r.contrastCount : (prev ? prev.contrast : null),
      labels: r.labelsCount !== null ? r.labelsCount : (prev ? prev.labels : null),
    };
  }

  const anyFail = results.some((r) => r.hardFail) || regression;

  console.log('\n=== RÉSULTATS tests/visual.mjs ===');
  for (const r of results) {
    const ratchetBad = r.regressed && r.regressed.length > 0;
    const fail = r.hardFail || ratchetBad;
    const status = fail ? 'FAIL' : (r.contrastCount === null && r.labelsCount === null ? 'SKIP (audits absents)' : 'PASS');
    const oldTotal = r.prevContrast != null ? r.prevContrast : '?';
    const counts = r.contrastCount !== null
      ? ` [contraste:${r.contrastCount} indéterminés:${r.indetermineCount ?? 0} ancien-total:${oldTotal} labels:${r.labelsCount}]`
      : '';
    console.log(`${r.view.padEnd(14)} ${String(r.width).padEnd(5)} ${r.lang}  ${status}${counts}`);
    for (const e of r.consoleErrors) console.log(`    console error: ${e}`);
    if (r.contrast.error) console.log(`    auditContrast() a levé: ${r.contrast.error}`);
    if (r.labels.error) console.log(`    auditLabels() a levé: ${r.labels.error}`);
    if (r.tones.error) console.log(`    auditTones() a levé: ${r.tones.error}`);
    if (r.overflowFail) console.log(`    DÉBORDEMENT HORIZONTAL: scrollWidth ${r.overflow.scrollWidth} > innerWidth ${r.overflow.innerWidth}`);
    if (ratchetBad) console.log(`    RÉGRESSION cliquet: ${r.regressed.join(', ')}`);
  }

  console.log(`\nCombinaisons testées: ${results.length}`);
  console.log(`Audits présents dans app.html: ${auditsExist ? 'oui' : 'non (normal avant COMMIT A)'}`);
  console.log(`Échecs (hors cliquet): ${results.filter((r) => r.hardFail).length}`);
  console.log(`Régressions de cliquet: ${results.filter((r) => r.regressed && r.regressed.length).length}`);

  if (bootstrapping) {
    saveBaseline(newBaseline);
    console.log(`\nCliquet armé pour la première fois -> tests/baseline.json (${Object.keys(newBaseline).length} combinaisons).`);
  } else if (auditsExist && !regression) {
    saveBaseline(newBaseline);
    console.log('\nCliquet resserré (ou inchangé) -> tests/baseline.json mis à jour.');
  } else if (regression) {
    console.log('\ntests/baseline.json NON modifié (régression détectée, ratchet non resserré).');
  }

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
