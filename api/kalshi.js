// api/kalshi.js
// Kalshi public market data — no auth required
// Debug showed API returns multivariate combo markets with price 0.0000 first
// Solution: filter status=active + skip zero-price markets + skip multivariate

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');

  const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
  const allMarkets = [];

  try {
    // Fetch only ACTIVE markets (not settled, not finalized)
    // Also exclude multivariate combo markets which have no standalone price
    let cursor = '';
    let page = 0;

    do {
      const params = new URLSearchParams({
        limit: '1000',
        status: 'active',  // only active markets
      });
      if (cursor) params.set('cursor', cursor);

      const url = `${BASE}/markets?${params}`;

      const r = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(12000),
      });

      if (!r.ok) {
        const body = await r.text();
        throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
      }

      const json = await r.json();
      const batch = json.markets || [];
      allMarkets.push(...batch);

      cursor = json.cursor || '';
      page++;
    } while (cursor && page < 5); // up to 5000 markets

    // Filter to only markets with real prices
    const markets = allMarkets
      .filter(m => {
        // Skip multivariate combo markets (they have mve_collection_ticker)
        if (m.mve_collection_ticker) return false;

        // Skip if market_type is not binary
        if (m.market_type !== 'binary') return false;

        // Need at least one non-zero price field
        const bid  = parseFloat(m.yes_bid_dollars  || '0');
        const ask  = parseFloat(m.yes_ask_dollars  || '0');
        const last = parseFloat(m.last_price_dollars || '0');
        const best = Math.max(bid, ask, last);

        return best >= 0.02 && best <= 0.98;
      })
      .map(m => {
        const bid  = parseFloat(m.yes_bid_dollars   || '0') || 0;
        const ask  = parseFloat(m.yes_ask_dollars   || '0') || 0;
        const last = parseFloat(m.last_price_dollars || '0') || 0;

        // Best mid-price
        let yesProb;
        if (bid >= 0.02 && ask >= 0.02 && ask >= bid) {
          yesProb = (bid + ask) / 2;
        } else if (last >= 0.02) {
          yesProb = last;
        } else if (bid >= 0.02) {
          yesProb = bid;
        } else {
          yesProb = ask;
        }
        yesProb = Math.round(Math.min(Math.max(yesProb, 0.01), 0.99) * 10000) / 10000;

        const volume = parseFloat(m.volume_fp || '0') || 0;

        return {
          ticker:        m.ticker,
          event_ticker:  m.event_ticker || null,
          title:         m.title || m.ticker,
          yes_sub_title: m.yes_sub_title || null,
          no_sub_title:  m.no_sub_title  || null,
          yesProb,
          yes_bid:    bid,
          yes_ask:    ask,
          last_price: last,
          volume,
          status:     m.status || null,
          close_time: m.close_time || null,
          url: `https://kalshi.com/markets/${(m.event_ticker || m.ticker).toLowerCase()}`,
        };
      })
      .sort((a, b) => b.volume - a.volume);

    res.status(200).json({
      ok: true,
      markets,
      count: markets.length,
      total_raw: allMarkets.length,
      pages_fetched: page,
      updatedAt: new Date().toISOString(),
    });

  } catch (e) {
    console.error('[kalshi] Error:', e.message);
    res.status(500).json({
      ok: false,
      error: e.message,
      total_raw: allMarkets.length,
      markets: [],
    });
  }
}
