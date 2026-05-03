/**
 * js/patches/layout-fix.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fixes:
 *   1. Today tab: 3 cols → 2 cols (70/30) on desktop landscape
 *      Portrait mobile → 1 col full-width
 *   2. Confirm/save buttons on Settings fields (WhatsApp token, Supabase, GPS…)
 *   3. Boxes fill viewport — no overflow on any platform/orientation
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function applyLayoutFix() {
  /* ─── 1. INJECT CSS ─────────────────────────────────────────────────────── */
  const css = `
/* ============================================================
   LAYOUT FIX — 70/30 two-column, full-bleed boxes
   ============================================================ */

/* Reset any 3-col rule */
.today-grid {
  display: grid !important;
  grid-template-columns: 1fr !important;   /* mobile-first: 1 col */
  gap: 14px !important;
  width: 100% !important;
  box-sizing: border-box !important;
}

/* Landscape tablet / desktop: 2 cols 70/30 */
@media (min-width: 700px) and (orientation: landscape),
       (min-width: 1024px) {
  .today-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 340px) !important;
  }
}

/* Portrait tablet/desktop: still 1 col, but wider */
@media (min-width: 700px) and (orientation: portrait) {
  .today-grid {
    grid-template-columns: 1fr !important;
  }
}

/* Every column fills its grid cell */
.tg-col, .tg-col-brief, .tg-col-actions {
  min-width: 0 !important;
  width: 100% !important;
  box-sizing: border-box !important;
}

/* Stays-bar spans full width */
.stays-bar-wrap {
  grid-column: 1 / -1 !important;
}

/* Main column + app shell: never exceed viewport */
main, .app-shell {
  max-width: 100% !important;
  width: 100% !important;
  box-sizing: border-box !important;
  overflow-x: hidden !important;
}

/* Cards must not bleed outside their container */
.guest-card, .brief-card, .hm-card, .crm-header,
.qv-inhouse, .qv-row2, .stays-bar {
  max-width: 100% !important;
  box-sizing: border-box !important;
}

/* Dashboard wrapper: no overflow, fills height */
.dashboard-wrapper {
  overflow-x: hidden !important;
  width: 100% !important;
  box-sizing: border-box !important;
}

/* Side panel on desktop */
@media (min-width: 1024px) {
  .app-shell {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) 300px !important;
    gap: 20px !important;
    max-width: 1360px !important;
    padding: 0 16px !important;
    align-items: start !important;
  }
}

/* Mobile: safe padding so nothing bleeds */
@media (max-width: 699px) {
  main {
    padding-left: 12px !important;
    padding-right: 12px !important;
  }
  .today-grid {
    padding: 0 !important;
  }
}

/* ============================================================
   SETTINGS SAVE CONFIRM BUTTONS
   ============================================================ */
.field-save-confirm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--green);
  font-weight: 600;
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}
.field-save-confirm.show {
  opacity: 1;
}
.btn-field-save {
  margin-top: 6px;
  padding: 7px 16px;
  background: var(--green);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer;
  transition: background 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}
.btn-field-save:hover { background: var(--green2); }
.btn-field-save:disabled {
  background: var(--border);
  cursor: default;
}
.field-save-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
`;

  const style = document.createElement('style');
  style.id = 'stafflo-layout-fix';
  style.textContent = css;
  document.head.appendChild(style);

  /* ─── 2. ADD SAVE BUTTONS TO SETTINGS FIELDS ──────────────────────────── */
  function addSaveButtonsToSettings() {
    // Target all .field wrappers inside .settings-section
    const fields = document.querySelectorAll('.settings-section .field');
    fields.forEach(function(field) {
      const input = field.querySelector('input, textarea, select');
      if (!input) return;
      // Don't double-inject
      if (field.querySelector('.btn-field-save')) return;

      const saveRow = document.createElement('div');
      saveRow.className = 'field-save-row';

      const btn = document.createElement('button');
      btn.className = 'btn-field-save';
      btn.disabled = true;
      btn.innerHTML = '&#10003; Enregistrer';

      const confirm = document.createElement('span');
      confirm.className = 'field-save-confirm';
      confirm.textContent = '✓ Sauvegardé';

      saveRow.appendChild(btn);
      saveRow.appendChild(confirm);
      field.appendChild(saveRow);

      // Enable button on change
      input.addEventListener('input', function() {
        btn.disabled = false;
        confirm.classList.remove('show');
      });
      input.addEventListener('change', function() {
        btn.disabled = false;
        confirm.classList.remove('show');
      });

      // On save: trigger the existing save logic or just localStorage
      btn.addEventListener('click', function() {
        btn.disabled = true;
        btn.textContent = '…';

        // Try to find and click the existing global save button to persist all settings
        const globalSave = document.querySelector('.btn-save');
        if (globalSave) {
          globalSave.click();
        } else {
          // Fallback: persist this field value in localStorage
          const key = input.id || input.name || (input.closest('[id]') || {}).id;
          if (key) localStorage.setItem('stafflo_field_' + key, input.value);
        }

        setTimeout(function() {
          btn.innerHTML = '&#10003; Enregistrer';
          confirm.classList.add('show');
          setTimeout(function() { confirm.classList.remove('show'); }, 2500);
        }, 600);
      });
    });
  }

  // Run after DOM is ready and also watch for settings panel opening
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addSaveButtonsToSettings);
  } else {
    addSaveButtonsToSettings();
  }

  // Also run when settings accordion/panel opens (MutationObserver)
  const settingsObs = new MutationObserver(function() {
    addSaveButtonsToSettings();
  });
  const settingsTarget = document.querySelector('#tab-settings, #settingsPanel, .settings-section');
  if (settingsTarget) {
    settingsObs.observe(settingsTarget.closest('body') || document.body, {
      childList: true, subtree: true
    });
  } else {
    settingsObs.observe(document.body, { childList: true, subtree: true });
  }

  /* ─── 3. FIX today-grid col count based on actual orientation ─────────── */
  function fixGridOrientation() {
    const grid = document.getElementById('todayCols') ||
                 document.querySelector('.today-cols') ||
                 document.querySelector('.today-grid');
    if (!grid) return;
    const isLandscape = window.innerWidth > window.innerHeight;
    const isWide = window.innerWidth >= 700;
    if (isWide && isLandscape) {
      grid.style.gridTemplateColumns = 'minmax(0,1fr) minmax(0,340px)';
    } else {
      grid.style.gridTemplateColumns = '1fr';
    }
  }

  window.addEventListener('resize', fixGridOrientation);
  window.addEventListener('orientationchange', function() {
    setTimeout(fixGridOrientation, 100);
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fixGridOrientation);
  } else {
    fixGridOrientation();
  }

  console.log('[Stafflo] layout-fix patch loaded ✓');
})();
