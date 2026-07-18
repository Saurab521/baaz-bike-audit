export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { target } = req.query;

  if (!target) {
    return res.status(400).json({ error: 'Missing target parameter' });
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid target URL' });
  }

  // Filter headers
  const forwardHeaders = {};
  for (const [key, val] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (['host', 'origin', 'referer', 'connection', 'accept-encoding'].includes(lower)) continue;
    forwardHeaders[key] = val;
  }
  forwardHeaders['host'] = targetUrl.host;

  try {
    const fetchRes = await fetch(targetUrl.href, {
      method: req.method,
      headers: forwardHeaders,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
    });

    // Forward response headers
    for (const [key, val] of fetchRes.headers.entries()) {
      const lower = key.toLowerCase();
      if (lower.startsWith('access-control-')) continue;
      if (['transfer-encoding', 'connection'].includes(lower)) continue;
      res.setHeader(key, val);
    }

    res.status(fetchRes.status);
    
    // Parse body as buffer to handle binary data perfectly
    const bodyBuffer = await fetchRes.arrayBuffer();
    return res.send(Buffer.from(bodyBuffer));
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Proxy Request Failed', details: err.message });
  }
}
