/**
 * js/patches/index.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Central patch loader for Stafflo.
 *
 * HOW TO ADD A NEW PATCH:
 *   1. Create  js/patches/your-feature.js
 *   2. Add it to the PATCHES array below
 *   3. Done — no changes needed in app.html
 *
 * LOAD ORDER matters: patches that depend on each other go lower.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PATCHES = [
  'js/patches/chat-fix.js',   // Chat panel fixes (docs only for now)
  'js/patches/whatsapp.js',   // WhatsApp number — Supabase sync + localStorage
  // 'js/patches/notifications.js',  // ← future: push notifications
  // 'js/patches/analytics.js',      // ← future: event tracking
];

(function loadPatches() {
  PATCHES.forEach(function (src) {
    const s   = document.createElement('script');
    s.src     = src;
    s.async   = false; // preserve declaration order
    s.onerror = function () { console.warn('[Stafflo patches] failed to load:', src); };
    document.body.appendChild(s);
  });
})();
