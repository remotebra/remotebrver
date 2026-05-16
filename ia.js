
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
