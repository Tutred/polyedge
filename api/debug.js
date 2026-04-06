// api/debug.js — показывает реальный маркет Kalshi с ценой и URL поля
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    const r = await fetch(
      'https://api.elections.kalshi.com/trade-api/v2/markets?limit=200&status=active&multivariate_markets=exclude',
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(12000) }
    );
    const j = await r.json();
    const markets = j.markets || [];

    // Find first market with real price
    const real = markets.filter(m => {
      const b = parseFloat(m.yes_bid_dollars || '0');
      const a = parseFloat(m.yes_ask_dollars || '0');
      const l = parseFloat(m.last_price_dollars || '0');
      return Math.max(b, a, l) >= 0.05 && Math.max(b, a, l) <= 0.95;
    });

    // Return first 3 real markets with ALL fields for URL inspection
    const sample = real.slice(0, 3).map(m => ({
      ticker:        m.ticker,
      event_ticker:  m.event_ticker,
      series_ticker: m.series_ticker,
      title:         m.title,
      yes_bid:       m.yes_bid_dollars,
      yes_ask:       m.yes_ask_dollars,
      last_price:    m.last_price_dollars,
      // URL candidates
      url_v1: `https://kalshi.com/markets/${(m.series_ticker||'').toLowerCase()}/${(m.event_ticker||'').toLowerCase()}`,
      url_v2: `https://kalshi.com/markets/${(m.event_ticker||'').toLowerCase()}`,
      url_v3: `https://kalshi.com/markets/${(m.ticker||'').toLowerCase()}`,
    }));

    res.status(200).json({
      total: markets.length,
      real_count: real.length,
      sample,
      ts: new Date().toISOString()
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
