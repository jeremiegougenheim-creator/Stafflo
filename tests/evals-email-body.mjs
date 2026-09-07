// Rejoue tests/evals-email-body.md contre le code réel d'app.html.
//   node tests/evals-email-body.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'app.html'), 'utf8');

function scriptBlock(marker) {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error('bloc introuvable: ' + marker);
  const start = src.lastIndexOf('<script>', i) + '<script>'.length;
  const end = src.indexOf('</script>', i);
  return src.slice(start, end);
}
function fnSource(name) {
  const m = src.indexOf('function ' + name + '(');
  if (m < 0) throw new Error('fonction introuvable: ' + name);
  // fin = première ligne "  }" au même niveau d'indentation que la déclaration
  const lineStart = src.lastIndexOf('\n', m) + 1;
  const indent = src.slice(lineStart, m);
  const endMarker = '\n' + indent + '}';
  const e = src.indexOf(endMarker, m);
  return src.slice(m, e + endMarker.length);
}

const ctx = { window: {}, atob: globalThis.atob, TextDecoder, console };
ctx.window.window = ctx.window;
vm.createContext(ctx);
vm.runInContext(fnSource('fixMojibake') + '\nwindow.fixMojibake = fixMojibake;', ctx);
vm.runInContext(fnSource('cleanEmailBoilerplate') + '\nwindow.cleanEmailBoilerplate = cleanEmailBoilerplate;', ctx);
vm.runInContext(fnSource('cleanAirbnbGuestMessage') + '\nwindow.cleanAirbnbGuestMessage = cleanAirbnbGuestMessage;', ctx);
vm.runInContext(scriptBlock('(function staffloEmailText(){'), ctx);
const T = ctx.window.StaffloEmailText;

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const INVIS = /[\u200B-\u200D\u2060\uFEFF\u00AD\u034F\uFFFD]/;
const words = (s) => new Set(s.toLowerCase().match(/[a-zà-ÿ0-9']+/g) || []);
const noNewWords = (input, output) => [...words(output)].every((w) => words(input).has(w));

const evals = [];
const ev = (name, fn) => evals.push({ name, fn });

ev('décodage UTF-8 base64url', () => {
  const s = 'Merci à bientôt — Jérémie ✓';
  const out = T.decodeB64Url(b64url(s), 'utf-8');
  return out === s && !/[ÃÂâ�]/.test(out);
});

ev('préheader nbsp/zwnj + footer légal (affichage)', () => {
  const input = "Tell Esther's group what you loved.\n\nAirbnb Ireland UC 8 Hanover Quay Dublin 2, Ireland" + '\u00A0\u200C'.repeat(30);
  const out = T.toReadable(input, "Write a review for Esther's group");
  return out === "Tell Esther's group what you loved." && !INVIS.test(out);
});

ev('HTML → blocs, préheader caché supprimé', () => {
  const input = '<div style="display:none">PREHEADER &nbsp;&zwnj;&nbsp;</div><h2>How was Esther&#39;s stay?</h2><p>Tell Esther&#39;s group<br>what you loved.</p>';
  const out = T.htmlToTextBlocks(input);
  return out === "How was Esther's stay?\n\nTell Esther's group\nwhat you loved." && !/PREHEADER|<|&#|&nbsp;/.test(out);
});

ev('ligne legacy aplatie (cas réel Esther)', () => {
  const input = "HOW WAS ESTHER'S STAY? Tell Esther's group what you loved and what they can do better Esther's group has just checked out, so now is the perfect time to write your review. Write a review WHY REVIEWS ARE IMPORTANT Hosts count on each other to be upfront so they can feel confident hosting. Airbnb Ireland UC 8 Hanover Quay Dublin 2, Ireland Â Â Â Â Â Â ";
  const out = T.toReadable(input, "Write a review for Esther's group");
  return out.startsWith("HOW WAS ESTHER'S STAY?\n")
    && out.includes('\n\nWHY REVIEWS ARE IMPORTANT\nHosts count')
    && !/Airbnb Ireland|�|Â/.test(out)
    && noNewWords(input, out);
});

ev('« à » corrompu par l\'ancienne ingestion', () => {
  const out = T.toReadable('Merci Ã bientÃ´t Ã la villa, Ã 14h', '');
  return out === 'Merci à bientôt à la villa, à 14h';
});

const nominal = "Massi Mekla\nParis, France\nCONFIRMATION CODE\nHMF8MQ49HW\nCheck-in\nCheckout\nFri 15 May\nTue 19 May\nGUESTS\n2 adults, 1 child, 1 infant\nGUEST PAID\n2035.20 EUR\nGET READY FOR MASSI'S ARRIVAL\nProvide directions to your place";

ev('texte pour LLM : les données de réservation restent', () => {
  const out = T.toPromptText(nominal);
  const flat = out.replace(/\s+/g, ' ');
  return ['HMF8MQ49HW', 'Fri 15 May', 'Tue 19 May', '2 adults, 1 child, 1 infant', '2035.20 EUR'].every((k) => out.includes(k))
    && !out.includes('Provide directions')
    && /Check-in Checkout Fri 15 May Tue 19 May/.test(flat)
    && noNewWords(nominal, out);
});

ev('montant absent', () => {
  const input = nominal.replace("GUEST PAID\n2035.20 EUR\n", '');
  const out = T.toPromptText(input);
  const nums = (s) => new Set(s.match(/\d+(?:[.,]\d+)?/g) || []);
  return !/EUR|2035/.test(out) && [...nums(out)].every((n) => nums(input).has(n));
});

ev('texte pur sans HTML reste intact', () => {
  const s = 'Bonjour,\n\nNous arrivons à 14h.\n\nMerci';
  return T.toReadable(s, '') === s && T.toPromptText(s) === s;
});

ev('rendu HTML d\'affichage', () => {
  const out = T.toDisplayHtml("HOW WAS ESTHER'S STAY?\nTell <b>Esther's</b> group.\n\nWHY REVIEWS ARE IMPORTANT\nHosts count.");
  return out === '<div class="seh-h">HOW WAS ESTHER&#39;S STAY?</div><p class="seh-p">Tell &lt;b&gt;Esther&#39;s&lt;/b&gt; group.</p><div class="seh-h">WHY REVIEWS ARE IMPORTANT</div><p class="seh-p">Hosts count.</p>';
});

let fails = 0;
for (const { name, fn } of evals) {
  let ok = false, err = '';
  try { ok = !!fn(); } catch (e) { err = ' — ' + (e && e.message); }
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + err);
  if (!ok) fails++;
}
console.log(fails ? `\n${fails} échec(s)` : `\n${evals.length}/${evals.length} PASS`);
process.exit(fails ? 1 : 0);
