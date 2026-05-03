/**
 * whatsapp-patch.js v2
 * - Reads/writes whatsapp_number from Supabase villas table
 * - Falls back to localStorage if Supabase unavailable
 * - Patches sendByWhatsApp(), saveSettings(), openSettings()
 */
(function () {
  'use strict';

  const SUPA_URL  = 'https://rcjhgilpmojohmrqzokx.supabase.co';
  const SUPA_KEY  = 'sb_publishable_ChHp5umEU0Gd6R7N1x3-UA_KyDqpWF8';
  const LS_KEY    = 'stafflo_whatsapp_number';

  // ── HELPERS ────────────────────────────────────────────────────────────────

  function getAuthHeader() {
    try {
      const raw = localStorage.getItem('sb-rcjhgilpmojohmrqzokx-auth-token');
      if (raw) {
        const parsed = JSON.parse(raw);
        const token  = parsed?.access_token;
        if (token) return { 'Authorization': 'Bearer ' + token, 'apikey': SUPA_KEY };
      }
    } catch(e) {}
    return { 'Authorization': 'Bearer ' + SUPA_KEY, 'apikey': SUPA_KEY };
  }

  async function loadWaFromSupabase() {
    try {
      const res = await fetch(
        SUPA_URL + '/rest/v1/villas?select=whatsapp_number&limit=1',
        { headers: { ...getAuthHeader(), 'Content-Type': 'application/json' } }
      );
      if (!res.ok) throw new Error('status ' + res.status);
      const data = await res.json();
      const num  = data?.[0]?.whatsapp_number || '';
      if (num) localStorage.setItem(LS_KEY, num);
      return num;
    } catch (e) {
      console.warn('[WA-patch] Supabase load failed, using localStorage:', e.message);
      return localStorage.getItem(LS_KEY) || '';
    }
  }

  async function saveWaToSupabase(number) {
    localStorage.setItem(LS_KEY, number);
    try {
      const res = await fetch(
        SUPA_URL + '/rest/v1/villas?select=id&limit=1',
        { headers: { ...getAuthHeader(), 'Content-Type': 'application/json' } }
      );
      if (!res.ok) throw new Error('status ' + res.status);
      const data = await res.json();
      const id   = data?.[0]?.id;
      if (!id) throw new Error('no villa found');

      const upd = await fetch(
        SUPA_URL + '/rest/v1/villas?id=eq.' + id,
        {
          method : 'PATCH',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body   : JSON.stringify({ whatsapp_number: number })
        }
      );
      if (!upd.ok) throw new Error('patch status ' + upd.status);
      console.info('[WA-patch] WhatsApp number saved to Supabase ✓');
    } catch (e) {
      console.warn('[WA-patch] Supabase save failed, kept in localStorage:', e.message);
    }
  }

  // ── 1. OVERRIDE sendByWhatsApp ────────────────────────────────────────────
  window.sendByWhatsApp = function () {
    const msg = document.getElementById('msgBody')?.textContent?.trim() || '';
    if (!msg) { if (window.toast) toast('Aucun message à envoyer'); return; }
    const num = (localStorage.getItem(LS_KEY) || '').replace(/\s+/g, '');
    const url = num
      ? 'https://wa.me/' + num.replace('+', '') + '?text=' + encodeURIComponent(msg)
      : 'https://wa.me/?text=' + encodeURIComponent(msg);
    window.open(url, '_blank');
  };

  // ── 2. INJECT field in Settings panel ────────────────────────────────────
  function injectWaField(prefillValue) {
    var cfgWa = document.getElementById('cfgWa');
    if (!cfgWa) return;
    if (document.getElementById('cfgWhatsappNumber')) {
      document.getElementById('cfgWhatsappNumber').value = prefillValue || localStorage.getItem(LS_KEY) || '';
      return;
    }
    var wrapper = cfgWa.closest('.field') || cfgWa.parentElement;
    if (!wrapper) return;

    var div = document.createElement('div');
    div.className = 'field';
    div.innerHTML =
      '<label>📱 Numéro WhatsApp (envoi messages)</label>' +
      '<input id="cfgWhatsappNumber" type="tel" placeholder="+212612345678" autocomplete="tel"' +
      ' style="width:100%;padding:11px 13px;border:1.5px solid var(--border);border-radius:10px;' +
      'font-family:\'DM Sans\',sans-serif;font-size:14px;color:var(--ink);background:var(--paper);outline:none;transition:border-color .2s">' +
      '<div style="font-size:10px;color:var(--muted);margin-top:3px">Format international · ex: +212612345678 · Syncé Supabase ☁️</div>';

    wrapper.parentNode.insertBefore(div, wrapper.nextSibling);
    document.getElementById('cfgWhatsappNumber').value = prefillValue || localStorage.getItem(LS_KEY) || '';
  }

  // ── 3. PATCH saveSettings ─────────────────────────────────────────────────
  var origSave = window.saveSettings;
  if (origSave && !origSave._waPatchApplied) {
    window.saveSettings = function () {
      var el  = document.getElementById('cfgWhatsappNumber');
      var num = el ? el.value.trim() : '';
      if (num) saveWaToSupabase(num);
      return origSave.apply(this, arguments);
    };
    window.saveSettings._waPatchApplied = true;
  }

  // ── 4. PATCH openSettings ─────────────────────────────────────────────────
  var origOpen = window.openSettings;
  if (origOpen && !origOpen._waPatchApplied) {
    window.openSettings = function () {
      var result = origOpen.apply(this, arguments);
      setTimeout(function () {
        loadWaFromSupabase().then(function (num) {
          injectWaField(num);
        });
      }, 80);
      return result;
    };
    window.openSettings._waPatchApplied = true;
  }

  // ── 5. INIT — warm cache ─────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { loadWaFromSupabase(); });
  } else {
    loadWaFromSupabase();
  }

})();
