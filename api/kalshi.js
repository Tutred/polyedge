// api/kalshi.js
// Kalshi URL format: https://kalshi.com/markets/{series_ticker_lower}/{event_ticker_lower}
// Example: KXNBAGAME series, event KXNBAGAME-26APR06NYKATL
// → https://kalshi.com/markets/kxnbagame/kxnbagame-26apr06nykatl

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');

  const BASE = 'https://api.elections.kalshi.com/trade-api/v2';

  try {
    const allMarkets = [];
    let cursor = '';
    let page = 0;

    do {
      const params = new URLSearchParams({
        limit: '1000',
        status: 'active',
        multivariate_markets: 'exclude',
      });
      if (cursor) params.set('cursor', cursor);

      const r = await fetch(`${BASE}/markets?${params}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const json = await r.json();
      allMarkets.push(...(json.markets || []));
      cursor = json.cursor || '';
      page++;
    } while (cursor && page < 5);

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

        let yesProb = (bid >= 0.02 && ask >= 0.02 && ask >= bid)
          ? (bid + ask) / 2
          : last || bid || ask;
        yesProb = Math.round(Math.min(Math.max(yesProb, 0.01), 0.99) * 10000) / 10000;

        const eventTicker  = m.event_ticker || m.ticker || '';
        const seriesTicker = m.series_ticker || eventTicker.split('-')[0] || '';

        // Correct URL: /markets/{series}/{event}
        const url = seriesTicker && eventTicker
          ? `https://kalshi.com/markets/${seriesTicker.toLowerCase()}/${eventTicker.toLowerCase()}`
          : `https://kalshi.com/markets/${eventTicker.toLowerCase()}`;

        return {
          ticker:         m.ticker,
          event_ticker:   eventTicker,
          series_ticker:  seriesTicker,
          title:          m.title || m.ticker,
          yes_sub_title:  m.yes_sub_title || null,
          no_sub_title:   m.no_sub_title  || null,
          yesProb,
          yes_bid:    bid,
          yes_ask:    ask,
          last_price: last,
          volume:     parseFloat(m.volume_fp || '0') || 0,
          url,
        };
      })
      .sort((a, b) => b.volume - a.volume);

    // Fallback to /events if got nothing
    if (markets.length === 0) {
      return await eventsApproach(res, BASE);
    }

    res.status(200).json({
      ok: true, markets,
      count: markets.length,
      total_raw: allMarkets.length,
      updatedAt: new Date().toISOString(),
    });

  } catch (e) {
    console.error('[kalshi]', e.message);
    return await eventsApproach(res, BASE).catch(() =>
      res.status(500).json({ ok: false, error: e.message, markets: [] })
    );
  }
}

async function eventsApproach(res, BASE) {
  const allMarkets = [];
  let cursor = '', page = 0;
  do {
    const params = new URLSearchParams({ limit: '200', status: 'open', with_nested_markets: 'true' });
    if (cursor) params.set('cursor', cursor);
    const r = await fetch(`${BASE}/events?${params}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`Events HTTP ${r.status}`);
    const json = await r.json();
    for (const ev of json.events || []) {
      for (const m of ev.markets || []) {
        const bid  = parseFloat(m.yes_bid_dollars  || '0');
        const ask  = parseFloat(m.yes_ask_dollars  || '0');
        const last = parseFloat(m.last_price_dollars || '0');
        if (Math.max(bid, ask, last) < 0.02) continue;
        let yesProb = (bid>=0.02&&ask>=0.02) ? (bid+ask)/2 : last||bid||ask;
        yesProb = Math.round(Math.min(Math.max(yesProb,0.01),0.99)*10000)/10000;
        const et = m.event_ticker || ev.event_ticker || '';
        const st = ev.series_ticker || et.split('-')[0] || '';
        allMarkets.push({
          ticker: m.ticker, event_ticker: et, series_ticker: st,
          title: m.title || ev.title || m.ticker,
          yes_sub_title: m.yes_sub_title||null, no_sub_title: m.no_sub_title||null,
          yesProb, yes_bid: bid, yes_ask: ask, last_price: last,
          volume: parseFloat(m.volume_fp||'0')||0,
          url: st && et
            ? `https://kalshi.com/markets/${st.toLowerCase()}/${et.toLowerCase()}`
            : `https://kalshi.com/markets/${et.toLowerCase()}`,
        });
      }
    }
    cursor = json.cursor || ''; page++;
  } while (cursor && page < 10);

  allMarkets.sort((a,b) => b.volume - a.volume);
  res.status(200).json({ ok:true, markets:allMarkets, count:allMarkets.length, source:'events', updatedAt:new Date().toISOString() });
}
