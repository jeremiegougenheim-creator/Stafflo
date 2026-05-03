/**
 * whatsapp-patch.js
 * Patches sendByWhatsApp() to use the configured number from Settings.
 * Adds the cfgWhatsappNumber field to the Settings panel on DOMContentLoaded.
 * Include this script at the end of app.html <body>.
 */
(function() {
  'use strict';

  // ── 1. OVERRIDE sendByWhatsApp ─────────────────────────────────────────────
  window.sendByWhatsApp = function() {
    const msg = document.getElementById('msgBody')?.textContent?.trim() || '';
    if (!msg) { if (window.toast) toast('Aucun message à envoyer'); return; }
    const saved = localStorage.getItem('stafflo_whatsapp_number') || '';
    const num = saved.replace(/\s+/g, '');
    const url = num
      ? 'https://wa.me/' + num.replace('+', '') + '?text=' + encodeURIComponent(msg)
      : 'https://wa.me/?text=' + encodeURIComponent(msg);
    window.open(url, '_blank');
  };

  // ── 2. INJECT cfgWhatsappNumber FIELD IN SETTINGS PANEL ───────────────────
  function injectWaField() {
    // Find the cfgWa input that already exists
    var cfgWa = document.getElementById('cfgWa');
    if (!cfgWa) return; // settings panel not yet rendered, retry
    if (document.getElementById('cfgWhatsappNumber')) return; // already injected

    var wrapper = cfgWa.closest('.field') || cfgWa.parentElement;
    if (!wrapper) return;

    var div = document.createElement('div');
    div.className = 'field';
    div.innerHTML = [
      '<label>📱 Numéro WhatsApp pour envoi messages</label>',
      '<input id="cfgWhatsappNumber" type="tel"',
      '  placeholder="+212612345678" autocomplete="tel"',
      '  style="width:100%;padding:11px 13px;border:1.5px solid var(--border);border-radius:10px;',
      '  font-family:\'DM Sans\',sans-serif;font-size:14px;color:var(--ink);background:var(--paper);outline:none;transition:border-color .2s"',
      '  oninput="localStorage.setItem(\'stafflo_whatsapp_number\',this.value.trim())">',
      '<div style="font-size:10px;color:var(--muted);margin-top:3px">',
      '  Format international sans espaces · ex: +212612345678',
      '</div>'
    ].join('');

    // Insert after the cfgWa field
    wrapper.parentNode.insertBefore(div, wrapper.nextSibling);

    // Pre-fill saved value
    var saved = localStorage.getItem('stafflo_whatsapp_number') || '';
    document.getElementById('cfgWhatsappNumber').value = saved;
  }

  // ── 3. PATCH saveSettings / loadSettings IF THEY EXIST ────────────────────
  function patchSettingsFunctions() {
    // Wrap saveSettings to also persist the WA number
    var origSave = window.saveSettings;
    if (origSave && !origSave._waPatchApplied) {
      window.saveSettings = function() {
        var el = document.getElementById('cfgWhatsappNumber');
        if (el && el.value.trim()) {
          localStorage.setItem('stafflo_whatsapp_number', el.value.trim());
        }
        return origSave.apply(this, arguments);
      };
      window.saveSettings._waPatchApplied = true;
    }

    // Wrap loadSettings / openSettings to restore the WA number
    var origOpen = window.openSettings;
    if (origOpen && !origOpen._waPatchApplied) {
      window.openSettings = function() {
        var result = origOpen.apply(this, arguments);
        // After panel opens, fill in the number (slight delay for DOM)
        setTimeout(function() {
          injectWaField();
          var el = document.getElementById('cfgWhatsappNumber');
          if (el) el.value = localStorage.getItem('stafflo_whatsapp_number') || '';
        }, 80);
        return result;
      };
      window.openSettings._waPatchApplied = true;
    }
  }

  // ── 4. INIT ────────────────────────────────────────────────────────────────
  function init() {
    patchSettingsFunctions();
    // If settings panel is already open (rare), inject immediately
    injectWaField();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
