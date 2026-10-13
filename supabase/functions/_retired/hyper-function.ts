// Add to your ai-proxy Edge Function (Deno/TypeScript)
if (body.task === 'vision_chat') {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('GROQ_API_KEY')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: body.model || 'llama-3.2-11b-vision-preview',
      messages: body.messages,           // already in OpenAI vision format
      max_tokens: body.max_tokens || 800,
      temperature: 0.3
    })
  });
  const d = await r.json();
  return new Response(JSON.stringify({
    text: d.choices?.[0]?.message?.content || '',
    raw: d
  }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}
