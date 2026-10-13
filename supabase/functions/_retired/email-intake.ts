// email-intake — v19 (item 38) : FERMETURE DE L'ENDPOINT + FIX owner_id.
//
// Ce que v18 laissait passer, documenté dans son propre en-tête et jamais traité :
//   1. AUCUN contrôle du x-webhook-key, pourtant listé dans les headers CORS.
//      verify_jwt:false + CORS * + SERVICE_ROLE_KEY = n'importe qui sur Internet
//      pouvait POSTer un faux email dans la boîte, déclencher un appel Mistral
//      facturé, et empoisonner la base de connaissance d'ARIA. Pire que le trou
//      d'ai-proxy fermé en v43 : là c'était le coût, ici c'est l'intégrité des données.
//   2. `user_id: body.user_id || DEFAULT` — l'appelant choisissait le destinataire.
//      Multi-tenant demain = injection croisée entre comptes.
//   3. Écrivait `user_id` mais JAMAIS `owner_id` — or la RLS filtre sur owner_id
//      (vérifié 16/07 : aucun trigger sur email_inbox, aucun défaut de colonne).
//      Tout email entré par cet endpoint était donc INVISIBLE dans l'app. Les 14
//      lignes source='airbnb' n'ont un owner_id que parce qu'un UPDATE manuel l'a
//      rempli après coup.
//
// Sûr à déployer : l'endpoint n'a rien reçu depuis le 5 mai (gmail_pull a pris le
// relais le 6 mai, 184 emails depuis). Fermer ne casse aucun flux vivant.
//
// FAIL CLOSED : sans le secret EMAIL_INTAKE_KEY configuré, tout est rejeté. C'est
// voulu. Un endpoint d'ingestion ouvert par défaut est un endpoint compromis.
// Pour le réactiver : Supabase Dashboard → Edge Functions → Secrets → ajouter
// EMAIL_INTAKE_KEY, puis envoyer ce même secret en header x-webhook-key depuis
// le worker Cloudflare.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-key',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const SB_URL  = Deno.env.get('SUPABASE_URL') || ''
const SB_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const MISTRAL_KEY = Deno.env.get('MISTRAL_API_KEY') || ''
const INTAKE_KEY = Deno.env.get('EMAIL_INTAKE_KEY') || ''

// Single-tenant (Villa DarJ). NON surchargeable par le corps de la requête : c'est
// précisément ce qui rendait l'injection croisée possible.
const OWNER_ID = '0f25a319-8cbb-44ae-96e3-7befcda16c9b'

