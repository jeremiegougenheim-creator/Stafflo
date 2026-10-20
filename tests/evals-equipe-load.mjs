// Vue équipe (equipe.html) dans Chromium — « Chambres prêtes » et « Signaler un problème » partent vers la base.
//   node tests/evals-equipe-load.mjs        (réseau entièrement simulé)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); } };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript; charset=utf-8' : p.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const browser = await chromium.launch();
const K = 'K'.repeat(43);
const iso = (d) => { const x = new Date(Date.now() + d * 86400000); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }; // date locale, comme la page (todayNum) — jamais l’UTC
const DATA = { name: 'Saïd', lang: 'fr', today: iso(0), at: new Date().toISOString(), reports: [], stays: [
  { id: 's-now', name: 'Felipe V.', a: iso(-2), d: iso(1), nights: 3, adults: 7, children: null, infants: null, pax: 7, arrival_time: '', departure_time: 'vol retour 9h, départ de la villa 6h30', beds: '', meals: '', drinks: 'Eau plate (12 bouteilles), 12 bières', note: '', same_day: false },
  { id: 's-next', name: 'Thibaut V.', a: iso(4), d: iso(8), nights: 4, adults: 10, children: null, infants: null, pax: 10, arrival_time: 'vers 15h30', beds: '4 couples + 2 personnes seules', meals: '', note: '', extras: '1 × Transfert aéroport', same_day: false },
] };

async function open({ lang = 'fr', data = DATA, report = null } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', locale: 'fr-FR' });
  const posts = [], views = [], stored = [...(data.reports || [])]; // le serveur relit les retours du lien avec les séjours
  await ctx.route('**/*', (route) => {
    const req = route.request(), u = req.url();
    if (u.includes('/functions/v1/staff-view')) {
      const body = JSON.parse(req.postData() || '{}');
      if (!body.action) views.push(body);
      if (body.action === 'report') {
        posts.push(body);
        const rec = { id: 'r' + (stored.length + 1), kind: body.kind, client_id: body.client_id, text: body.text, created_at: new Date().toISOString() };
        const r = report ? report(body) : (stored.unshift(rec), { status: 200, body: JSON.stringify({ ok: true, report: rec }) });
        return route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: r.body });
      }
      const d = typeof data === 'function' ? data(views.length, body) : data; // 20/10 : réponse qui change d'une lecture à l'autre (traduction en arrière-plan)
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ...d, lang, reports: stored }) });
    }
    if (u.startsWith('http://127.0.0.1')) return route.continue();
    return route.fulfill({ status: 204, body: '' });
  });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.addInitScript((l) => { localStorage.setItem('stafflo_equipe_lang', l); }, lang);
  await page.goto(`http://127.0.0.1:${PORT}/equipe.html#k=${K}`);
  await page.waitForSelector('article.card', { timeout: 8000 });
  await page.waitForTimeout(150);
  return { page, ctx, posts, views, errs };
}

let r = await open();
const txt = await r.page.evaluate(() => document.getElementById('app').innerText);
check('page chargée, 0 erreur', !r.errs.length, r.errs);
check('« Chambres prêtes » sur l’arrivée à venir, pas sur le séjour déjà là', (await r.page.$$('[data-a="ready"]')).length === 1 && (await r.page.getAttribute('[data-a="ready"]', 'data-id')) === 's-next');
check('« Signaler un problème » en bas, texte libre', /Signaler un problème/.test(txt) && !!(await r.page.$('#issueTxt')));
check('rien de nouveau ne fuit : aucun prix, téléphone ni note du propriétaire', !/€|MAD|\+212|\+33|Notes/.test(txt));
check('extras commandés par le client : « Commandé par le client · 1 × Transfert aéroport », sans prix', /Commandé par le client\s*1 × Transfert aéroport/.test(txt));
check('heure de départ et boissons (17/10) : affichées quand elles sont connues, jamais « ? » sinon', /Heure de départ\s*vol retour 9h, départ de la villa 6h30/.test(txt) && /Boissons\s*Eau plate \(12 bouteilles\), 12 bières/.test(txt) && (txt.match(/Heure de départ/g) || []).length === 1 && (txt.match(/Boissons/g) || []).length === 1, txt.slice(0, 600));
await r.page.click('[data-a="ready"]'); await r.page.waitForTimeout(300);
const t2 = await r.page.evaluate(() => document.getElementById('app').innerText);
check('un geste → envoi { k, action: report, kind: rooms_ready, client_id } et rien d’autre', r.posts.length === 1 && r.posts[0].k === K && r.posts[0].action === 'report' && r.posts[0].kind === 'rooms_ready' && r.posts[0].client_id === 's-next' && r.posts[0].text === null && Object.keys(r.posts[0]).sort().join() === 'action,client_id,k,kind,text');
check('après envoi : « Chambres prêtes · HH:MM », le bouton ne revient pas', /Chambres prêtes · \d{2}:\d{2}/.test(t2) && !(await r.page.$('[data-a="ready"]')));
await r.page.fill('#issueTxt', 'Fuite dans la salle de bain de la suite'); await r.page.click('#issue button[type="submit"]'); await r.page.waitForTimeout(300);
check('problème → envoi du texte seul (pas de séjour), « Envoyé, merci », champ vidé', r.posts.length === 2 && r.posts[1].kind === 'issue' && r.posts[1].text === 'Fuite dans la salle de bain de la suite' && r.posts[1].client_id === null && /Envoyé, merci/.test(await r.page.evaluate(() => document.getElementById('issueSt').innerText)) && (await r.page.inputValue('#issueTxt')) === '');
await r.page.click('#issue button[type="submit"]'); await r.page.waitForTimeout(200);
check('problème vide → rien n’est envoyé', r.posts.length === 2);
await r.page.reload(); await r.page.waitForSelector('article.card'); await r.page.waitForTimeout(150);
check('après rechargement : « chambres prêtes » reste coché (retours relus avec les séjours ou gardés en cache)', /Chambres prêtes · \d{2}:\d{2}/.test(await r.page.evaluate(() => document.getElementById('app').innerText)));
await r.ctx.close();

