// Stafflo — Worker d'email Cloudflare (Email Routing → ce Worker → fonction Supabase email-in).
// Adresse de chaque compte : in-<jeton>@stafflo.app (Espace › Maison › « Emails Airbnb »).
// Règle Email Routing : « Catch-all » → Send to Worker « stafflo-email-in » (hello@ garde sa propre règle).
// Secret : INBOUND_KEY (valeur du secret Vault « inbound_key »), jamais dans le code.
import PostalMime from 'postal-mime';

export default {
  async email(message, env) {
    const to = String(message.to || '').trim().toLowerCase();
    if (!/^in-[a-z0-9]{10,16}@stafflo\.app$/.test(to)) { message.setReject('Unknown address'); return; }
    if (message.rawSize > 5 * 1024 * 1024) { message.setReject('Message too large'); return; }
    const mail = await PostalMime.parse(await new Response(message.raw).arrayBuffer());
    const h = (n) => message.headers.get(n) || '';
    const body = {
      to,
      from: (mail.from && mail.from.address) || message.from,
      from_name: (mail.from && mail.from.name) || '',
      subject: mail.subject || '',
      text: (mail.text || '').slice(0, 20000),
      html: mail.text ? '' : (mail.html || '').slice(0, 80000),
      message_id: mail.messageId || h('message-id'),
      date: mail.date || h('date'),
      fwd: h('x-forwarded-for'),
      auth: h('authentication-results'),
    };
    const r = await fetch(env.EMAIL_IN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-inbound-key': env.INBOUND_KEY }, body: JSON.stringify(body) });
    if (r.status === 404) { message.setReject('Unknown address'); return; }
    if (!r.ok && r.status !== 202) throw new Error('email-in ' + r.status); // erreur temporaire : l'expéditeur réessaiera
  },
};
