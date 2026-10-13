// Fiche maison du pilote : _private/house-facts-pilot.json → SQL de mise à jour de la base.
//   node scripts/house-facts-sql.mjs > /tmp/house-facts.sql   (puis exécuté par Claude, côté Supabase)
// Cible la ligne qui porte la fiche (house_facts_ref), jamais un identifiant écrit en dur.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, '_private/house-facts-pilot.json'), 'utf8')));
if (json.includes('$hf$')) throw new Error('délimiteur présent dans les données');
process.stdout.write(`update public.villa_settings set house_facts = $hf$${json}$hf$::jsonb, updated_at = now() where house_facts_ref = 'villa-facts.js' returning owner_id is not null as updated, jsonb_typeof(house_facts) as type, length(house_facts::text) as size;\n`);
