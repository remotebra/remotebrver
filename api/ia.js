const GEMINI_KEY = process.env.GEMINI_KEY || 'AIzaSyDMA1E8KOr1qFBHu_DuR83SbxbIbRw22O0';
const GEMINI_MODEL = 'gemini-2.0-flash';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, max_tokens = 800 } = req.body || {};
    if (!messages) return res.status(400).json({ error: 'Missing messages' });

    // Converte formato OpenAI → Gemini
    const contents = [];
    for (const m of messages) {
      if (m.role === 'system') {
        // Gemini não tem role "system" — injeta como primeiro turno user/model
        contents.push({ role: 'user', parts: [{ text: m.content }] });
        contents.push({ role: 'model', parts: [{ text: 'Entendido. Vou seguir essas instruções.' }] });
      } else {
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        });
      }
    };

const GEMINI_KEY = process.env.GEMINI_KEY || 'AIzaSyDMA1E8KOr1qFBHu_DuR83SbxbIbRw22O0';
const GEMINI_MODEL = 'gemini-2.0-flash';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, max_tokens = 800 } = req.body || {};
    if (!messages) return res.status(400).json({ error: 'Missing messages' });

    // Converte formato OpenAI → Gemini
    const contents = [];
    for (const m of messages) {
      if (m.role === 'system') {
        // Gemini não tem role "system" — injeta como primeiro turno user/model
        contents.push({ role: 'user', parts: [{ text: m.content }] });
        contents.push({ role: 'model', parts: [{ text: 'Entendido. Vou seguir essas instruções.' }] });
      } else {
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        });
      }
    }



const GROQ_KEY = process.env.GROQ_KEY || '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';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, max_tokens = 800 } = req.body || {};
    if (!messages) return res.status(400).json({ error: 'Missing messages' });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({ model: GROQ_MODEL, messages, max_tokens, temperature: 0.7 }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'Groq error' });
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: 'IA indisponivel', detail: err.message });
  }
};

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: { maxOutputTokens: max_tokens, temperature: 0.7 }
        }),
        signal: AbortSignal.timeout(30000),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Gemini error' });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Retorna no mesmo formato OpenAI que o app.js já espera
    res.status(200).json({
      choices: [{ message: { role: 'assistant', content: text } }]
    });

  } catch (err) {
    res.status(502).json({ error: 'IA indisponivel', detail: err.message });
  }
};
