// api/kalshi.js
// Kalshi public REST API — no auth needed for market data
// Official docs: https://docs.kalshi.com/getting_started/quick_start_market_data
// Prices format (post March 12, 2026): dollar strings e.g. "0.6500"

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');

  const BASE = 'https://api.elections.kalshi.com/trade-api/v2';

  try {
    // Fetch open markets — limit 200, no auth needed
    const url = `${BASE}/markets?status=open&limit=200`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = await response.json();
    const rawMarkets = data.markets || [];

    if (rawMarkets.length === 0) {
      return res.status(200).json({ ok: true, markets: [], count: 0, note: 'empty response from Kalshi' });
    }

    const markets = rawMarkets
      .map(m => {
        // --- Parse YES probability ---
        // New format (post March 2026): yes_bid_dollars = "0.6500" (dollar string)
        // Fallback: last_price_dollars, then yes_ask_dollars
        let yesProb = null;

        if (m.yes_bid_dollars != null && m.yes_ask_dollars != null) {
          // Mid-price between best bid and ask
          const bid = parseFloat(m.yes_bid_dollars);
          const ask = parseFloat(m.yes_ask_dollars);
          if (!isNaN(bid) && !isNaN(ask) && bid > 0 && ask > 0) {
            yesProb = (bid + ask) / 2;
          }
        }

        if (yesProb == null && m.last_price_dollars != null) {
          const lp = parseFloat(m.last_price_dollars);
          if (!isNaN(lp) && lp > 0) yesProb = lp;
        }

        if (yesProb == null && m.yes_bid_dollars != null) {
          const bid = parseFloat(m.yes_bid_dollars);
          if (!isNaN(bid) && bid > 0) yesProb = bid;
        }

        // Skip markets without a valid price
        if (yesProb == null || yesProb <= 0.01 || yesProb >= 0.99) return null;

        // Volume
        const volume = parseFloat(m.volume_fp ?? m.volume ?? '0') || 0;

        return {
          ticker:       m.ticker,
          event_ticker: m.event_ticker || null,
          title:        m.title || m.ticker,
          yes_sub_title: m.yes_sub_title || null,  // e.g. "Above 30°C"
          no_sub_title:  m.no_sub_title  || null,  // e.g. "Below 30°C"
          yesProb:      Math.round(yesProb * 10000) / 10000,
          yes_bid:      parseFloat(m.yes_bid_dollars || '0'),
          yes_ask:      parseFloat(m.yes_ask_dollars || '0'),
          last_price:   parseFloat(m.last_price_dollars || '0'),
          volume,
          close_time:   m.close_time || null,
          url: `https://kalshi.com/markets/${(m.event_ticker || m.ticker).toLowerCase()}`,
        };
      })
      .filter(Boolean) // remove nulls
      .sort((a, b) => b.volume - a.volume);

    res.status(200).json({
      ok: true,
      markets,
      count: markets.length,
      total_raw: rawMarkets.length,
      updatedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[kalshi.js] Error:', err.message);
    res.status(500).json({
      ok: false,
      error: err.message,
      markets: [],
    });
  }
}
