/**
 * js/patches/whatsapp.js
 * WhatsApp integration patch — v2
 *
 * Responsibilities:
 *   1. Override sendByWhatsApp() to use configured villa number
 *   2. Inject cfgWhatsappNumber field into Settings panel
 *   3. Patch saveSettings() / openSettings() to persist number
 *   4. Sync number with Supabase villas.whatsapp_number (+ localStorage fallback)
 *
 * To update this patch:
 *   - Edit only this file
 *   - The loader (js/patches/index.js) will pick it up automatically
 *   - No changes needed in app.html
 */
(function () {
  'use strict';

  const SUPA_URL = 'https://rcjhgilpmojohmrqzokx.supabase.co';
  const SUPA_KEY = 'sb_publishable_ChHp5umEU0Gd6R7N1x3-UA_KyDqpWF8';
  const LS_KEY   = 'stafflo_whatsapp_number';

  // ── AUTH HEADER ────────────────────────────────────────────────────────────
  function getAuthHeader() {
    try {
      const raw    = localStorage.getItem('sb-rcjhgilpmojohmrqzokx-auth-token');
      const token  = raw && JSON.parse(raw)?.access_token;
      if (token) return { Authorization: 'Bearer ' + token, apikey: SUPA_KEY };
    } catch (_) {}
    return { Authorization: 'Bearer ' + SUPA_KEY, apikey: SUPA_KEY };
  }

  // ── SUPABASE LOAD ──────────────────────────────────────────────────────────
  async function loadFromSupabase() {
    try {
      const res  = await fetch(SUPA_URL + '/rest/v1/villas?select=whatsapp_number&limit=1', {
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const num = (await res.json())?.[0]?.whatsapp_number || '';
      if (num) localStorage.setItem(LS_KEY, num); // keep LS in sync
      return num;
    } catch (e) {
      console.warn('[WA] load failed, fallback to localStorage:', e.message);
      return localStorage.getItem(LS_KEY) || '';
    }
  }

  // ── SUPABASE SAVE ──────────────────────────────────────────────────────────
  async function saveToSupabase(number) {
    localStorage.setItem(LS_KEY, number); // always persist locally first
    try {
      const id = (await (await fetch(SUPA_URL + '/rest/v1/villas?select=id&limit=1', {
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' }
      })).json())?.[0]?.id;
      if (!id) throw new Error('no villa');
      const res = await fetch(SUPA_URL + '/rest/v1/villas?id=eq.' + id, {
        method : 'PATCH',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body   : JSON.stringify({ whatsapp_number: number })
      });
      if (!res.ok) throw new Error('PATCH HTTP ' + res.status);
      console.info('[WA] saved to Supabase ✓');
    } catch (e) {
      console.warn('[WA] save failed, kept in localStorage:', e.message);
    }
  }

  // ── 1. sendByWhatsApp ──────────────────────────────────────────────────────
  window.sendByWhatsApp = function () {
    const msg = document.getElementById('msgBody')?.textContent?.trim() || '';
    if (!msg) { if (window.toast) toast('Aucun message à envoyer'); return; }
    const num = (localStorage.getItem(LS_KEY) || '').replace(/\s+/g, '');
    window.open(
      num
        ? 'https://wa.me/' + num.replace('+', '') + '?text=' + encodeURIComponent(msg)
        : 'https://wa.me/?text=' + encodeURIComponent(msg),
      '_blank'
    );
  };

  // ── 2. Inject Settings field ───────────────────────────────────────────────
  function injectField(prefill) {
    const cfgWa = document.getElementById('cfgWa');
    if (!cfgWa) return;
    const existing = document.getElementById('cfgWhatsappNumber');
    if (existing) { existing.value = prefill || localStorage.getItem(LS_KEY) || ''; return; }

    const wrapper = cfgWa.closest('.field') || cfgWa.parentElement;
    if (!wrapper) return;

    const div = document.createElement('div');
    div.className = 'field';
    div.innerHTML =
      '<label>📱 Numéro WhatsApp (envoi messages)</label>' +
      '<input id="cfgWhatsappNumber" type="tel" placeholder="+212612345678" autocomplete="tel"' +
      ' style="width:100%;padding:11px 13px;border:1.5px solid var(--border);border-radius:10px;' +
      'font-family:\'DM Sans\',sans-serif;font-size:14px;color:var(--ink);background:var(--paper);outline:none">' +
      '<div style="font-size:10px;color:var(--muted);margin-top:3px">Format international · ex: +212612345678 · Syncé Supabase ☁️</div>';
    wrapper.parentNode.insertBefore(div, wrapper.nextSibling);
    document.getElementById('cfgWhatsappNumber').value = prefill || localStorage.getItem(LS_KEY) || '';
  }

  // ── 3. Patch saveSettings ──────────────────────────────────────────────────
  const origSave = window.saveSettings;
  if (origSave && !origSave._waPatch) {
    window.saveSettings = function () {
      const num = document.getElementById('cfgWhatsappNumber')?.value?.trim();
      if (num) saveToSupabase(num);
      return origSave.apply(this, arguments);
    };
    window.saveSettings._waPatch = true;
  }

  // ── 4. Patch openSettings ──────────────────────────────────────────────────
  const origOpen = window.openSettings;
  if (origOpen && !origOpen._waPatch) {
    window.openSettings = function () {
      const r = origOpen.apply(this, arguments);
      setTimeout(() => loadFromSupabase().then(injectField), 80);
      return r;
    };
    window.openSettings._waPatch = true;
  }

  // ── 5. Init — warm cache ───────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadFromSupabase);
  } else {
    loadFromSupabase();
  }

})();
