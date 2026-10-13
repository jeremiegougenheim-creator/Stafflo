#!/usr/bin/env bash
# Site public Stafflo → dist/ (Cloudflare Workers, actifs statiques).
# Copie UNIQUEMENT les fichiers servis (liste blanche) : CLAUDE.md, tests/, supabase/,
# rapports et historique ne sont jamais publiés, même si le dépôt est privé.
# Garde-fou : node tests/evals-site-build.mjs (chaque lien local des pages existe dans dist/).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-dist}"
rm -rf "$OUT" && mkdir -p "$OUT"
PAGES="index.html en.html ar.html th.html zh.html app.html espace.html equipe.html livret.html planning.html login.html ops.html privacy.html terms.html"
FILES="sw.js manifest.json espace.webmanifest favicon.svg robots.txt villa-facts.js"
for f in $PAGES $FILES; do cp "$f" "$OUT/"; done
cp -R assets fonts "$OUT/"
cp site/_headers "$OUT/_headers"
echo "dist: $(find "$OUT" -type f | wc -l) fichiers"
