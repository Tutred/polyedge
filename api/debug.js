// api/debug.js — показывает что реально приходит из SharpAPI и Polymarket
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const KEY = process.env.SHARP_API_KEY;
  const result = { sharp: null, poly: null, error: null };

  // Test SharpAPI — первые 3 события
  if (KEY) {
    try {
      const r = await fetch('https://api.sharpapi.io/api/v1/odds?league=nba&market=moneyline&limit=3', {
        headers: { 'X-API-Key': KEY },
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json();
      // Show raw structure of first item
      result.sharp = {
        status: r.status,
        count: (j.data||j.odds||j||[]).length,
        first_raw: (j.data||j.odds||j||[])[0] || null,
        keys_top: Object.keys(j),
      };
    } catch(e) { result.sharp = { error: e.message }; }
  } else {
    result.sharp = { error: 'NO SHARP_API_KEY' };
  }

  // Test Polymarket — first 2 events
  try {
    const r = await fetch('https://gamma-api.polymarket.com/events?active=true&closed=false&limit=2&order=volume&ascending=false');
    const j = await r.json();
    result.poly = {
      count: j.length,
      first_title: j[0]?.title,
      first_market_question: j[0]?.markets?.[0]?.question,
    };
  } catch(e) { result.poly = { error: e.message }; }

  res.status(200).json(result);
}
