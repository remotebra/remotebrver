const GEMINI_KEY = process.env.GEMINI_KEY;


let lastCall = 0;
const MIN_INTERVAL = 5000; // 4 segundos entre chamadas = máx 15/min

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, max_tokens = 800 } = req.body || {};
    if (!messages) return res.status(400).json({ error: 'Missing messages' });

    const contents = [];
    for (const m of messages) {
      if (m.role === 'system') {
        contents.push({ role: 'user', parts: [{ text: m.content }] });
        contents.push({ role: 'model', parts: [{ text: 'Entendido.' }] });
      } else {
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        });
      }
    }

  if(!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_KEY não configurada' });
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + GEMINI_KEY;
const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { maxOutputTokens: max_tokens, temperature: 0.7 }
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Gemini error' });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.status(200).json({ choices: [{ message: { content: text } }] });
  } catch (err) {
    res.status(502).json({ error: 'IA indisponivel', detail: err.message });
  }
};
