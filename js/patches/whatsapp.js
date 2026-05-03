/**
 * js/patches/whatsapp.js  —  v2.1
 * ─────────────────────────────────────────────────────────────────────────────
 * WhatsApp integration patch
 *
 * What it does:
 *   1. Overrides  window.sendByWhatsApp()  to use the configured villa number
 *   2. Injects a  #cfgWhatsappNumber  field into the Settings panel
 *   3. Patches   saveSettings()  to persist the number
 *   4. Patches   openSettings()  to prefill the field from Supabase
 *   5. Syncs the number to  villas.whatsapp_number  (Supabase REST)
 *   6. Always keeps a localStorage copy as offline fallback
 *
 * To edit config: change SUPA_URL / SUPA_KEY only.
 * To add behaviour: add a new section at the bottom — don't touch helpers.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  // ── CONFIG ──────────────────────────────────────────────────────────────────
  const SUPA_URL = 'https://rcjhgilpmojohmrqzokx.supabase.co';
  const SUPA_KEY = 'sb_publishable_ChHp5umEU0Gd6R7N1x3-UA_KyDqpWF8';
  const LS_KEY   = 'stafflo_whatsapp_number';

  // ── HELPERS — don't modify unless you know what you're doing ────────────────

  function getHeaders() {
    try {
      const raw   = localStorage.getItem('sb-rcjhgilpmojohmrqzokx-auth-token');
      const token = raw && JSON.parse(raw)?.access_token;
      if (token) return { Authorization: 'Bearer ' + token, apikey: SUPA_KEY, 'Content-Type': 'application/json' };
    } catch (_) {}
    return { Authorization: 'Bearer ' + SUPA_KEY, apikey: SUPA_KEY, 'Content-Type': 'application/json' };
  }

  async function dbLoad() {
    try {
      const res  = await fetch(SUPA_URL + '/rest/v1/villas?select=whatsapp_number&limit=1', { headers: getHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const num  = (await res.json())?.[0]?.whatsapp_number || '';
      if (num) localStorage.setItem(LS_KEY, num);
      return num;
    } catch (e) {
      console.warn('[WA] load failed → localStorage fallback:', e.message);
      return localStorage.getItem(LS_KEY) || '';
    }
  }

  async function dbSave(number) {
    localStorage.setItem(LS_KEY, number); // always write locally first
    try {
      const rows = await (await fetch(SUPA_URL + '/rest/v1/villas?select=id&limit=1', { headers: getHeaders() })).json();
      const id   = rows?.[0]?.id;
      if (!id) throw new Error('no villa row');
      const res  = await fetch(SUPA_URL + '/rest/v1/villas?id=eq.' + id, {
        method: 'PATCH',
        headers: { ...getHeaders(), Prefer: 'return=minimal' },
        body: JSON.stringify({ whatsapp_number: number })
      });
      if (!res.ok) throw new Error('PATCH ' + res.status);
      console.info('[WA] ✓ saved to Supabase');
    } catch (e) {
      console.warn('[WA] save failed → kept in localStorage:', e.message);
    }
  }

  // ── 1. sendByWhatsApp ───────────────────────────────────────────────────────
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

  // ── 2. Settings field injection ─────────────────────────────────────────────
  function injectField(prefill) {
    const anchor = document.getElementById('cfgWa');
    if (!anchor) return;
    const existing = document.getElementById('cfgWhatsappNumber');
    if (existing) { existing.value = prefill || localStorage.getItem(LS_KEY) || ''; return; }

    const wrap = anchor.closest('.field') || anchor.parentElement;
    if (!wrap) return;

    const div = document.createElement('div');
    div.className = 'field';
    div.innerHTML =
      '<label>📱 Numéro WhatsApp (envoi messages)</label>' +
      '<input id="cfgWhatsappNumber" type="tel" placeholder="+212612345678" autocomplete="tel"' +
      ' style="width:100%;padding:11px 13px;border:1.5px solid var(--border);border-radius:10px;' +
      'font-family:\'DM Sans\',sans-serif;font-size:14px;color:var(--ink);background:var(--paper);outline:none">' +
      '<div style="font-size:10px;color:var(--muted);margin-top:3px">' +
      'Format international · ex: +212612345678 · Syncé Supabase ☁️</div>';
    wrap.parentNode.insertBefore(div, wrap.nextSibling);
    document.getElementById('cfgWhatsappNumber').value = prefill || localStorage.getItem(LS_KEY) || '';
  }

  // ── 3. Patch saveSettings ───────────────────────────────────────────────────
  const _origSave = window.saveSettings;
  if (_origSave && !_origSave._waPatch) {
    window.saveSettings = function () {
      const num = document.getElementById('cfgWhatsappNumber')?.value?.trim();
      if (num) dbSave(num); // async, non-blocking
      return _origSave.apply(this, arguments);
    };
    window.saveSettings._waPatch = true;
  }

  // ── 4. Patch openSettings ───────────────────────────────────────────────────
  const _origOpen = window.openSettings;
  if (_origOpen && !_origOpen._waPatch) {
    window.openSettings = function () {
      const r = _origOpen.apply(this, arguments);
      setTimeout(() => dbLoad().then(injectField), 80);
      return r;
    };
    window.openSettings._waPatch = true;
  }

  // ── 5. Init — warm localStorage cache on page load ──────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', dbLoad);
  } else {
    dbLoad();
  }

})();
