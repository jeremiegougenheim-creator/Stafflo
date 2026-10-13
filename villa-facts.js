/* ═══════════════════════════════════════════════════════════════════════
   villa-facts.js — FICHE MAISON de la Villa Dar J. SOURCE UNIQUE.
   ═══════════════════════════════════════════════════════════════════════
   Lue par :
     · livret.html  — le livret client (rendu identique à avant le déplacement)
     · app.html     — ARIA et les réponses types (résumé via digest(lang))
   Changer un prix, un horaire, une règle ou un nom ICI le change partout.
   Ne jamais recopier ces faits en dur ailleurs (c'est ce qui avait figé
   « Faiza », « 300 MAD par personne » et « la Palmeraie » dans l'app).

   Forme : chaque texte est une paire [français, anglais].
   Sortie : window.VILLA_FACTS (gelé). Aucun autre global n'est créé — l'app
   fait 44 000 lignes, un `const MEALS` global y entrerait en collision.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

const VILLA = {
  wifi:{net:'WIFI Villa DarJ', pass:'francoise'},
  said:'+212 (0)6 12 22 32 36',
  hostPhone:'+852 6768 4852',
  staff:'Saïd',            /* majordome — nom utilise dans tout le livret */
  address:"Douar Sabba H'mdia, Alouidane, 40000 Marrakech",
  /* Pin GPS exact de la villa. Une recherche texte sur l'adresse ne mene pas
     a la maison (chauffeur perdu, aout 2026) : le lien du livret pointe
     toujours sur ces coordonnees. */
  pin:{lat:31.625686, lng:-7.886889},
  /* Supplement voyageurs — doit refleter le reglage Airbnb « Extra guest fee ».
     from = premier voyageur facture ; Airbnb : « facturé après (from - 1) voyageurs ».
     Changer ces valeurs ici ET sur Airbnb en meme temps.
     N'est plus affiche dans le livret (octobre 2026) : le livret part chez des
     clients qui ont deja reserve, au prix calcule par Airbnb le jour de la
     reservation (facture au 9e voyageur avant le 27/09, au 8e depuis). Afficher
     la regle du jour contredisait ce qu'avaient paye Thibaut, Gautier, Sean.
     Conserve ici comme reference du reglage Airbnb. */
  extraGuest:{from:8, fee:50, max:10},
  host:'Jérémie',
  name:'Villa Dar J'   /* nom affiché dans les messages aux clients et par ARIA (Espace) */
};