// Comparaison à temps constant : un === classique fuit la longueur du préfixe
// correct via le timing. Coût nul, autant le faire correctement.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // GET = health check. Ne révèle rien : ni la config, ni si le secret est posé.
  if (req.method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok', endpoint: 'email-intake', version: 19 }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // ── Porte d'entrée ────────────────────────────────────────────────────────
  if (!INTAKE_KEY) {
    console.error('email-intake: EMAIL_INTAKE_KEY absent — endpoint fermé (fail closed).')
    return new Response(JSON.stringify({ error: 'Endpoint not configured' }), {
      status: 503, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
  const provided = req.headers.get('x-webhook-key') || ''
  if (!safeEqual(provided, INTAKE_KEY)) {
    console.warn('email-intake: clé invalide ou absente — rejeté.')
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  try {
    const body = await req.json()

    const fromEmail = body.from || body.from_email || body.sender || ''
    const subject   = body.subject || ''
    const emailBody = body.body || body.text || body.plain || body.html || body.content || ''

    if (!emailBody && !subject) {
      return new Response(JSON.stringify({ error: 'No email body or subject provided' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const fromLower = fromEmail.toLowerCase()
    const subjectLower = subject.toLowerCase()
    const source = fromLower.includes('airbnb') || subjectLower.includes('airbnb') ? 'airbnb'
                 : fromLower.includes('booking.com') ? 'booking'
                 : fromLower.includes('vrbo') || fromLower.includes('homeaway') ? 'vrbo'
                 : 'direct'

    const isConfirmation = subjectLower.includes('booking confirmed') || subjectLower.includes('réservation confirmée') || subjectLower.includes('reservation confirmed') || subjectLower.includes('new booking')
    const isInquiry = subjectLower.includes('inquiry') || subjectLower.includes('enquiry') || subjectLower.includes('demande') || subjectLower.includes('question from')
    const isMessage = subjectLower.includes('message from') || subjectLower.includes('message de') || subjectLower.includes('new message')
    const isCancellation = subjectLower.includes('cancel') || subjectLower.includes('annul')
    const emailType = isCancellation ? 'cancellation' : isConfirmation ? 'confirmation' : isInquiry ? 'inquiry' : isMessage ? 'message' : 'other'

    // Dédup : même sujet + expéditeur dans les 5 dernières minutes
    const dupeCheck = await fetch(`${SB_URL}/rest/v1/email_inbox?subject=eq.${encodeURIComponent(subject)}&from_email=eq.${encodeURIComponent(fromEmail)}&received_at=gte.${new Date(Date.now() - 5*60*1000).toISOString()}&select=id&limit=1`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
    })
    if (dupeCheck.ok) {
      const dupes = await dupeCheck.json()
      if (dupes.length > 0) {
        return new Response(JSON.stringify({ success: true, duplicate: true, id: dupes[0].id }), {
          headers: { ...CORS, 'Content-Type': 'application/json' }
        })
      }
    }

    const insertRes = await fetch(`${SB_URL}/rest/v1/email_inbox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        from_email: fromEmail,
        subject: subject,
        body: emailBody.slice(0, 5000),
        source,
        status: 'new',
        owner_id: OWNER_ID,   // v19 — la colonne que la RLS filtre réellement.
        user_id: OWNER_ID     // conservé : les 14 lignes historiques l'ont.
      })
    })

    if (!insertRes.ok) {
      const e = await insertRes.text()
      throw new Error(`DB insert failed: ${e.slice(0,200)}`)
    }
    const rows = await insertRes.json()
    const inserted = Array.isArray(rows) ? rows[0] : rows
    const emailId = inserted?.id

    // Extraction IA (best-effort) — Mistral EU, mode JSON garanti par l'API.
    let extracted: any = { email_type: emailType }
    try {
      if (MISTRAL_KEY && emailBody.length > 20) {
        const extractPrompt = [
          'Extract guest booking info from this email. Return ONLY valid JSON, no markdown.',
          '{"name":"Full Name","arrival":"YYYY-MM-DD","departure":"YYYY-MM-DD","guests":0,"email_type":"confirmation|inquiry|message|cancellation|other","source":"Airbnb|Booking|VRBO|Direct","phone":"","notes":""}',
          'If field not found: empty string or 0.',
          'Email subject: ' + subject,
          'Email body:',
          emailBody.slice(0, 2000)
        ].join('\n')

        const aiRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${MISTRAL_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'mistral-medium-latest',
            messages: [{ role: 'user', content: extractPrompt }],
            max_tokens: 300,
            temperature: 0.1,
            response_format: { type: 'json_object' }
          })
        })
        if (aiRes.ok) {
          const aiData = await aiRes.json()
          const text = aiData.choices?.[0]?.message?.content || ''
          const m = text.replace(/```json\n?/g,'').replace(/```/g,'').trim().match(/\{[\s\S]*\}/)
          if (m) extracted = { ...extracted, ...JSON.parse(m[0]) }
        }
      }
    } catch(e) {
      console.warn('AI extraction failed:', e)
    }

    if (emailId) {
      await fetch(`${SB_URL}/rest/v1/email_inbox?id=eq.${emailId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SB_KEY,
          'Authorization': `Bearer ${SB_KEY}`
        },
        body: JSON.stringify({ extracted })
      })
    }

    return new Response(JSON.stringify({ success: true, id: emailId, extracted, source, email_type: emailType }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })

  } catch(e: any) {
    console.error('email-intake error:', e)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
