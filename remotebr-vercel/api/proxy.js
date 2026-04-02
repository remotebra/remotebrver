const ALLOWED_DOMAINS = [
  'remotive.com', 'jobicy.com', 'arbeitnow.com', 'himalayas.app',
  'remoteok.com', 'weworkremotely.com', 'api.lever.co',
  'boards-api.greenhouse.io', 'translate.googleapis.com',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'Missing url parameter' });

  const allowed = ALLOWED_DOMAINS.some(d => targetUrl.includes(d));
  if (!allowed) return res.status(403).json({ error: 'Domain not allowed' });

  try {
    const response = await fetch(targetUrl, {
      headers: { 'User-Agent': 'RemoteBR/1.0', 'Accept': 'application/json, text/xml, */*' },
      signal: AbortSignal.timeout(10000),
    });
    const contentType = response.headers.get('content-type') || 'application/json';
    const body = await response.text();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.status(200).send(body);
  } catch (err) {
    res.status(502).json({ error: 'Fetch failed', detail: err.message });
  }
}