const PRACTICAL = [
  ["Communication : l'équipe parle arabe, français et anglais de base — une application de traduction aide beaucoup. "+VILLA.staff+" coordonne l'ensemble : adressez-lui vos demandes en premier.",
   "Communication: the team speaks Arabic, French and basic English — a translation app helps a lot. "+VILLA.staff+" coordinates everything: please bring your requests to him first."],
  ["Ménage : la maison est nettoyée chaque jour.",
   "Cleaning: the house is cleaned every day."],
  ["Chauffage : la maison est chauffée selon vos besoins, chambres comprises. Le salon et la suite principale ont aussi une cheminée.",
   "Heating: the house is heated as you need it, bedrooms included. The living room and the master suite also have a fireplace."],
  /* Climatisation : confirmé par Jérémie le 10/10/2026 (toutes les chambres),
     point à mettre en avant pour l'été. Absent du livret jusqu'ici. */
  ["Climatisation : toutes les chambres sont climatisées — un vrai confort pendant les chaleurs de l'été.",
   "Air conditioning: every bedroom is air-conditioned — a real comfort in the summer heat."],
  ["Piscine : notre piscine n'est ni chauffée, ni clôturée, et n'est pas équipée d'une alarme. Si de jeunes enfants séjournent avec vous, leur surveillance relève entièrement des parents ou des accompagnants, à tout moment. Nous vous remercions d'y veiller.",
   "Swimming pool: our pool is not heated, not fenced and has no alarm. If young children are staying with you, supervising them is entirely the responsibility of their parents or guardians, at all times. We thank you for your care in this."],
  ["Arrivée et départ : vos chambres sont prêtes à partir de 14h. Le jour du départ, nous vous demandons simplement de libérer les chambres pour midi, le temps que l'équipe puisse les préparer. La maison, le jardin et la piscine restent ensuite à vous jusqu'à 18h — dites-nous votre heure de départ à l'avance et nous organiserons tout, déjeuner au bord de l'eau compris si vous le souhaitez. Si votre vol est plus tardif, parlons-en : nous trouverons une solution.",
   "Arrival and departure: your bedrooms are ready from 2 pm. On departure day, we simply ask that the bedrooms be vacated by midday, so the team can get them ready. The house, garden and pool are then yours until 6 pm — let us know your departure time in advance and we will arrange everything, including lunch by the water if you would like. If your flight is later, do tell us and we will find a solution."],
  ["Espaces privés : un petit bureau, derrière le salon, reste fermé. L'arrière de la propriété, derrière la maison, est un espace de service réservé au propriétaire et à l'équipe.",
   "Private areas: a small office, behind the living room, stays locked. The back of the property, behind the house, is a service area reserved for the owner and the team."],
  ["Cuisine : elle est à votre disposition si vous souhaitez cuisiner vous-même — prévenez Saïd la veille, pour qu'elle soit libre et prête. Et si vous préférez vous laisser faire, notre équipe prépare vos repas à la villa, courses facturées au prix réel : la commande d'un repas, elle, se fait au minimum 2 jours à l'avance (voir Repas & horaires de service). Pendant les heures de présence de l'équipe, nous nous occupons de la vaisselle ; en dehors, merci de laisser la cuisine rangée après usage.",
   "Kitchen: it is yours to use if you would like to cook yourselves — let Saïd know the day before, so that it is free and ready. And if you would rather be looked after, our team prepares your meals at the villa, groceries billed at cost: ordering a meal, however, is done at least 2 days ahead (see Meal Times & Service). During the team's hours we take care of the washing up; outside those hours, please leave the kitchen tidy after use."],
  ["Présence de l'équipe : 8h30 – 21h00, avec une pause commune de 15h00 à 17h00. Merci d'adresser vos demandes pendant ces heures — c'est ce qui nous permet de bien y répondre.\nLa nuit, "+VILLA.staff+" reste sur place et joignable en cas d'urgence : un souci de santé, un dégât dans la maison.\nPour un problème majeur, vous pouvez écrire à Jérémie sur WhatsApp — il est souvent à l'étranger et le décalage horaire peut retarder sa réponse.",
   "Staff on site: 8:30 am – 9:00 pm, with a shared break from 3:00 to 5:00 pm. Please bring your requests during these hours — it is what allows us to answer them properly.\nAt night "+VILLA.staff+" remains on the property and can be reached in an emergency: a health concern, damage in the house.\nFor a major problem you may message Jérémie on WhatsApp — he is often abroad and the time difference may delay his reply."],
  ["Transferts aéroport : si vous ne louez pas de voiture, nous pouvons vous aider à organiser votre arrivée et votre retour avec notre chauffeur de confiance — à votre charge. Envoyez-nous vos numéros de vol et vos horaires dès que vous les avez.",
   "Airport transfers: if you are not renting a car, we can help you arrange your arrival and your return with our trusted driver — at your own cost. Send us your flight numbers and times as soon as you have them."],
  ["Déplacements en ville : nous pouvons vous aider à organiser un van ou une voiture avec chauffeur de confiance pour vos sorties — à votre charge. Indiquez-nous la veille l'horaire et la destination, tout sera prêt à votre départ.",
   "Getting around: we can help you arrange a van or a car with a trusted driver for your outings — at your own cost. Let us know the time and destination the day before, and everything will be ready when you set off."],
  ["Eau : les locaux boivent l'eau du robinet, mais nous vous recommandons l'eau en bouteille. Elle n'est pas fournie pour le séjour : on en trouve partout, au supermarché comme à l'alimentation du douar, ou nous pouvons l'ajouter à vos courses, au prix réel.",
   "Water: locals drink the tap water, but we recommend bottled water. It is not provided for the stay: you will find it everywhere, in the supermarkets as well as at the shop in the douar, or we can add it to your shopping, at cost."],
  ["Alcool : bienvenu à la villa. Vous en trouverez dans les supermarchés de Marrakech, ou vous pouvez en apporter : la douane marocaine autorise, par adulte, une bouteille d'un litre de vin et une bouteille d'un litre de spiritueux en franchise.",
   "Alcohol: welcome at the villa. You will find it in the Marrakech supermarkets, or you may bring your own: Moroccan customs allow each adult one 1-litre bottle of wine and one 1-litre bottle of spirits duty-free."],
  ["Dépannage : une alimentation se trouve au douar voisin, à quelques minutes — à pied ou en voiture.",
   "Last-minute essentials: there is a shop in the neighbouring douar, a few minutes away — on foot or by car."],
  ["Blanchisserie : nous travaillons avec un blanchisseur local qui peut s'occuper de votre linge, à votre charge et à son tarif. Confiez-le à l'équipe avant 10h, vous le retrouverez sous 48h.",
   "Laundry: we work with a local laundry service that can take care of your washing, at your own cost and at their rate. Hand it to the team before 10 am and you will have it back within 48 hours."]
];

const ROOMS = [
  {t:['Suite principale','Master Suite'],
   bed:['Lit à baldaquin — king size','Four-poster bed — king size'],
   bath:['Privative, avec baignoire','Private, with bathtub'],
   d:['Spacieuse · cheminée · vue sur le jardin et la piscine · idéale pour un couple','Spacious · fireplace · garden and pool view · ideal for a couple']},
  {t:['Chambre du pavillon','Pavilion Bedroom'], tag:['Pavillon 1 — indépendant','Pavilion 1 — independent'],
   bed:['Lit double','Double bed'],
   bath:['Privative, avec douche','Private, with shower'],
   d:['Entrée indépendante · au calme','Independent entrance · quiet']},
  {t:['Chambre 3','Bedroom 3'], tag:['Pavillon 2 — indépendant','Pavilion 2 — independent'],
   bed:['Lit double','Double bed'],
   bath:['Privative, avec douche','Private, with shower'],
   d:['Contiguë à la chambre 4 · parfaite pour une famille ou des amis','Adjoining bedroom 4 · perfect for a family or friends']},
  {t:['Chambre 4','Bedroom 4'], tag:['Pavillon 2 — indépendant','Pavilion 2 — independent'],
   bed:['2 lits simples, ou lit double sur demande','2 single beds, or a double bed on request'],
   bath:['Privative, avec baignoire','Private, with bathtub'],
   d:['Contiguë à la chambre 3 · calme, côté jardin','Adjoining bedroom 3 · quiet, garden side']},
  {t:['Chambre du jardin','Garden Bedroom'],
   bed:['Lit double','Double bed'],
   bath:['Privative, avec baignoire','Private, with bathtub'],
   d:['Accès direct au jardin et au salon','Direct access to the garden and living room']}
];

