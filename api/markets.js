// api/markets.js
// Uses /events endpoint to get correct event slugs for working polymarket.com URLs
// URL format: https://polymarket.com/event/{event_slug}/{market_slug}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  try {
    // Use /events endpoint — each event contains its markets
    // This gives us the event slug needed for correct URLs
    const url = 'https://gamma-api.polymarket.com/events?active=true&closed=false&limit=50&order=volume&ascending=false';
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Polymarket HTTP ${r.status}`);

    const events = await r.json();
    if (!Array.isArray(events)) throw new Error('Unexpected response format');

    const markets = [];

    for (const ev of events) {
      const eventSlug = ev.slug || '';
      const eventMarkets = ev.markets || [];

      for (const m of eventMarkets) {
        let prices = [];
        try { prices = JSON.parse(m.outcomePrices || '[]'); } catch {}
        const yesProb = parseFloat(prices[0]);
        if (!yesProb || yesProb < 0.02 || yesProb > 0.98) continue;

        let outcomes = ['Yes', 'No'];
        try { outcomes = JSON.parse(m.outcomes || '["Yes","No"]'); } catch {}

        let clobTokenId = null;
        try {
          const tokens = JSON.parse(m.clobTokenIds || '[]');
          clobTokenId = tokens[0] || null;
        } catch {}

        const marketSlug = m.slug || '';

        // Build correct Polymarket URL
        // Format: https://polymarket.com/event/{event_slug}/{market_slug}
        // If only one market in event, just use /event/{event_slug}
        let polyUrl;
        if (eventSlug && marketSlug) {
          polyUrl = `https://polymarket.com/event/${eventSlug}/${marketSlug}`;
        } else if (eventSlug) {
          polyUrl = `https://polymarket.com/event/${eventSlug}`;
        } else if (marketSlug) {
          polyUrl = `https://polymarket.com/market/${marketSlug}`;
        } else {
          polyUrl = 'https://polymarket.com';
        }

        markets.push({
          id:          m.id,
          slug:        marketSlug,
          eventSlug,
          question:    m.question || ev.title || '',
          outcomes,
          yesProb:     Math.round(yesProb * 1000) / 1000,
          volume:      parseFloat(m.volume || ev.volume || 0),
          endDate:     m.endDate || ev.endDate || null,
          createdAt:   m.createdAt || ev.createdAt || null,
          clobTokenId,
          tags:        ev.tags || [],
          url:         polyUrl,
        });
      }
    }

    // Sort by volume
    markets.sort((a, b) => b.volume - a.volume);

    res.status(200).json({ ok: true, markets });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
