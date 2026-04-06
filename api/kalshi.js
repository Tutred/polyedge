// api/kalshi.js
// Kalshi public market data — no auth required
// KEY FIX: use multivariate_markets=exclude to skip combo markets
// Docs: https://docs.kalshi.com/api-reference/market/get-markets

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');

  const BASE = 'https://api.elections.kalshi.com/trade-api/v2';

  try {
    const allMarkets = [];
    let cursor = '';
    let page = 0;

    do {
      // multivariate_markets=exclude — официальный параметр для исключения комбо-маркетов
      const params = new URLSearchParams({
        limit: '1000',
        status: 'active',
        multivariate_markets: 'exclude',  // <-- ключевой фикс
      });
      if (cursor) params.set('cursor', cursor);

      const r = await fetch(`${BASE}/markets?${params}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(12000),
      });

      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const json = await r.json();
      const batch = json.markets || [];
      allMarkets.push(...batch);
      cursor = json.cursor || '';
      page++;

    } while (cursor && page < 5);

    // Map to our format
    const markets = allMarkets
      .filter(m => {
        const bid  = parseFloat(m.yes_bid_dollars  || '0');
        const ask  = parseFloat(m.yes_ask_dollars  || '0');
        const last = parseFloat(m.last_price_dollars || '0');
        return Math.max(bid, ask, last) >= 0.02;
      })
      .map(m => {
        const bid  = parseFloat(m.yes_bid_dollars   || '0') || 0;
        const ask  = parseFloat(m.yes_ask_dollars   || '0') || 0;
        const last = parseFloat(m.last_price_dollars || '0') || 0;

        let yesProb;
        if (bid >= 0.02 && ask >= 0.02 && ask >= bid) yesProb = (bid + ask) / 2;
        else if (last >= 0.02) yesProb = last;
        else yesProb = Math.max(bid, ask);

        yesProb = Math.round(Math.min(Math.max(yesProb, 0.01), 0.99) * 10000) / 10000;

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
          volume:     parseFloat(m.volume_fp || '0') || 0,
          status:     m.status || null,
          close_time: m.close_time || null,
          url: `https://kalshi.com/markets/${(m.event_ticker || m.ticker).toLowerCase()}`,
        };
      })
      .sort((a, b) => b.volume - a.volume);

    // If still got nothing, try /events endpoint as fallback
    if (markets.length === 0) {
      return await eventsApproach(req, res, BASE);
    }

    res.status(200).json({
      ok: true, markets,
      count: markets.length,
      total_raw: allMarkets.length,
      pages_fetched: page,
      updatedAt: new Date().toISOString(),
    });

  } catch (e) {
    console.error('[kalshi] Error:', e.message);
    // Try events endpoint as last resort
    return await eventsApproach(req, res, BASE).catch(() => {
      res.status(500).json({ ok: false, error: e.message, markets: [] });
    });
  }
}

// Fallback: use /events?with_nested_markets=true
// /events automatically excludes multivariate events
async function eventsApproach(req, res, BASE) {
  const allMarkets = [];
  let cursor = '';
  let page = 0;

  do {
    const params = new URLSearchParams({
      limit: '200',
      status: 'open',
      with_nested_markets: 'true',
    });
    if (cursor) params.set('cursor', cursor);

    const r = await fetch(`${BASE}/events?${params}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000),
    });

    if (!r.ok) throw new Error(`Events HTTP ${r.status}`);

    const json = await r.json();
    const events = json.events || [];

    for (const ev of events) {
      const nested = ev.markets || [];
      for (const m of nested) {
        const bid  = parseFloat(m.yes_bid_dollars  || '0');
        const ask  = parseFloat(m.yes_ask_dollars  || '0');
        const last = parseFloat(m.last_price_dollars || '0');
        if (Math.max(bid, ask, last) < 0.02) continue;

        let yesProb = (bid>=0.02&&ask>=0.02) ? (bid+ask)/2 : last||bid||ask;
        yesProb = Math.round(Math.min(Math.max(yesProb,0.01),0.99)*10000)/10000;

        allMarkets.push({
          ticker:        m.ticker,
          event_ticker:  m.event_ticker || ev.event_ticker,
          title:         m.title || ev.title || m.ticker,
          yes_sub_title: m.yes_sub_title || null,
          no_sub_title:  m.no_sub_title  || null,
          yesProb,
          yes_bid:    bid, yes_ask: ask, last_price: last,
          volume:     parseFloat(m.volume_fp || '0') || 0,
          status:     m.status || null,
          close_time: m.close_time || null,
          url: `https://kalshi.com/markets/${(m.event_ticker||ev.event_ticker||m.ticker).toLowerCase()}`,
        });
      }
    }

    cursor = json.cursor || '';
    page++;
  } while (cursor && page < 10);

  allMarkets.sort((a,b) => b.volume - a.volume);

  res.status(200).json({
    ok: true,
    markets: allMarkets,
    count: allMarkets.length,
    total_raw: allMarkets.length,
    source: 'events_api',
    pages_fetched: page,
    updatedAt: new Date().toISOString(),
  });
}
