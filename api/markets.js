// api/markets.js — Vercel Serverless Function
// Fetches live markets from Polymarket and returns enriched data

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  try {
    const url = 'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=50&order=volume&ascending=false';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Polymarket API error: ' + resp.status);
    const raw = await resp.json();

    const markets = raw
      .filter(m => {
        try {
          const prices = JSON.parse(m.outcomePrices || '[]');
          return prices.length === 2 && parseFloat(prices[0]) > 0.02 && parseFloat(prices[0]) < 0.98;
        } catch { return false; }
      })
      .map(m => {
        let prices = [];
        try { prices = JSON.parse(m.outcomePrices); } catch {}
        const yesProb = parseFloat(prices[0]) || 0.5;
        const volume = parseFloat(m.volume) || 0;

        return {
          id: m.id,
          slug: m.slug,
          title: m.question,
          category: guessCategory(m),
          yesProb: Math.round(yesProb * 1000) / 1000,
          volume,
          endDate: m.endDate || null,
          createdAt: m.createdAt,
          image: m.image || null,
          url: `https://polymarket.com/event/${m.slug}`
        };
      })
      .slice(0, 50);

    res.status(200).json({ markets, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function guessCategory(m) {
  const text = ((m.question || '') + ' ' + JSON.stringify(m.tags || '')).toLowerCase();
  if (/trump|biden|election|president|congress|senate|parliament|government|vote|democrat|republic|ukraine|russia|war|nato|geopolit|modi|zelensky|putin|xi |macron|sunak/.test(text)) return 'Politics';
  if (/bitcoin|btc|eth|ethereum|crypto|defi|nft|blockchain|token|coin|solana|doge|bnb|ripple|xrp/.test(text)) return 'Crypto';
  if (/nba|nfl|nhl|mlb|soccer|football|basketball|tennis|formula|f1|champion|league|match|game|team|player|playoff|world cup|premier|bundesliga|serie a|laliga/.test(text)) return 'Sports';
  if (/fed|rate|gdp|recession|inflation|economy|stock|market|earnings|bank|dollar|euro|interest|cpi|jobs|unemployment/.test(text)) return 'Economics';
  return 'Other';
}