const GOOD_TO_KNOW = [
  ["Chaque chambre dispose de sa propre salle de bain privative avec WC : baignoire ou douche selon la chambre.",
   "Each bedroom has its own private bathroom with WC: bathtub or shower depending on the room."],
  ["Draps et serviettes fournis, changés une fois par semaine · serviettes de piscine également fournies · couvertures et oreillers supplémentaires avec plaisir, sur simple demande.",
   "Linens and towels provided, changed once a week · pool towels provided as well · extra blankets and pillows gladly provided on request."],
  ["La chambre 4 est préparée en 2 lits simples — lit double possible sur demande, merci de le préciser au moins 48 h avant l'arrivée.",
   "Bedroom 4 is made up with 2 single beds — a double bed is possible on request, please let us know at least 48 h before arrival."],
  ["Un lit bébé et une chaise haute sont inclus. Nous disposons d'un second jeu, proposé à 400 MAD par article pour la durée du séjour. Au-delà, nous vous orientons vers un loueur spécialisé de Marrakech. Merci de nous prévenir dès la réservation.",
   "One cot and one high chair are included. We have a second set, offered at 400 MAD per item for the length of your stay. Beyond that, we will point you to a specialist rental company in Marrakech. Please let us know when booking."]
];

// Points detaches de l'ancien paragraphe mealNote : cinq informations sans
// rapport entre elles y etaient tassees, aucune ne ressortait.
const MEAL_NOTES = [
  ['Prix par groupe : préparation, service et vaisselle. Courses au prix réel, sur présentation du ticket (envoyé par WhatsApp) — comptez environ 40 à 80 MAD par personne selon les plats.','Prices per group: cooking, service and washing up. Groceries at cost, with the receipt sent by WhatsApp — allow about 40 to 80 MAD per person depending on the dishes.'],
  /* 300 MAD de logistique a chaque session de courses (decision du 09/10/2026,
     revient sur la session unique). Le gouter part sur la meme sortie que les
     repas du jour. */
  ['Courses : +300 MAD de logistique par session de courses.','Groceries: +300 MAD logistics per shopping run.'],
  ['Le goûter ne donne pas lieu à une session de courses supplémentaire : il part sur la même sortie que les repas du jour.','The afternoon tea does not add a shopping session: it goes on the same run as the day\'s meals.'],
  /* Boissons : jamais incluses dans les repas (12/10/2026, demande de Thibaut).
     Sans cette ligne, un groupe s'attend a trouver l'eau sur la table et la
     decouvre sur le ticket. */
  ['Boissons : elles ne sont pas comprises dans les repas. Eau plate ou gazeuse, glaçons, sodas, vin ou autre : envoyez-nous votre liste avec vos menus, elle passe dans la même session de courses, au prix réel.','Drinks: they are not included in the meals. Still or sparkling water, ice, soft drinks, wine or anything else: send us your list with your menus, and it goes on the same shopping run, at cost.'],
  ['Jours fériés marocains : la préparation est facturée au double, au tarif de notre prestataire.','Moroccan public holidays: cooking is charged at double rate, as per our provider\'s rates.'],
];

const MEALS = [
  {n:['Petit-déjeuner','Breakfast'], a:['Inclus','Included'], b:['Inclus','Included'], h:['8h30 – 10h00','8:30 – 10:00 am']},
  {n:['Brunch, déjeuner ou dîner (sur demande)','Brunch, lunch or dinner (on request)'], a:['650 MAD','650 MAD'], b:['850 MAD','850 MAD'], h:['Brunch dès 10h30 · Déjeuner 12h30 – 14h30 · Dîner 19h30 – 21h30','Brunch from 10:30 am · Lunch 12:30 – 2:30 pm · Dinner 7:30 – 9:30 pm']},
  {n:['Goûter (sur demande)','Afternoon tea (on request)'], a:['300 MAD','300 MAD'], b:['400 MAD','400 MAD'], h:['17h00 – 18h30','5:00 – 6:30 pm']}
];

const LEISURE = [
  ['Piscine (non chauffée)','Swimming pool (not heated)'],
  ['Pergola près de la piscine — coin ombragé','Pergola by the pool — shaded spot'],
  ['Trampoline et balançoires dans le jardin','Trampoline and swings in the garden'],
  ['Fitness : un poids de 10 kg, deux poids de 5 kg, vélo cardio','Fitness: one 10 kg weight, two 5 kg weights, cardio bike'],
  ['Jeux de société & cartes, tapis de yoga','Board games & cards, yoga mats'],
  ['Cours de yoga : nous vous mettons en relation avec un professeur — sur demande, à votre charge',
   'Yoga classes: we can put you in touch with a teacher — on request, at your own cost'],
  ['Massage à la villa : nous vous mettons en relation avec notre praticienne — sur demande, à votre charge',
   'In-villa massage: we can put you in touch with our therapist — on request, at your own cost'],
  ['Salon avec cheminée et grande terrasse ombragée','Living room with fireplace and large shaded terrace']
];

