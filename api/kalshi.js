// api/kalshi.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  try {
    const r = await fetch(
      'https://api.elections.kalshi.com/trade-api/v2/markets?limit=100&status=open',
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) throw new Error(`Kalshi HTTP ${r.status}`);
    const j = await r.json();

    const markets = (j.markets || [])
      .filter(m => {
        const p = m.yes_bid ?? m.last_price ?? m.yes_ask;
        return p != null && p > 2 && p < 98;
      })
      .map(m => {
        const cents = m.yes_bid ?? m.last_price ?? m.yes_ask ?? 50;
        return {
          ticker:  m.ticker,
          title:   m.title || m.ticker,
          yesProb: Math.round(cents) / 100,
          yes_bid: m.yes_bid,
          yes_ask: m.yes_ask,
          volume:  m.volume || 0,
          url: `https://kalshi.com/markets/${m.event_ticker || m.ticker}`,
        };
      });

    res.status(200).json({ ok: true, markets });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
