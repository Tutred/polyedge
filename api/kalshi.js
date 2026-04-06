// api/kalshi.js
// Kalshi public API — no auth required for market data
// Uses new dollar-string price format (post March 2026 migration)
// Docs: https://docs.kalshi.com/getting_started/quick_start_market_data

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  try {
    // Fetch top 200 open markets, sorted by volume
    const url = 'https://api.elections.kalshi.com/trade-api/v2/markets?limit=200&status=open';

    const r = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(9000),
    });

    if (!r.ok) {
      const body = await r.text();
      throw new Error(`Kalshi HTTP ${r.status}: ${body.slice(0, 200)}`);
    }

    const j = await r.json();
    const raw = j.markets || [];

    const markets = raw
      .filter(m => {
        // New format: yes_bid_dollars is a dollar string like "0.6500"
        // Also accept yes_price (some endpoints still use this)
        const price = parseFloat(m.yes_bid_dollars ?? m.yes_price ?? '0');
        return price > 0.02 && price < 0.98;
      })
      .map(m => {
        // Parse price — new format is dollar string "0.6500"
        const yesProb = parseFloat(m.yes_bid_dollars ?? m.yes_price ?? '0.5');
        const askProb = parseFloat(m.yes_ask_dollars ?? m.yes_ask ?? yesProb);

        // Mid price between bid and ask for best estimate
        const midProb = (yesProb + askProb) / 2;

        return {
          ticker:   m.ticker,
          title:    m.title || m.ticker,
          subtitle: m.subtitle || null,
          yesProb:  Math.round(midProb * 10000) / 10000, // 4 decimal places
          yes_bid:  yesProb,
          yes_ask:  askProb,
          volume:   parseFloat(m.volume_fp ?? m.volume ?? 0),
          url:      `https://kalshi.com/markets/${(m.event_ticker || m.ticker).toLowerCase()}`,
          event_ticker: m.event_ticker || null,
          category: m.category || null,
        };
      })
      // Sort by volume descending
      .sort((a, b) => b.volume - a.volume);

    res.status(200).json({
      ok: true,
      markets,
      count: markets.length,
      updatedAt: new Date().toISOString(),
    });

  } catch (e) {
    console.error('Kalshi API error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
}