const RULES = [
  ["Dar J est avant tout une maison de famille — merci d'en respecter l'esprit.","Dar J is first and foremost a family home — please respect its spirit."],
  ['Musique et moments conviviaux bienvenus — nous vous demandons simplement de veiller au calme entre 23h et 7h, par égard pour le voisinage.','Music and gatherings very welcome — we simply ask that things stay quiet between 11 pm and 7 am, out of consideration for our neighbours.'],
  ["Non-fumeur à l'intérieur. Animaux non acceptés.",'No smoking inside. No pets.'],
  ['Uniquement les hôtes enregistrés — pas de visiteurs, ni de fête ou d\'événement, sans accord préalable.','Registered guests only — no visitors, parties or events without prior agreement.'],
  ["Passeports : merci de nous envoyer une photo du passeport de chaque voyageur avant votre arrivée — nous sommes tenus de déclarer chaque personne séjournant dans la maison.",
   "Passports: please send us a photo of each traveller's passport before you arrive — we are required to register everyone staying in the house."],
  ["Loi marocaine : les couples marocains non mariés ne peuvent pas partager une chambre — obligation légale applicable à tous les hébergements.",
   "Moroccan law: unmarried Moroccan couples cannot share a room — a legal requirement for all accommodation."]
];

const BREAKFAST = [
  ['Crêpes marocaines chaudes (msemen)','Warm Moroccan pancakes (msemen)'],
  ['Pain frais, beurre, confiture, miel','Fresh bread, butter, jam, honey'],
  ['2 œufs par personne, à votre goût','2 eggs per person, as you like'],
  ['Jus de fruits frais pressés, selon la saison — un grand verre par personne','Freshly squeezed seasonal fruit juice — one large glass per person'],
  ['Thé et café à volonté','Unlimited tea and coffee']
];

const GOUTER = [
  ['Thé à la menthe','Mint tea'],
  ['Dattes fourrées amande ou noix','Stuffed dates with almonds or walnuts'],
  ['Amandes grillées','Roasted almonds'],
  ['Msemen tièdes au miel','Warm msemen with honey'],
  ['Briouates au fromage ou à la viande','Cheese or meat briouates'],
  ['Cornes de gazelle et pâtisseries marocaines','Gazelle horns and Moroccan pastries'],
  ['Plateau de fruits de saison','Seasonal fruit platter']
];

const STARTERS = [
  ['Salade marocaine — tomates, concombres, oignons, herbes, huile d\'olive','Moroccan salad — tomatoes, cucumbers, onions, herbs, olive oil'],
  ['Salade mechouia — poivrons & tomates grillés, ail, huile d\'olive','Mechouia salad — grilled peppers & tomatoes, garlic, olive oil'],
  ['Salade betterave & carotte — cumin et coriandre','Beet & carrot salad — cumin and coriander'],
  ['Harira — soupe traditionnelle (pois chiches, lentilles, tomates)','Harira — traditional soup (chickpeas, lentils, tomatoes)'],
  ['Salade de lentilles aux herbes','Herbed lentil salad'],
  ['Zaalouk — aubergine fumée et tomate','Zaalouk — smoky aubergine and tomato'],
  ['Salade de potiron à la cannelle','Pumpkin salad with cinnamon']
];

const MAINS = [
  ['Tajine de poulet aux olives & citrons confits','Chicken tajine with olives & preserved lemons'],
  ['Tajine d\'agneau aux pruneaux & amandes','Lamb tajine with prunes & almonds'],
  ['Tajine de kefta à la sauce tomate','Kefta tajine in tomato sauce'],
  ['Couscous (poulet, bœuf ou légumes)','Couscous (chicken, beef or vegetables)'],
  ['Kebabs marocains & frites maison','Moroccan kebabs & homemade fries'],
  ['Brochettes de poulet & légumes grillés','Chicken skewers & grilled vegetables'],
  ['Tajine de légumes','Vegetable tajine'],
  ['Couscous sept légumes','Seven-vegetable couscous'],
  ['Poisson à la charmoula','Fish with charmoula'],
  ['Pastilla','Pastilla'],
  ['Briouates','Briouates']
];

// Plats neutres, volontairement separes des specialites marocaines par leur
// propre titre. Les sejours longs (Fiona 8 nuits, Alix 7) et les groupes avec
// jeunes enfants (Jeremie Noel : 2 enfants + 3 bebes) ne tiennent pas huit
// diners marocains d'affilee. Sous un titre explicite, ces plats deviennent une
// attention plutot qu'un remplissage de carte.
const SIMPLE = [
  ['Steak haché & frites maison','Beef patty & homemade fries'],
  ['Brochettes de poulet ou de bœuf & frites maison','Chicken or beef skewers & homemade fries'],
  ['Poulet grillé & riz','Grilled chicken & rice']
];

