// api/history.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  const { tokenId } = req.query;
  if (!tokenId) return res.status(400).json({ ok: false, error: 'tokenId required' });

  try {
    // interval=max = full history, fidelity=60 = hourly points
    const url = `https://clob.polymarket.com/prices-history?market=${tokenId}&interval=max&fidelity=60`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`CLOB HTTP ${r.status}`);
    const j = await r.json();

    const history = (j.history || []).map(pt => ({
      t: pt.t * 1000,                        // unix ms
      p: Math.round(pt.p * 10000) / 100      // 0-100 %
    }));

    res.status(200).json({ ok: true, history });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
