/**
 * js/patches/chat-fix.js
 * Chat panel fixes
 *
 * Patches applied:
 *   1. FAB button always visible (mobile + desktop)
 *   2. Send button enabled when input has text
 *   3. openChatOverlay() creates full-screen modal on mobile
 *   4. Chat input oninput enables/disables send button
 *
 * To update: edit only this file.
 * Original notes preserved from legacy chat-fix.js at repo root.
 */

// Currently documents patches applied directly in app.html.
// Future: extract chat logic here as app.html gets modularised.
console.debug('[chat-fix] loaded');