r = await open({ report: () => ({ status: 503, body: '{}' }) });
await r.page.click('[data-a="ready"]'); await r.page.waitForTimeout(400);
check('serveur indisponible → message, le bouton reste (on peut réessayer)', !!(await r.page.$('[data-a="ready"]')) && !(await r.page.evaluate(() => document.querySelector('[data-a="ready"]').disabled)) && /vérifiez la connexion/.test(await r.page.evaluate(() => document.getElementById('app').innerText)));
await r.ctx.close();

r = await open({ lang: 'ar' });
const ar = await r.page.evaluate(() => document.getElementById('app').innerText);
check('arabe : boutons et aide en darija marocaine (19/10), sens RTL, extras sous « شنو طلب الكليان »', /شنو طلب الكليان/.test(ar) && /البيوت واجدين/.test(ar) && /قول لينا على شي مشكل/.test(ar) && !/يصلون|لا يوجد|الإبلاغ/.test(ar) && (await r.page.evaluate(() => document.documentElement.dir)) === 'rtl');
await r.ctx.close();

r = await open({ data: { ...DATA, reports: [{ id: 'r0', kind: 'rooms_ready', client_id: 's-next', text: null, created_at: new Date().toISOString() }] } });
check('retour déjà envoyé depuis un autre appareil → coché au chargement', /Chambres prêtes · \d{2}:\d{2}/.test(await r.page.evaluate(() => document.getElementById('app').innerText)) && !(await r.page.$('[data-a="ready"]')));
await r.ctx.close();

// ── Lien prestataire (20/10) : role kitchen → couverts, repas commandés (les siens), « préparé par la maison », interlocation, « Repas confirmés » ; jamais couchages, boissons, extras ──
const KSTAY = { id: 's-next', name: 'Thibaut V.', a: iso(4), d: iso(8), nights: 4, adults: 10, children: null, infants: null, pax: 10, arrival_time: 'atterrissage 14h', departure_time: '', beds: '', meals: 'Pas d’allergie.', drinks: '', note: 'Clés sous le pot.', extras: '',
  orders: '2 × Déjeuner ou dîner — mer. 21 soir, jeu. 22 midi\n1 × Brunch — ven. 23 brunch', house_orders: '1 × Goûter — jeu. 22 soir', next: { d: iso(8), same_day: true }, next_time: 'vers 15h30', same_day: false,
  lines: { arrival_time: ['atterrissage 14h'], departure_time: [], beds: [], meals: ['Pas d’allergie.'], drinks: [], note: ['Clés sous le pot.'], extras: [], orders: ['2 × Déjeuner ou dîner — mer. 21 soir, jeu. 22 midi', '1 × Brunch — ven. 23 brunch'], house_orders: ['1 × Goûter — jeu. 22 soir'], next_time: ['vers 15h30'] } };
