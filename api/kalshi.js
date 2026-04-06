// api/kalshi.js
// Kalshi public REST API — no auth needed for market data
// Docs: https://docs.kalshi.com/getting_started/quick_start_market_data
// Prices: yes_bid_dollars / yes_ask_dollars as dollar strings e.g. "0.6500"

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');

  const BASE = 'https://api.elections.kalshi.com/trade-api/v2';

  try {
    // Fetch open markets — NO status filter (status=open is too restrictive)
    // limit=1000 to get as many as possible
    const url = `${BASE}/markets?limit=1000`;

    const r = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000),
    });

    if (!r.ok) {
      const body = await r.text();
      throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
    }

    const data = await r.json();
    const raw = data.markets || [];

    const markets = raw
      .filter(m => {
        // Skip settled/resolved markets — keep open and initialized
        if (m.status === 'settled' || m.status === 'finalized') return false;

        // Need a valid price
        const bid = parseFloat(m.yes_bid_dollars ?? '0');
        const ask = parseFloat(m.yes_ask_dollars ?? '0');
        const last = parseFloat(m.last_price_dollars ?? '0');
        const price = bid > 0 ? bid : (ask > 0 ? ask : last);
        return price > 0.01 && price < 0.99;
      })
      .map(m => {
        const bid  = parseFloat(m.yes_bid_dollars  ?? '0') || 0;
        const ask  = parseFloat(m.yes_ask_dollars  ?? '0') || 0;
        const last = parseFloat(m.last_price_dollars ?? '0') || 0;

        // Best mid-price: use bid+ask average if both exist, otherwise last price
        let yesProb;
        if (bid > 0 && ask > 0) {
          yesProb = (bid + ask) / 2;
        } else if (bid > 0) {
          yesProb = bid;
        } else if (ask > 0) {
          yesProb = ask;
        } else {
          yesProb = last;
        }

        yesProb = Math.max(0.01, Math.min(0.99, yesProb));

        const volume = parseFloat(m.volume_fp ?? m.volume ?? '0') || 0;

        return {
          ticker:        m.ticker,
          event_ticker:  m.event_ticker || null,
          title:         m.title || m.ticker,         // market title
          yes_sub_title: m.yes_sub_title || null,      // e.g. "Above 30°C"
          no_sub_title:  m.no_sub_title  || null,      // e.g. "Below 30°C"
          yesProb:       Math.round(yesProb * 10000) / 10000,
          yes_bid:       bid,
          yes_ask:       ask,
          last_price:    last,
          volume,
          status:        m.status || null,
          close_time:    m.close_time || null,
          url: `https://kalshi.com/markets/${(m.event_ticker || m.ticker).toLowerCase()}`,
        };
      })
      .sort((a, b) => b.volume - a.volume);

    res.status(200).json({
      ok: true,
      markets,
      count: markets.length,
      total_raw: raw.length,
      updatedAt: new Date().toISOString(),
    });

  } catch (e) {
    console.error('[kalshi] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message, markets: [] });
  }
}