const DESSERTS = [
  ['Salade d\'oranges à la cannelle','Orange salad with cinnamon'],
  ['Cornes de gazelle','Gazelle horns'],
  ['Pâtisseries marocaines assorties','Assorted Moroccan pastries'],
  ['Fruits de saison','Seasonal fruit'],
  ['Bousboussa — gâteau marocain au citron','Bousboussa — Moroccan lemon cake'],
  ['Pastilla au lait','Pastilla au lait']
];

/* ↑ garde-fou : si tu ajoutes une entrée, respecte bien la forme [fr, en] */

const MEDINA = [
  {n:['Palais de la Bahia','Bahia Palace'], d:['Palais du XIXᵉ siècle, jardins luxuriants, architecture islamique raffinée.','19th-c. palace, lush gardens, refined Islamic architecture.']},
  {n:['Palais El Badi','El Badi Palace'], d:['Palais en ruines du XVIᵉ siècle, vues panoramiques.','16th-c. ruined palace with panoramic views.']},
  {n:['Médersa Ben Youssef','Ben Youssef Medersa'], d:['Ancienne école coranique — bois sculpté et mosaïques.','Former Quranic school — carved wood and mosaics.']},
  {n:['Tombeaux Saadiens','Saadian Tombs'], d:['Site royal du XVIᵉ siècle — stuc, marbre, jardins.','16th-c. royal site — stucco, marble, gardens.']},
  {n:['Place Jemaa el-Fna','Jemaa el-Fna Square'], d:['Le cœur vivant de Marrakech — artistes, stands de nourriture.','The lively heart of Marrakech — performers, food stalls.']},
  {n:['Soufiane Zarib','Soufiane Zarib'], d:['Tapis berbères faits main — pièces uniques et authentiques.','Handmade Berber rugs — unique, authentic pieces.']},
  {n:['Parking Médina','Medina Parking'], d:['Stationnement sécurisé pour visiter la médina.','Secure parking while you explore the Medina.']}
];

const GOLF = [
  {n:['Amelkis Golf','Amelkis Golf'], d:['à 15 min de la villa.','15 min from the villa.']},
  {n:['Royal Golf','Royal Golf'], d:['à 15 min.','15 min.']},
  {n:['Al Maaden Golf','Al Maaden Golf'], d:['à 20–25 min.','20–25 min.']}
];

const ACTIVITIES = [
  {n:['Oasiria Water Park','Oasiria Water Park'], d:['Piscines, toboggans, espaces verts. +212 5243-80438','Pools, slides, green spaces. +212 5243-80438'], url:'https://oasiria.com'},
  {n:['Quad & Buggy','Quad & Buggy'], d:['Quad, buggy et balades à dos de chameau dans le désert, prise en charge à la villa. +212 6 61 53 96 39','Quad, buggy and camel rides in the desert, pickup at the villa. +212 6 61 53 96 39']},
  {n:['Montgolfière','Hot Air Balloon'], d:["Vol au lever du soleil au-dessus de l'Atlas. +212 5 24 43 28 43",'Sunrise flight over the Atlas. +212 5 24 43 28 43'], url:'https://www.cieldafrique.info'},
  {n:["Désert d'Agafay",'Agafay Desert'], d:['Désert rocheux à 30 km — journée ou campement berbère. La Pause : déjeuner ou dîner dans le désert, quad possible ; contact Denis Royer +212 661 179 131.','Rocky desert 30 km away — day trip or Berber camp. La Pause: lunch or dinner in the desert, quad possible; contact Denis Royer +212 661 179 131.'], url:'https://www.lapause-marrakech.com'},
  {n:['La Perle aux Oiseaux','La Perle aux Oiseaux'], d:['5 min à pied — refuge de faune sauvage, plus de 100 espèces. Uniquement sur réservation, du mardi au dimanche, arrivées 10h, 11h, 15h ou 16h. +212 7 77 90 43 17','5 min walk — wildlife refuge, over 100 species. By booking only, Tuesday to Sunday, arrivals 10 am, 11 am, 3 pm or 4 pm. +212 7 77 90 43 17'], url:'https://laperleauxoiseaux.com/#reserver'},
  {n:["Vallée de l'Ourika",'Ourika Valley'], d:["Vallée verdoyante et cascades au pied de l'Atlas, à environ 1 h de route.",'Green valley and waterfalls at the foot of the Atlas, about 1 hour away.']},
  {n:["Cascades d'Ouzoud",'Ouzoud Falls'], d:['Les plus hautes cascades du Maroc, à environ 2 h 30 de route — journée complète.',"Morocco's highest waterfalls, about 2.5 hours away — a full day out."]},
  {n:['Ouarzazate et les studios de cinéma','Ouarzazate and the Film Studios'], d:["Kasbahs et décors de tournage de l'autre côté de l'Atlas — journée complète.",'Kasbahs and film sets on the other side of the Atlas — a full day out.']}
];

