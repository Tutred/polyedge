// api/markets.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  try {
    const r = await fetch(
      'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=50&order=volume&ascending=false',
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) throw new Error(`Polymarket HTTP ${r.status}`);
    const raw = await r.json();

    const markets = raw
      .filter(m => {
        try {
          const p = JSON.parse(m.outcomePrices || '[]');
          const v = parseFloat(p[0]);
          return p.length === 2 && v > 0.02 && v < 0.98;
        } catch { return false; }
      })
      .map(m => {
        let prices = [];
        try { prices = JSON.parse(m.outcomePrices); } catch {}
        const yesProb = parseFloat(prices[0]) || 0.5;

        // clobTokenId needed for price history
        let clobTokenId = null;
        try {
          const tokens = JSON.parse(m.clobTokenIds || '[]');
          if (tokens.length > 0) clobTokenId = tokens[0];
        } catch {}

        // outcome labels (e.g. ["Yes","No"] or ["Above 30°C","Below 30°C"])
        let outcomes = ['Yes', 'No'];
        try { outcomes = JSON.parse(m.outcomes || '["Yes","No"]'); } catch {}

        return {
          id: m.id,
          slug: m.slug || '',
          question: m.question || '',
          outcomes,
          yesProb: Math.round(yesProb * 1000) / 1000,
          volume: parseFloat(m.volume) || 0,
          endDate: m.endDate || null,
          createdAt: m.createdAt || null,
          clobTokenId,
          tags: m.tags || [],
        };
      });

    res.status(200).json({ ok: true, markets });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
