// api/kalshi.js — Vercel Serverless Function
// Fetches live markets from Kalshi public API (no auth needed)

const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  try {
    // Fetch top open markets sorted by volume
    const url = `${KALSHI_BASE}/markets?limit=100&status=open`;
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });

    if (!resp.ok) throw new Error(`Kalshi API error: ${resp.status}`);
    const data = await resp.json();
    const markets = (data.markets || []);

    // Build simplified list with yes_price as probability
    const result = markets
      .filter(m => {
        const p = m.yes_bid || m.last_price || m.yes_ask;
        return p != null && p > 2 && p < 98; // prices in cents (2–98%)
      })
      .map(m => {
        const yesCents = m.yes_bid || m.last_price || m.yes_ask || 50;
        const yesProb  = yesCents / 100; // convert cents → 0..1
        const volume   = m.volume || 0;

        return {
          ticker:  m.ticker,
          title:   m.title || m.ticker,
          yesProb: Math.round(yesProb * 1000) / 1000,
          yes_bid: m.yes_bid,
          yes_ask: m.yes_ask,
          last_price: m.last_price,
          volume,
          closeTime: m.close_time || null,
          url: `https://kalshi.com/markets/${m.event_ticker || m.ticker}`,
        };
      })
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 100);

    res.status(200).json({ markets: result, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