const KDATA = { ...DATA, name: 'Léa', role: 'kitchen', stays: [KSTAY] };
r = await open({ data: KDATA });
let kt = await r.page.evaluate(() => document.getElementById('app').innerText);
const khead = await r.page.evaluate(() => document.getElementById('hello').innerText);
check('prestataire : 0 erreur ; en-tête « Léa · prestataire repas » ; couverts (pas adultes) ; ses repas jour par jour ; « Préparé par la maison, pas par vous » ; prochaine arrivée « le jour même · vers 15h30 » ; consigne',
  !r.errs.length && /Léa · prestataire repas/.test(khead) && /10\s*Couverts/.test(kt) && !/Adultes/.test(kt) && /Repas commandés par le client\s*2 × Déjeuner ou dîner — mer\. 21 soir, jeu\. 22 midi\s*1 × Brunch — ven\. 23 brunch/.test(kt) && /Préparé par la maison, pas par vous\s*1 × Goûter — jeu\. 22 soir/.test(kt) && /Prochaine arrivée après ce départ\s*.*· le jour même · vers 15h30/.test(kt) && /Consigne\s*Clés sous le pot\./.test(kt), [r.errs, kt]);
check('prestataire : ni couchages, ni boissons, ni extras, ni « Chambres prêtes »', !/Couchages|Boissons|Commandé par le client|Chambres prêtes/.test(kt));
check('« Repas confirmés » sur le séjour à venir', (await r.page.$$('[data-a="ready"]')).length === 1 && (await r.page.getAttribute('[data-a="ready"]', 'data-kind')) === 'meals_ok');
await r.page.click('[data-a="ready"]'); await r.page.waitForTimeout(300);
kt = await r.page.evaluate(() => document.getElementById('app').innerText);
check('un geste → { action: report, kind: meals_ok, client_id } ; puis « Repas confirmés · HH:MM », le bouton ne revient pas', r.posts.length === 1 && r.posts[0].kind === 'meals_ok' && r.posts[0].client_id === 's-next' && /Repas confirmés · \d{2}:\d{2}/.test(kt) && !(await r.page.$('[data-a="ready"]')), r.posts);
check('« Signaler un problème » reste', !!(await r.page.$('#issueTxt')));
await r.ctx.close();
r = await open({ data: KDATA, lang: 'ar' });
const kar = await r.page.evaluate(() => document.getElementById('app').innerText);
check('prestataire en arabe : libellés en darija (couverts, repas commandés, maison, vossul jay, repas confirmés)', /عدد الناس ف الماكلة/.test(kar) && /الماكلة اللي طلب الكليان/.test(kar) && /كتوجدها الدار، ماشي نتوما/.test(kar) && /الوصول الجاي من بعد هاد الخروج/.test(kar) && /الماكلة مأكدة/.test(kar) && !/النعاس|المشروبات/.test(kar), kar);
await r.ctx.close();
// Lien maison : les repas « maison » commandés et la prochaine arrivée en plus, le reste inchangé
r = await open({ data: { ...DATA, role: 'house', stays: [{ ...KSTAY, beds: '4 couples', orders: '', lines: { ...KSTAY.lines, beds: ['4 couples'], orders: [] } }] } });
const ht = await r.page.evaluate(() => document.getElementById('app').innerText);
check('maison : « À préparer par la maison · 1 × Goûter », prochaine arrivée, couchages et adultes comme avant, pas la commande du prestataire, « Chambres prêtes »', /À préparer par la maison\s*1 × Goûter — jeu\. 22 soir/.test(ht) && /Prochaine arrivée après ce départ/.test(ht) && /10\s*Adultes/.test(ht) && /Couchages\s*4 couples/.test(ht) && !/Repas commandés par le client/.test(ht) && (await r.page.getAttribute('[data-a="ready"]', 'data-kind')) === 'rooms_ready', ht);
await r.ctx.close();

// ── Lisible et en arabe (18/10) : `lines` → une puce par phrase / article ; `ar` → les mêmes lignes en arabe, le français replié dessous ──
const LINED = { ...DATA, stays: [{ id: 's-next', name: 'Thibaut V.', a: iso(4), d: iso(8), nights: 4, adults: 10, children: null, infants: null, pax: 10, arrival_time: 'atterrissage 14h', departure_time: '6h30 (vol 9h)', beds: '',
  meals: 'Mercredi 21, dîner vers 19h30 : tajine de kefta. Jeudi 22, déjeuner : kebabs. Pas d’allergie.', drinks: '12 eaux plates, 2 vins rouges (vins marocains, choisis par nous)', note: 'Départ à 6h30 : petit-déjeuner préparé la veille. Pas de transfert.', extras: '', same_day: false,
  lines: { arrival_time: ['atterrissage 14h'], departure_time: ['6h30 (vol 9h)'], beds: [], meals: ['Mercredi 21, dîner vers 19h30 : tajine de kefta.', 'Jeudi 22, déjeuner : kebabs.', 'Pas d’allergie.'], drinks: ['12 eaux plates', '2 vins rouges (vins marocains, choisis par nous)'], note: ['Départ à 6h30 : petit-déjeuner préparé la veille.', 'Pas de transfert.'], extras: [] },
  ar: { arrival_time: ['الهبوط 14:00'], departure_time: ['6:30 (الرحلة 9:00)'], meals: ['الأربعاء 21، عشاء حوالي 19:30: طاجين كفتة.', 'الخميس 22، غداء: كباب.', 'لا حساسية.'], drinks: ['12 ماء عادي', '2 نبيذ أحمر (مغربي، نختاره نحن)'], note: ['المغادرة 6:30: الفطور يُحضّر في الليلة السابقة.', 'لا نقل.'] } }] };
