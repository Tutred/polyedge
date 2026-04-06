// api/kalshi.js
// Kalshi public market data — no auth required
// https://docs.kalshi.com/getting_started/quick_start_market_data

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');

  const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
  const allMarkets = [];

  try {
    // Paginate through all markets — Kalshi returns max 1000 per request
    let cursor = '';
    let page = 0;

    do {
      const url = cursor
        ? `${BASE}/markets?limit=1000&cursor=${encodeURIComponent(cursor)}`
        : `${BASE}/markets?limit=1000`;

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

      // Safety: max 3 pages (3000 markets) to avoid infinite loop
    } while (cursor && page < 3);

    // Filter and map
    const markets = allMarkets
      .filter(m => {
        if (m.status === 'settled' || m.status === 'finalized') return false;
        // Need at least one valid price
        const bid  = parseFloat(m.yes_bid_dollars  ?? '0');
        const ask  = parseFloat(m.yes_ask_dollars  ?? '0');
        const last = parseFloat(m.last_price_dollars ?? '0');
        const price = bid || ask || last;
        return price > 0.01 && price < 0.99;
      })
      .map(m => {
        const bid  = parseFloat(m.yes_bid_dollars  ?? '0') || 0;
        const ask  = parseFloat(m.yes_ask_dollars  ?? '0') || 0;
        const last = parseFloat(m.last_price_dollars ?? '0') || 0;

        // Best price estimate: mid if both bid+ask, else last, else whatever exists
        let yesProb;
        if (bid > 0 && ask > 0 && ask >= bid) {
          yesProb = (bid + ask) / 2;
        } else if (last > 0) {
          yesProb = last;
        } else if (bid > 0) {
          yesProb = bid;
        } else {
          yesProb = ask;
        }
        yesProb = Math.round(Math.min(Math.max(yesProb, 0.01), 0.99) * 10000) / 10000;

        const volume = parseFloat(m.volume_fp ?? '0') || 0;

        return {
          ticker:        m.ticker,
          event_ticker:  m.event_ticker || null,
          title:         m.title || m.ticker,
          yes_sub_title: m.yes_sub_title || null,
          no_sub_title:  m.no_sub_title  || null,
          yesProb,
          yes_bid:   bid,
          yes_ask:   ask,
          last_price: last,
          volume,
          status:    m.status || null,
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
