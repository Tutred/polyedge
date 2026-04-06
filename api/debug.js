// api/debug.js — тестирует разные endpoints Kalshi
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
  const results = {};

  // Test 1: markets без фильтров
  try {
    const r = await fetch(`${BASE}/markets?limit=10`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    results.markets_no_filter = {
      status: r.status, count: j.markets?.length, cursor: j.cursor?.slice(0,20),
      first: j.markets?.[0] ? { ticker: j.markets[0].ticker, title: j.markets[0].title, yes_bid: j.markets[0].yes_bid_dollars, status: j.markets[0].status, mve: !!j.markets[0].mve_collection_ticker } : null
    };
  } catch(e) { results.markets_no_filter = { error: e.message }; }

  // Test 2: markets status=open (не active)
  try {
    const r = await fetch(`${BASE}/markets?limit=10&status=open`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    results.markets_status_open = {
      status: r.status, count: j.markets?.length,
      first: j.markets?.[0] ? { ticker: j.markets[0].ticker, title: j.markets[0].title, yes_bid: j.markets[0].yes_bid_dollars, status: j.markets[0].status } : null
    };
  } catch(e) { results.markets_status_open = { error: e.message }; }

  // Test 3: events endpoint
  try {
    const r = await fetch(`${BASE}/events?limit=5&status=open&with_nested_markets=true`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const first_event = j.events?.[0];
    const first_market = first_event?.markets?.[0];
    results.events = {
      status: r.status, event_count: j.events?.length,
      first_event: first_event ? { ticker: first_event.event_ticker, title: first_event.title, series: first_event.series_ticker, market_count: first_event.markets?.length } : null,
      first_market: first_market ? { ticker: first_market.ticker, yes_bid: first_market.yes_bid_dollars, yes_ask: first_market.yes_ask_dollars, last: first_market.last_price_dollars,
        url_try: `https://kalshi.com/markets/${(first_event?.series_ticker||'').toLowerCase()}/${(first_event?.event_ticker||'').toLowerCase()}`
      } : null
    };
  } catch(e) { results.events = { error: e.message }; }

  // Test 4: multivariate=exclude
  try {
    const r = await fetch(`${BASE}/markets?limit=10&multivariate_markets=exclude`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    results.markets_excl_mve = {
      status: r.status, count: j.markets?.length,
      first: j.markets?.[0] ? { ticker: j.markets[0].ticker, title: j.markets[0].title, yes_bid: j.markets[0].yes_bid_dollars } : null
    };
  } catch(e) { results.markets_excl_mve = { error: e.message }; }

  res.status(200).json({ results, ts: new Date().toISOString() });
}
