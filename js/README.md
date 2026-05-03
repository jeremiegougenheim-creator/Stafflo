# Stafflo JS Architecture

## Structure

```
js/
├── patches/
│   ├── index.js          ← Central loader — start here
│   ├── whatsapp.js       ← WhatsApp number sync (Supabase + localStorage)
│   └── chat-fix.js       ← Chat panel fixes
└── README.md             ← You are here
```

## How patches work

All patches are loaded by `js/patches/index.js`, which is the **only script tag** added to `app.html`.

Each patch is a self-contained IIFE that:
- Wraps or overrides existing `window.*` functions
- Uses `_patchApplied` flags to prevent double-loading
- Falls back gracefully if dependencies are missing

## Adding a new patch

1. Create `js/patches/your-feature.js`
2. Add it to the `PATCHES` array in `js/patches/index.js`
3. Done — no changes to `app.html` needed

## Supabase config

| Key | Value |
|-----|-------|
| Project | `rcjhgilpmojohmrqzokx` |
| Region | `eu-west-3` |
| Publishable key | stored in each patch that needs it |

## DB schema changes

All migrations are applied via the Supabase MCP tool.
See migration history in Supabase dashboard.

## Roadmap

- [ ] Extract Supabase client to `js/lib/supabase.js` (shared across patches)
- [ ] Move inline `app.html` scripts to `js/core/` as app grows
- [ ] Add `js/lib/i18n.js` for FR/EN translations
