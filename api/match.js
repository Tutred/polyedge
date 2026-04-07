// api/match.js
// Семантический матчинг Polymarket ↔ Kalshi через DeepSeek
// Нужен DEEPSEEK_API_KEY в Vercel Environment Variables
// Бесплатный tier: https://platform.deepseek.com

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

  const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
  if (!DEEPSEEK_KEY) {
    return res.status(200).json({
      ok: false,
      error: 'DEEPSEEK_API_KEY not set',
      matches: [],
      hint: 'Get free key at https://platform.deepseek.com'
    });
  }

  const { polyMarkets, kalshiMarkets } = req.body || {};
  if (!polyMarkets?.length || !kalshiMarkets?.length) {
    return res.status(400).json({ ok: false, error: 'polyMarkets and kalshiMarkets required in body' });
  }

  try {
    // ── Шаг 1: быстрый пре-фильтр по словам ──────────────────────────────────
    const STOP = new Set(['will','the','a','an','in','on','at','to','of','for',
      'be','is','are','was','by','or','and','that','this','with','have','not',
      'its','per','win','wins','most','next','more','than','over','under']);

    function kws(t) {
      return (t||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ')
        .split(' ').filter(w => w.length > 3 && !STOP.has(w));
    }

    // Пре-фильтр: хотя бы 1 общее слово
    const candidates = [];
    for (const pm of polyMarkets) {
      const pk = new Set(kws(pm.question));
      for (const km of kalshiMarkets) {
        const kk = kws(km.title);
        const hits = kk.filter(w => pk.has(w));
        if (hits.length >= 1) {
          candidates.push({ pm, km, hits: hits.length });
        }
      }
    }

    // Сортируем по количеству совпадений, берём топ 60
    candidates.sort((a,b) => b.hits - a.hits);
    const top = candidates.slice(0, 60);

    if (top.length === 0) {
      return res.status(200).json({ ok: true, matches: [], candidates_checked: 0 });
    }

    // ── Шаг 2: батчевый анализ через DeepSeek ─────────────────────────────────
    const BATCH = 8; // 8 пар за раз — баланс скорость/точность
    const allMatches = [];

    for (let i = 0; i < top.length; i += BATCH) {
      const batch = top.slice(i, i + BATCH);

      const pairsText = batch.map((p, idx) => `
PAIR ${idx}:
[Polymarket] "${p.pm.question}"
  YES="${p.pm.outcomes?.[0]||'Yes'}" price=${Math.round((p.pm.yesProb||0.5)*100)}%
  NO="${p.pm.outcomes?.[1]||'No'}" price=${Math.round((1-(p.pm.yesProb||0.5))*100)}%

[Kalshi] "${p.km.title}"
  YES="${p.km.yes_sub_title||'Yes'}" price=${Math.round((p.km.yesProb||0.5)*100)}%
  NO="${p.km.no_sub_title||'No'}" price=${Math.round((1-(p.km.yesProb||0.5))*100)}%`
      ).join('\n');

      const prompt = `You are a prediction market arbitrage expert. Analyze these ${batch.length} event pairs.

${pairsText}

For each pair determine:
1. Do both events resolve on the SAME real-world fact with COMPATIBLE resolution rules?
2. Are the YES outcomes referring to the same outcome? (e.g. both "Team A wins")
3. Is there arbitrage: buy YES on one + NO on other, total cost < 100¢?

IMPORTANT rules for rejection:
- Reject if one is a numeric threshold ("Above 120 seats") and other is binary ("wins election")
- Reject if close dates differ by more than 5 days  
- Reject if prices differ by more than 30pp (likely different events)
- Reject if resolution criteria are materially different

Respond ONLY with JSON array (no markdown):
[{"i":0,"match":true,"confidence":90,"same_yes":true,"conflict":null,"summary":"same NBA game"},...]

Fields: i=pair_index, match=bool, confidence=0-100, same_yes=bool (YES outcomes are same real outcome), conflict=null or short reason string, summary=one sentence`;

      try {
        const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_KEY}`,
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            temperature: 0,
            max_tokens: 1500,
            messages: [
              { role: 'system', content: 'You are a JSON-only arbitrage analysis engine. Respond only with a valid JSON array, no markdown, no explanation.' },
              { role: 'user', content: prompt }
            ]
          }),
          signal: AbortSignal.timeout(20000),
        });

        if (!r.ok) {
          console.error('DeepSeek error:', r.status);
          continue;
        }

        const data = await r.json();
        const raw = data.choices?.[0]?.message?.content || '[]';

        let results;
        try {
          // Clean up response — remove markdown if present
          const clean = raw.replace(/```json|```/g, '').trim();
          results = JSON.parse(clean);
          if (!Array.isArray(results)) results = [];
        } catch(e) {
          console.error('Parse error:', raw.slice(0, 200));
          continue;
        }

        for (const r of results) {
          if (!r.match || r.confidence < 70 || r.conflict) continue;

          const pair = batch[r.i];
          if (!pair) continue;

          const pm = pair.pm;
          const km = pair.km;
          const py = pm.yesProb || 0.5;
          const ky = km.yesProb || 0.5;
          const pn = 1 - py;
          const kn = 1 - ky;

          // Calculate best arb strategy
          // If same_yes: Poly YES and Kalshi YES are same real outcome
          // Arb A: buy Poly YES (py) + Kalshi NO (kn) → cost = py + kn
          // Arb B: buy Poly NO (pn) + Kalshi YES (ky) → cost = pn + ky
          const costA = py + kn;
          const costB = pn + ky;
          const bestCost = Math.min(costA, costB);
          const useA = costA <= costB;

          let arbType = null;
          if (bestCost < 0.985) {
            const roi = ((1 - bestCost) / bestCost) * 100;
            if (roi >= 0.5 && roi <= 20) {
              arbType = {
                type: 'arb',
                cost: bestCost,
                profit: 1 - bestCost,
                roi,
                polyBuy:     useA ? 'YES' : 'NO',
                kalBuy:      useA ? 'NO'  : 'YES',
                polyPrice:   useA ? py : pn,
                kalPrice:    useA ? kn : ky,
                polyOutcome: useA ? (pm.outcomes?.[0]||'Yes') : (pm.outcomes?.[1]||'No'),
                kalOutcome:  useA ? (km.no_sub_title||pm.outcomes?.[1]||'No') : (km.yes_sub_title||pm.outcomes?.[0]||'Yes'),
              };
            }
          }

          const diff = Math.abs(py - ky);
          const diffType = !arbType && diff >= 0.03 ? {
            type: 'diff', diff,
            higher: py > ky ? 'Polymarket' : 'Kalshi',
            lower:  py > ky ? 'Kalshi' : 'Polymarket',
          } : null;

          allMatches.push({
            polyId:    pm.id,
            kalshiTicker: km.ticker,
            confidence: r.confidence,
            same_yes:  r.same_yes,
            summary:   r.summary,
            arb:       arbType || diffType,
          });
        }
      } catch(e) {
        console.error('Batch failed:', e.message);
      }

      // Small delay between batches
      if (i + BATCH < top.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    res.status(200).json({
      ok: true,
      matches: allMatches,
      candidates_checked: top.length,
      pairs_total: candidates.length,
      updatedAt: new Date().toISOString(),
    });

  } catch(e) {
    console.error('[match] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message, matches: [] });
  }
}