const RESTAURANTS = [
  {n:["L'Épicurien","L'Épicurien"], d:['Restaurant & lounge chic avec musique live, Hivernage.','Chic restaurant & lounge with live music, Hivernage.']},
  {n:['Le Comptoir Darna','Le Comptoir Darna'], d:['Spectacles de danse orientale, ambiance festive.','Oriental dance shows, festive atmosphere.'], url:'https://www.comptoirmarrakech.com/'},
  {n:['Nomad','Nomad'], d:['Cuisine moderne, superbe vue sur les toits de la médina.','Modern dining, superb view over the medina roofs.'], url:'https://nomadmarrakech.com'},
  {n:['La Mamounia','La Mamounia'], d:['Le palace de Marrakech — expérience gastronomique de luxe.','The Marrakech palace — a luxurious gastronomic experience.'], url:'https://www.mamounia.com'},
  {n:['Le Foundouk','Le Foundouk'], d:['Restaurant élégant de la médina avec terrasse sur le toit.','Elegant medina restaurant with a rooftop terrace.'], url:'https://www.foundouk.com'},
  {n:['Café de la Poste','Café de la Poste'], d:['Institution de Gueliz — terrasse, charme rétro-colonial.','Gueliz institution — terrace dining, retro-colonial charm.'], url:'https://www.grandcafedelaposte.restaurant'},
  {n:['El Fenn','El Fenn'], d:['Rooftop emblématique de la médina, vue sur la Koutoubia — déjeuner, dîner et cocktails.','Iconic medina rooftop with Koutoubia views — lunch, dinner and cocktails.'], url:'https://el-fenn.com'},
  {n:['La Maison Arabe','La Maison Arabe'], d:['Institution de la médina, cuisine marocaine raffinée.','A medina institution, refined Moroccan cuisine.'], url:'https://www.lamaisonarabe.com'},
  {n:['Les Jardins de la Koutoubia','Les Jardins de la Koutoubia'], d:['Excellent couscous, et un sky bar sur le toit.','Excellent couscous, with a rooftop sky bar.'], url:'https://www.lesjardinsdelakoutoubia.com'},
  {n:['Jad Mahal','Jad Mahal'], d:["Dîner festif à l'Hivernage, musique live.",'Festive dinner in Hivernage, live music.'], url:'https://www.jad-mahal.com'},
  {n:['Dar Soukkar','Dar Soukkar'], d:['Dîner festif dans un grand jardin, ambiance spectacle.','Festive dinner in a large garden, show atmosphere.'], url:'https://www.darsoukkar.com'},
  {n:['La Trattoria','La Trattoria'], d:['Cuisine italienne dans un cadre art déco, à Gueliz.','Italian cuisine in an art-deco setting, in Gueliz.'], url:'https://www.latrattoriamarrakech.com'},
  {n:['Le Jardin','Le Jardin'], d:['Cour intérieure verdoyante dans la médina, idéale pour déjeuner.','Leafy courtyard restaurant in the medina, ideal for lunch.'], url:'https://lejardinmarrakech.com'}
];

const CAFES = [
  ['Café des Épices'],
  ['Terrasse des Épices', 'https://www.terrassedesepices.com'],
  ['Café Arabe', 'https://www.cafearabe.com'],
  ['Dar Cherifa'],
  ['Le Baromètre', 'https://www.lebarometre.net/'],
  ['Kabana', 'https://www.kabana-marrakech.com']
];