r = await open({ data: LINED });
check('la page dit au serveur la langue affichée ({ k, lang })', r.views.length === 1 && r.views[0].lang === 'fr' && r.views[0].k === K, r.views);
const li = await r.page.$$eval('article.card .row ul.v li', (xs) => xs.map((x) => x.innerText));
check('français : repas 3 puces, boissons 2 (parenthèses gardées), consigne 2 ; l’heure sur une ligne simple', li.length === 7 && li[0] === 'Mercredi 21, dîner vers 19h30 : tajine de kefta.' && li[4] === '2 vins rouges (vins marocains, choisis par nous)' && (await r.page.$$('article.card .row span.v')).length >= 2, li);
check('français : pas de bloc « texte d’origine »', !(await r.page.$('details.orig')));
await r.ctx.close();
r = await open({ data: LINED, lang: 'ar' });
const ali = await r.page.$$eval('article.card .row > div > ul.v', (xs) => xs.map((x) => x.getAttribute('dir') + ':' + [].map.call(x.querySelectorAll('li'), (li) => li.innerText).join('|')));
check('arabe : les mêmes puces, traduites, en RTL', r.views[0].lang === 'ar' && ali.length === 3 && ali[0] === 'rtl:الأربعاء 21، عشاء حوالي 19:30: طاجين كفتة.|الخميس 22، غداء: كباب.|لا حساسية.' && ali[1].startsWith('rtl:12 ماء عادي|'), ali);
check('arabe : l’heure d’arrivée traduite sur sa ligne ; le français d’origine replié sous les textes libres seulement (repas, boissons, consigne — pas sous une heure)', /الهبوط 14:00/.test(await r.page.evaluate(() => document.getElementById('app').innerText)) && (await r.page.$$('details.orig')).length === 3 && (await r.page.$$eval('details.orig', (xs) => xs.every((x) => !x.open && /^النص الأصلي$/.test(x.querySelector('summary').innerText.trim())))));
await (await r.page.$$('details.orig summary'))[0].click(); await r.page.waitForTimeout(100);
check('un geste ouvre le français d’origine, tel quel', (await r.page.$$eval('details.orig', (xs) => xs[0].open && !xs[1].open && xs[0].innerText.includes('Mercredi 21, dîner vers 19h30 : tajine de kefta.'))));
await r.ctx.close();
// Réponse sans `ar` (Mistral en panne, ou ancienne version) : le français, à puces ; passer en arabe redemande au serveur une fois
const NOAR = { ...LINED, stays: [{ ...LINED.stays[0], ar: undefined }] };
r = await open({ data: NOAR, lang: 'ar' });
check('arabe sans traduction : le français reste, à puces, sans bloc d’origine', (await r.page.$$('article.card .row ul.v li')).length === 7 && !(await r.page.$('details.orig')) && !r.errs.length, r.errs);
await r.ctx.close();
r = await open({ data: NOAR, lang: 'fr' });
await r.page.click('#langBtn'); await r.page.waitForTimeout(400);
check('bascule FR → AR sans traductions en main : une nouvelle lecture avec lang = ar', r.views.length === 2 && r.views[1].lang === 'ar', r.views);
await r.ctx.close();
// 20/10/2026 — [REGRESSION — cas réel Seán] en français, ce que le client a écrit en anglais était affiché en anglais ; en arabe,
// rien n'était traduit (la traduction, trop longue, n'aboutissait jamais). Une page = une seule langue : `fr` porte la version
// française des textes du client ; la traduction qui manque part en arrière-plan (`pending`) et la page relit d'elle-même.
const SEAN = { ...DATA, tr: 'fr', stays: [{ id: 's-sean', name: 'Seán', a: iso(5), d: iso(12), nights: 7, adults: 10, children: null, infants: 1, pax: 10, arrival_time: '« Most of the group will arrive quite late (likely after 9pm) »', departure_time: '',
  beds: 'There are 4 couples and then 2 siblings.', meals: 'Could we do dinner on Monday 26th? Starters - zaalouk', drinks: 'Coke Zero, Iced tea', note: 'Berceau dans la chambre du jardin.', extras: '', same_day: false,
  lines: { arrival_time: ['« Most of the group will arrive quite late (likely after 9pm) »'], departure_time: [], beds: ['There are 4 couples and then 2 siblings.'], meals: ['Could we do dinner on Monday 26th?', 'Starters - zaalouk'], drinks: ['Coke Zero', 'Iced tea'], note: ['Berceau dans la chambre du jardin.'], extras: [] },
  fr: { arrival_time: ['« La plupart du groupe arrivera assez tard (probablement après 21h) »'], beds: ['Il y a 4 couples puis 2 frères et sœurs.'], meals: ['Pourrions-nous dîner le lundi 26 ?', 'Entrées - zaalouk'], drinks: ['Coca Zéro', 'Thé glacé'] } }] };
