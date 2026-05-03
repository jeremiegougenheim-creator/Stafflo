/**
 * js/patches/index.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Central patch loader for Stafflo.
 *
 * HOW TO ADD A NEW PATCH:
 *   1. Create  js/patches/your-feature.js
 *   2. Add a   <script src="js/patches/your-feature.js"></script>  below
 *   3. That's it — no changes needed in app.html or anywhere else.
 *
 * LOAD ORDER matters: patches that depend on each other go lower.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Patch registry ────────────────────────────────────────────────────────────
// Each entry = one <script> tag injected dynamically so load is non-blocking.

const PATCHES = [
  'js/patches/chat-fix.js',    // Chat panel fixes
  'js/patches/whatsapp.js',    // WhatsApp number sync (Supabase + localStorage)
];

(function loadPatches() {
  PATCHES.forEach(function (src) {
    const s  = document.createElement('script');
    s.src    = src;
    s.async  = false; // preserve order
    s.onerror = function () { console.warn('[patches] failed to load:', src); };
    document.body.appendChild(s);
  });
})();
