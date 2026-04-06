// api/debug.js
// Open this URL in браузере: your-site.vercel.app/api/debug
// Покажет точно что возвращает Kalshi API

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const log = [];
  const result = {};

  // Test 1: basic fetch
  try {
    log.push('Trying: https://api.elections.kalshi.com/trade-api/v2/markets?limit=5');
    const r = await fetch(
      'https://api.elections.kalshi.com/trade-api/v2/markets?limit=5',
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) }
    );
    log.push(`Status: ${r.status}`);
    const text = await r.text();
    log.push(`Body length: ${text.length}`);
    log.push(`Body preview: ${text.slice(0, 500)}`);

    try {
      const j = JSON.parse(text);
      result.markets_count = j.markets?.length ?? 'no markets key';
      result.first_market = j.markets?.[0] ?? null;
      result.keys = Object.keys(j);
    } catch(e) {
      result.parse_error = e.message;
      result.raw = text.slice(0, 1000);
    }
  } catch(e) {
    log.push(`FETCH ERROR: ${e.message}`);
    result.fetch_error = e.message;
  }

  res.status(200).json({ log, result, ts: new Date().toISOString() });
}
