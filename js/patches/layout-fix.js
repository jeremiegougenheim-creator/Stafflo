/**
 * js/patches/layout-fix.js  v2
 * ─────────────────────────────────────────────────────────────────────────────
 * Fixes:
 *   1. Today desktop: 2 cols ONLY (70/30) — kills any 3-col layout
 *      The app-shell has a right rail (ARIA + INBOX = ~300px fixed).
 *      Inside main, today-grid must be 1 col (brief+messages stacked).
 *      On landscape ≥900px, today-grid splits brief/messages 70/30.
 *   2. Portrait (mobile + tablet): always 1 col, full-width boxes
 *   3. Confirm/save buttons on every Settings field
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function applyLayoutFix() {

  /* ─── 1. CSS ───────────────────────────────────────────────────────────── */
  const css = `

/* =============================================================
   APP-SHELL: main content + right rail (ARIA/INBOX)
   ============================================================= */

/* Desktop landscape: main takes remaining space, rail is fixed 300px */
@media (min-width: 960px) {
  .app-shell {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) 300px !important;
    gap: 16px !important;
    align-items: start !important;
    width: 100% !important;
    max-width: 1400px !important;
    margin: 0 auto !important;
    padding: 0 16px !important;
    box-sizing: border-box !important;
  }
}

/* Tablet portrait + mobile: stack everything, no rail */
@media (max-width: 959px) {
  .app-shell {
    display: block !important;
  }
  /* Hide right rail on narrow screens (ARIA + INBOX go into modal) */
  .app-shell > .side-rail,
  .app-shell > [id*="sideRail"],
  .app-shell > [id*="SideRail"],
  .app-shell > [class*="side-rail"],
  .app-shell > [class*="sideRail"] {
    display: none !important;
  }
}

/* =============================================================
   TODAY-GRID: inside main column
   - Mobile/portrait: 1 col
   - Landscape ≥900px: 2 cols (brief 70% / messages 30%)
   ============================================================= */

/* Base: single column, full-width */
.today-grid,
#todayCols,
.today-cols {
  display: grid !important;
  grid-template-columns: 1fr !important;
  gap: 14px !important;
  width: 100% !important;
  box-sizing: border-box !important;
}

/* Landscape + wide enough: 70 / 30 split */
@media (min-width: 900px) and (orientation: landscape) {
  .today-grid,
  #todayCols,
  .today-cols {
    grid-template-columns: minmax(0, 7fr) minmax(0, 3fr) !important;
  }
}

/* All grid children: no overflow, respect container */
.today-grid > *,
#todayCols > *,
.today-cols > *,
.tg-col,
.tg-col-brief,
.tg-col-actions {
  min-width: 0 !important;
  width: 100% !important;
  box-sizing: border-box !important;
}

/* Stays bar always spans full width of today-grid */
.stays-bar,
.stays-bar-wrap {
  grid-column: 1 / -1 !important;
  width: 100% !important;
  box-sizing: border-box !important;
}

/* =============================================================
   GLOBAL: no horizontal overflow anywhere
   ============================================================= */
html, body {
  overflow-x: hidden !important;
  max-width: 100vw !important;
}

main {
  width: 100% !important;
  box-sizing: border-box !important;
  overflow-x: hidden !important;
}

.guest-card, .brief-card, .hm-card, .crm-header,
.qv-inhouse, .qv-row2, .ai-zone, .msg-section {
  max-width: 100% !important;
  box-sizing: border-box !important;
}

/* =============================================================
   SETTINGS: SAVE BUTTONS PER FIELD
   ============================================================= */
.btn-field-save {
  margin-top: 6px;
  padding: 7px 16px;
  background: var(--green, #1B4332);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer;
  transition: background 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.btn-field-save:hover { background: var(--green2, #2A5240); }
.btn-field-save:disabled {
  background: var(--border, #E8E2D8);
  color: #999;
  cursor: default;
}
.field-save-confirm {
  font-size: 12px;
  color: var(--green, #1B4332);
  font-weight: 600;
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
  margin-left: 8px;
}
.field-save-confirm.show { opacity: 1; }
.field-save-row {
  display: flex;
  align-items: center;
  margin-top: 6px;
  flex-wrap: wrap;
  gap: 8px;
}
`;

  const style = document.createElement('style');
  style.id = 'stafflo-layout-fix';
  // Remove old version if exists
  const old = document.getElementById('stafflo-layout-fix');
  if (old) old.remove();
  style.textContent = css;
  document.head.appendChild(style);

  /* ─── 2. JS: fix grid on orientation/resize ────────────────────────────── */
  function fixGrid() {
    // Find the today-grid element (try several possible IDs/classes)
    const grid = document.getElementById('todayCols')
               || document.querySelector('.today-cols')
               || document.querySelector('.today-grid');
    if (!grid) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const isLandscape = w > h;
    const isWide = w >= 900;

    if (isWide && isLandscape) {
      grid.style.setProperty('grid-template-columns', 'minmax(0,7fr) minmax(0,3fr)', 'important');
    } else {
      grid.style.setProperty('grid-template-columns', '1fr', 'important');
    }
  }

  function init() {
    fixGrid();
    addSaveButtons();
  }

  window.addEventListener('resize', fixGrid);
  window.addEventListener('orientationchange', function() { setTimeout(fixGrid, 120); });

  /* ─── 3. SETTINGS save buttons ─────────────────────────────────────────── */
  function addSaveButtons() {
    document.querySelectorAll('.settings-section .field').forEach(function(field) {
      const input = field.querySelector('input, textarea, select');
      if (!input || field.querySelector('.btn-field-save')) return;

      const row = document.createElement('div');
      row.className = 'field-save-row';

      const btn = document.createElement('button');
      btn.className = 'btn-field-save';
      btn.disabled = true;
      btn.innerHTML = '&#10003; Enregistrer';

      const confirm = document.createElement('span');
      confirm.className = 'field-save-confirm';
      confirm.textContent = '✓ Sauvegardé';

      row.appendChild(btn);
      row.appendChild(confirm);
      field.appendChild(row);

      input.addEventListener('input',  function() { btn.disabled = false; confirm.classList.remove('show'); });
      input.addEventListener('change', function() { btn.disabled = false; confirm.classList.remove('show'); });

      btn.addEventListener('click', function() {
        btn.disabled = true;
        btn.textContent = '…';
        const globalSave = document.querySelector('.btn-save');
        if (globalSave) globalSave.click();
        else {
          const key = input.id || input.name;
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

  // Init on DOMContentLoaded or immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-run when settings tab becomes visible (MutationObserver)
  new MutationObserver(function(mutations) {
    for (var m of mutations) {
      if (m.addedNodes.length) { addSaveButtons(); break; }
    }
  }).observe(document.body, { childList: true, subtree: true });

  console.log('[Stafflo] layout-fix v2 ✓');
})();
