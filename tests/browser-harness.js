// Playwright harness for exercising app.html headlessly against a local static
// server (e.g. `python3 -m http.server 8934` from the repo root).
//
// Incident this fixes: earlier manual test runs against app.html made repeated
// real, paid calls to the Supabase ai-proxy edge function (Mistral/Groq brief
// generation) even though `page.route()` mocks were registered for it — the
// mocks were silently bypassed because the app registers its own Service
// Worker (sw.js), which intercepts fetches at a layer Playwright's page-level
// routing doesn't reach. One of those unmocked loads was against live
// production (stafflo.app), incurring real cost. `serviceWorkers: 'block'`
// removes the SW layer entirely so `page.route()` reliably catches every
// outbound fetch, including cross-origin ones (Nominatim, ai-proxy).
//
// Always use launchTestContext() instead of `browser.newContext()` directly
// when testing app.html — it blocks service workers and mocks the ai-proxy
// endpoint unconditionally, so no test can accidentally hit the real paid
// backend.

const { chromium } = require('playwright');

const AI_PROXY_PATTERN = '**/functions/v1/ai-proxy';

async function launchTestContext(contextOptions = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...contextOptions,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();

  const aiProxyCalls = [];
  await page.route(AI_PROXY_PATTERN, (route) => {
    aiProxyCalls.push({ url: route.request().url(), time: Date.now() });
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ text: '[]' }),
    });
  });

  return { browser, context, page, aiProxyCalls };
}

module.exports = { launchTestContext, AI_PROXY_PATTERN };
