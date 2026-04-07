// api/markets.js
// Returns both individual markets AND grouped events for multi-candidate matching

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  try {
    const url = 'https://gamma-api.polymarket.com/events?active=true&closed=false&limit=50&order=volume&ascending=false';
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Polymarket HTTP ${r.status}`);
    const rawEvents = await r.json();
    if (!Array.isArray(rawEvents)) throw new Error('Unexpected format');

    const markets = [];

    for (const ev of rawEvents) {
      const eventSlug   = ev.slug || '';
      const eventTitle  = ev.title || '';
      const eventVol    = parseFloat(ev.volume || 0);
      const eventMarkets = ev.markets || [];

      for (const m of eventMarkets) {
        let prices = [];
        try { prices = JSON.parse(m.outcomePrices || '[]'); } catch {}
        const yesProb = parseFloat(prices[0]);
        if (!yesProb || yesProb < 0.02 || yesProb > 0.98) continue;

        let outcomes = ['Yes','No'];
        try { outcomes = JSON.parse(m.outcomes || '["Yes","No"]'); } catch {}

        let clobTokenId = null;
        try { const t=JSON.parse(m.clobTokenIds||'[]'); clobTokenId=t[0]||null; } catch {}

        const marketSlug = m.slug || '';
        let polyUrl = eventSlug && marketSlug
          ? `https://polymarket.com/event/${eventSlug}/${marketSlug}`
          : eventSlug ? `https://polymarket.com/event/${eventSlug}`
          : `https://polymarket.com/market/${marketSlug}`;

        markets.push({
          id:          m.id,
          slug:        marketSlug,
          eventSlug,
          eventTitle,         // ← NEW: parent event title e.g. "2028 Democratic Presidential Nominee"
          eventUrl:    `https://polymarket.com/event/${eventSlug}`,
          question:    m.question || eventTitle || '',
          outcomes,
          yesProb:     Math.round(yesProb * 1000) / 1000,
          volume:      parseFloat(m.volume || 0),
          eventVolume: eventVol,  // ← NEW: total event volume
          endDate:     m.endDate || ev.endDate || null,
          createdAt:   m.createdAt || ev.createdAt || null,
          clobTokenId,
          tags:        ev.tags || [],
          url:         polyUrl,
        });
      }
    }

    markets.sort((a, b) => b.volume - a.volume);
    res.status(200).json({ ok: true, markets });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
