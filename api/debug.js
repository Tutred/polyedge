export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const KEY = process.env.SHARP_API_KEY;
  if (!KEY) return res.status(200).json({ error: 'NO SHARP_API_KEY in Vercel env vars' });

  try {
    // Fetch just 3 NBA lines to see raw format
    const r = await fetch('https://api.sharpapi.io/api/v1/odds?league=nba&market=moneyline&limit=3', {
      headers: { 'X-API-Key': KEY },
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 500) }; }

    res.status(200).json({
      http_status: r.status,
      top_keys: Object.keys(parsed),
      first_item: Array.isArray(parsed) ? parsed[0] : (parsed.data?.[0] || parsed.odds?.[0] || parsed),
      count: Array.isArray(parsed) ? parsed.length : (parsed.data?.length || parsed.odds?.length || '?'),
    });
  } catch(e) {
    res.status(200).json({ error: e.message });
  }
}