r = await open({ data: SEAN });
const ftxt = await r.page.evaluate(() => [].map.call(document.querySelectorAll('article.card .row > div > .v'), (x) => x.innerText).join(' | '));
check('français : les textes du client en français (repas, couchages, boissons, arrivée), la consigne telle quelle — aucun anglais visible',
  /Pourrions-nous dîner le lundi 26/.test(ftxt) && /Il y a 4 couples/.test(ftxt) && /Coca Zéro/.test(ftxt) && /après 21h/.test(ftxt) && /Berceau dans la chambre du jardin/.test(ftxt) && !/\b(Could|There|Iced|Most)\b/.test(ftxt), ftxt);
check('français : l’original du client replié sous les textes libres traduits (repas, couchages, boissons), libellé « Texte d’origine »',
  (await r.page.$$('details.orig')).length === 3 && (await r.page.$$eval('details.orig', (xs) => xs.every((x) => !x.open && x.querySelector('summary').innerText.trim() === 'Texte d’origine'))));
await r.ctx.close();
let tries = 0;
const LATE = (n, body) => { tries = n; if (body.lang !== 'ar') return { ...SEAN, tr: 'fr' };
  return n < 2 ? { ...SEAN, tr: 'ar', pending: 4, stays: [{ ...SEAN.stays[0], fr: undefined }] } : { ...SEAN, tr: 'ar', pending: 0, stays: [{ ...SEAN.stays[0], fr: undefined, ar: { meals: ['واش نقدرو نتعشاو نهار الاثنين 26؟', 'المقبلات - زعلوك'], beds: ['كاين 4 كوبلات و 2 خوت.'], drinks: ['كوكا زيرو', 'أتاي بارد'], arrival_time: ['أغلبية المجموعة غادي يوصلو معطلين (تقريبا من بعد 21:00)'], note: ['البيرسو ف بيت الجردة.'] } }] }; };
r = await open({ data: LATE, lang: 'ar' });
const band1 = await r.page.evaluate(() => document.getElementById('app').innerText);
check('arabe, traduction pas encore prête : le texte d’origine en attendant, une bande « الترجمة جاية… »', /الترجمة جاية/.test(band1) && /Could we do dinner/.test(band1), band1.slice(0, 200));
await r.page.waitForTimeout(5600);
const atxt = await r.page.evaluate(() => [].map.call(document.querySelectorAll('article.card .row > div > .v'), (x) => x.innerText).join(' | '));
check('arabe : la page relit d’elle-même ~5 s après ; tout en darija, plus d’anglais ni de bande', r.views.length === 2 && /نتعشاو/.test(atxt) && /كوكا زيرو/.test(atxt) && !/\b(Could|There|Iced|Most|Berceau)\b/.test(atxt) && !/الترجمة جاية/.test(await r.page.evaluate(() => document.getElementById('app').innerText)), { n: r.views.length, atxt });
await r.page.waitForTimeout(5600);
check('plus rien en attente : la page ne relit plus', r.views.length === 2, r.views.length);
await r.ctx.close();
// Ancienne réponse (sans `lines`, en cache) : le texte tel quel, comme avant
r = await open({ data: DATA });
check('réponse sans `lines` (ancienne) : texte tel quel', /Heure de départ\s*vol retour 9h, départ de la villa 6h30/.test(await r.page.evaluate(() => document.getElementById('app').innerText)) && !(await r.page.$('article.card .row ul.v')));
await r.ctx.close();

await browser.close(); server.close();
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