/* Textes de faits du livret (deplaces de T) : les libelles restent dans livret.html. */
const TEXT = {
  roomsIntro:[`Cinq chambres de plain-pied, pour 10 personnes au maximum — les enfants comptent dans ce total. Nous pouvons accueillir en plus jusqu'à deux nourrissons : un lit bébé et une chaise haute sont inclus, le second jeu est proposé à 400 MAD par article.\nDeux pavillons indépendants complètent la maison principale.\nNous préparons les lits avant votre arrivée selon la composition du groupe — merci de nous indiquer à l'avance le nombre de couples et de personnes seules.`,
              `Five ground-floor bedrooms, for up to 10 people maximum — children count towards this total. We can also welcome up to two infants: one cot and one high chair are included, and a second set is available at 400 MAD per item.\nTwo independent pavilions complete the main house.\nWe prepare the beds before your arrival according to the group: please let us know in advance how many couples and single guests.`],
  earlyBrk:["Besoin d'un petit-déjeuner plus tôt ? Prévenez l'équipe la veille avant 16h. Elle installera tout ce qui peut l'être — café prêt, msemen à réchauffer, fruits pour les jus, pain, beurre et confitures — et vous montrera où chaque chose se trouve.\nVous n'aurez plus qu'à vous servir ; seuls les œufs seront à cuire vous-même. L'équipe, elle, arrive à 8h30.",
            "Need breakfast earlier? Let the staff know the day before by 4 pm. They will set out everything that can be prepared ahead — coffee ready, msemen to reheat, fruit for juicing, bread, butter and jams — and show you where everything is.\nYou will only need to help yourselves; the eggs are the only thing to cook. The team itself arrives at 8:30 am."],
  orderRule:["Vous arrivez à temps pour le goûter ou le dîner ? Un goûter ou un repas fait maison peut vous attendre dès le premier jour.\nDeux jours avant votre arrivée, envoyez-nous les repas que vous envisagez pendant le séjour (brunch, déjeuner, dîner, goûter) : la cuisinière et l'équipe s'organisent ainsi pour tout votre séjour. Vous pourrez ensuite ajouter ou modifier un repas sur place, au plus tard 2 jours à l'avance, choix des menus compris. C'est ce délai qui nous permet de réserver notre cuisinière et de tout préparer frais. Pour une demande plus tardive, parlez-en à "+VILLA.staff+" — nous ferons notre possible, sans pouvoir vous le garantir.\nPendant le séjour, le goûter, préparé par notre équipe, se commande simplement la veille.",
             "Arriving in time for afternoon tea or dinner? Afternoon tea or a home-cooked meal can be waiting for you on your first day.\nTwo days before you arrive, send us the meals you are planning for your stay (brunch, lunch, dinner, afternoon tea): this lets our cook and the team organise your whole stay. You can then add or change a meal once here, at least 2 days ahead, menu choices included. This notice is what allows us to book our cook and prepare everything fresh. For a later request, do speak to "+VILLA.staff+" — we will do our best, without being able to promise it.\nDuring your stay, afternoon tea, prepared by our team, simply needs ordering the day before."],
  /* Infos alignees sur laperleauxoiseaux.com (relu le 06/10/2026) : visite
     uniquement sur reservation, arrivees a heure fixe, paiement sur place.
     L'adresse du site devient un lien vers la reservation (kidsBoxHtml). */
  kidsBox:["Avec des enfants : La Perle aux Oiseaux, refuge de faune sauvage à 5 minutes à pied de la villa — plus de 100 espèces sur 3 hectares, une visite d'environ 1h30. Uniquement sur réservation, en ligne sur laperleauxoiseaux.com : du mardi au dimanche, arrivées à 10h, 11h, 15h ou 16h, règlement sur place. C'est la sortie la plus simple du séjour. Pensez aussi au trampoline et aux balançoires du jardin.",
           "With children: La Perle aux Oiseaux, a wildlife refuge a 5-minute walk from the villa — over 100 species on 3 hectares, a visit of about 1.5 hours. By booking only, online at laperleauxoiseaux.com/en: Tuesday to Sunday, arrivals at 10 am, 11 am, 3 pm or 4 pm, payment on site. It is the easiest outing of the stay. There are also the trampoline and swings in the garden."],
  mealsIntro:["Ces horaires permettent à l'équipe de vous recevoir dans les meilleures conditions.\nLe petit-déjeuner est le seul repas que nous puissions préparer à l'avance, pour que vous vous serviez avant l'arrivée de l'équipe — sur demande la veille, voir ci-dessous.",
              "These times allow the team to look after you at its best.\nBreakfast is the only meal we can set out in advance, so you may help yourselves before the team arrives — on request the day before, see below."],
  menuIntro:["Une sélection de plats préparés à la maison pendant votre séjour.\nPour chaque service, le groupe choisit ensemble une entrée, un plat et un dessert — c'est ce qui permet à la cuisine de tout préparer frais.\nDites-nous vos choix au moins 2 jours à l'avance, et signalez-nous tôt toute allergie ou restriction alimentaire : nous nous adapterons.",
             "A selection of dishes cooked at the house during your stay.\nFor each service the group chooses one starter, one main and one dessert together — this is what allows the kitchen to prepare everything fresh.\nLet us know your choices at least 2 days ahead, and tell us early of any allergies or dietary restrictions: we will adapt."],
  menuNote:["Une envie particulière ? Dites-le-nous à l'avance : si le plat est réalisable, nous le préparerons avec plaisir.",
            'Something particular in mind? Let us know in advance: if the dish can be made, we will be glad to prepare it.'],
};

/* ═══ Équipe — faits utilisés par l'app (brief staff, réponses), pas affichés
   dans le livret. Source : Jérémie, septembre–octobre 2026. Faiza (ancienne
   cheffe) ne travaille plus à la villa : ne jamais la citer ni promettre son
   répertoire de plats. ═══ */
const TEAM = [
  {name:'Saïd', brief:true,
   role:['majordome — premier contact sur place ; dort à la villa, joignable la nuit en cas d\'urgence',
         'house manager — first point of contact on site; sleeps at the villa, reachable at night for emergencies'],
   phone: VILLA.said},
  {name:'Bouchra', brief:true, role:['ménage', 'housekeeping']},
  {name:'Léa', brief:true, kitchen:true,
   role:['prestataire repas — envoie la cuisinière, réservée au moins 2 jours avant chaque repas',
         'meal provider — sends the cook, booked at least 2 days before each meal']},
  {name:'Houda', role:['massage à la villa — sur demande, à la charge des clients', 'in-villa massage — on request, at the guests\' cost']}
];

/* ═══ Résumé pour l'IA ═══════════════════════════════════════════════════
   digest('fr' | 'en') → texte compact, construit UNIQUEMENT à partir des
   données ci-dessus. L'app l'ajoute aux demandes de rédaction d'ARIA
   (réponses clients, messages, brief staff, chat) — jamais aux extractions,
   pour qu'un prix de la villa ne soit jamais pris pour une donnée client. */
function pick(pair, i) {
  if (!Array.isArray(pair)) return String(pair == null ? '' : pair);
  return String(pair[i] != null ? pair[i] : pair[0]);
}
const flat = s => String(s).replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
const head = s => String(s).split(' — ')[0].trim();

