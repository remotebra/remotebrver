module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GROQ_KEY = process.env.GROQ_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_KEY não configurada' });

  try {
    const { messages, max_tokens = 800 } = req.body || {};
    if (!messages) return res.status(400).json({ error: 'Missing messages' });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_KEY
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens,
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Groq error' });
    }

    res.status(200).json({ choices: [{ message: { content: data.choices?.[0]?.message?.content || '' } }] });
  } catch (err) {
    res.status(502).json({ error: 'IA indisponivel', detail: err.message });
  }
};
