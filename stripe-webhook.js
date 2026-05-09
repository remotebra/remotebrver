module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { email } = req.body || {};
    if (!email) return res.status(200).json({ isOwner: false });

    const ownerEmails = (process.env.OWNER_EMAILS || '')
      .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

    const isOwner = ownerEmails.includes(email.toLowerCase());
    res.status(200).json({ isOwner });
  } catch(e) {
    res.status(200).json({ isOwner: false });
  }
};