function digest(lang) {
  const i = lang === 'en' ? 1 : 0;
  const fr = i === 0;
  const P = pair => flat(pick(pair, i));
  const out = [];
  const sec = t => out.push('', '## ' + t);
  const li = t => out.push('- ' + t);

  out.push(fr
    ? '=== FICHE MAISON — VILLA DAR J (faits officiels et à jour) ==='
    : '=== HOUSE FACTS — VILLA DAR J (official and up to date) ===');
  out.push(fr
    ? 'Ces faits priment sur tout autre texte (mémoire, anciens modèles, historique de conversation). Cite uniquement ce qui est écrit ici ; une information absente se dit « à confirmer » — jamais inventée. Sers-t\'en pour rédiger, jamais comme donnée client à extraire. Prix des repas en MAD, par service et pour tout le groupe (jamais par personne).'
    : 'These facts override any other text (memory, old templates, conversation history). Only state what is written here; anything missing is "to be confirmed" — never invented. Use them to write, never as guest data to extract. Meal prices are in MAD, per service, for the whole group (never per person).');

  sec(fr ? 'Maison' : 'House');
  li((fr ? 'Maison de famille de ' : 'Family home of ') + VILLA.host + (fr ? ', propriétaire et hôte (souvent à l\'étranger).' : ', owner and host (often abroad).'));
  li((fr ? 'Adresse : ' : 'Address: ') + VILLA.address + ' — GPS ' + VILLA.pin.lat + ',' + VILLA.pin.lng);
  li(P(TEXT.roomsIntro));
  ROOMS.forEach(r => li(P(r.t) + (r.tag ? ' (' + P(r.tag) + ')' : '') + ' : ' + P(r.bed) + ' · ' + P(r.bath)));
  const x = VILLA.extraGuest;
  li(fr
    ? 'Supplément voyageurs (réglage Airbnb) : ' + x.fee + ' € par nuit et par personne à partir du ' + x.from + 'e voyageur, ' + x.max + ' personnes au maximum.'
    : 'Extra guest fee (Airbnb setting): €' + x.fee + ' per night per person from guest no. ' + x.from + ', ' + x.max + ' people maximum.');

  sec(fr ? 'Équipe' : 'Team');
  TEAM.forEach(m => li((m.name ? m.name + ' : ' : '') + pick(m.role, i) + (m.phone ? ' (' + m.phone + ')' : '')));
  li((fr ? 'Hôte : ' : 'Host: ') + VILLA.host + ' ' + VILLA.hostPhone);

  sec(fr ? 'Repas' : 'Meals');
  MEALS.forEach(m => {
    const same = pick(m.a, i) === pick(m.b, i);
    li(P(m.n) + ' : ' + (same ? P(m.a) : P(m.a) + (fr ? ' (1–6 pers.) / ' : ' (1–6 guests) / ') + P(m.b) + (fr ? ' (7–10 pers.)' : ' (7–10 guests)')) + ' — ' + P(m.h));
  });
  MEAL_NOTES.forEach(n => li(P(n)));
  li(P(TEXT.orderRule));
  li(P(TEXT.menuIntro));
  li(P(TEXT.earlyBrk));
  li((fr ? 'Petit-déjeuner : ' : 'Breakfast: ') + BREAKFAST.map(b => P(b)).join(', '));
  li((fr ? 'Goûter : ' : 'Afternoon tea: ') + GOUTER.map(g => P(g)).join(', '));
  li((fr ? 'Entrées : ' : 'Starters: ') + STARTERS.map(s => head(P(s))).join(', '));
  li((fr ? 'Plats : ' : 'Mains: ') + MAINS.map(s => head(P(s))).join(', '));
  li((fr ? 'Pour les enfants : ' : 'For children: ') + SIMPLE.map(s => head(P(s))).join(', '));
  li((fr ? 'Desserts : ' : 'Desserts: ') + DESSERTS.map(s => head(P(s))).join(', '));

  sec(fr ? 'Pratique' : 'Practical');
  PRACTICAL.forEach(p => li(P(p)));
  GOOD_TO_KNOW.forEach(g => li(P(g)));
  li('Wi-Fi : ' + VILLA.wifi.net + ' / ' + VILLA.wifi.pass);

  sec(fr ? 'Règles de la maison' : 'House rules');
  RULES.forEach(r => li(P(r)));

  sec(fr ? 'Loisirs et alentours' : 'Leisure and surroundings');
  li(LEISURE.map(l => P(l)).join(' · '));
  li(P(TEXT.kidsBox));
  li((fr ? 'Golf : ' : 'Golf: ') + GOLF.map(g => P(g.n) + ' ' + P(g.d)).join(' ; '));
  li((fr ? 'Activités : ' : 'Activities: ') + ACTIVITIES.map(a => P(a.n)).join(', '));
  li((fr ? 'Restaurants conseillés : ' : 'Recommended restaurants: ') + RESTAURANTS.map(r => P(r.n)).join(', '));

  return out.join('\n');
}

window.VILLA_FACTS = Object.freeze({
  VILLA, PRACTICAL, ROOMS, GOOD_TO_KNOW, MEAL_NOTES, MEALS, LEISURE, RULES,
  BREAKFAST, GOUTER, STARTERS, MAINS, SIMPLE, DESSERTS, MEDINA, GOLF,
  ACTIVITIES, RESTAURANTS, CAFES, TEXT, TEAM,
  digest
});
})();
