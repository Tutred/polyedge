// api/odds.js — The Odds API с futures (outrights)
// Это именно то что нужно для Polymarket:
// Polymarket: "Will Boston Celtics win 2026 NBA Finals?" = 13%
// The Odds API futures: "Boston Celtics to win NBA Championship" = ~15%
// ЭТИ РЫНКИ СОВМЕСТИМЫ!
//
// Ключ: ODDS_API_KEY в Vercel Environment Variables
// Регистрация: the-odds-api.com (бесплатно 500 кредитов/мес)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');

  const KEY = process.env.ODDS_API_KEY;

  // Также попробуем SharpAPI если есть
  const SHARP_KEY = process.env.SHARP_API_KEY;

  if (!KEY && !SHARP_KEY) {
    return res.status(200).json({
      ok: false, error: 'NO_KEY',
      message: 'Нужен ODDS_API_KEY (the-odds-api.com) — бесплатно 500 кредитов/мес',
      markets: [],
    });
  }

  const markets = [];

  // ── The Odds API — futures (outrights) ─────────────────────────────────────
  // Это "кто выиграет чемпионат" — прямо совпадает с Polymarket
  if (KEY) {
    const FUTURES_SPORTS = [
      'basketball_nba_championship_winner',
      'americanfootball_nfl_super_bowl_winner',
      'baseball_mlb_world_series_winner',
      'icehockey_nhl_championship_winner',
      'soccer_uefa_champs_league_winner',
      'soccer_fifa_world_cup_winner',
      'soccer_epl_winner',
      'soccer_spain_la_liga_winner',
      'soccer_germany_bundesliga_winner',
    ];

    await Promise.allSettled(FUTURES_SPORTS.map(async (sport) => {
      try {
        const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/` +
          `?apiKey=${KEY}&regions=us,uk&markets=outrights&oddsFormat=decimal`;
        const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) return;
        const games = await r.json();
        if (!Array.isArray(games)) return;

        for (const g of games) {
          // outrights — каждый исход это команда/игрок
          for (const bookie of g.bookmakers || []) {
            const outright = bookie.markets?.find(m => m.key === 'outrights');
            if (!outright) continue;

            for (const outcome of outright.outcomes || []) {
              const name  = outcome.name;
              const dec   = outcome.price;
              if (!dec || dec < 1.01) continue;
              const prob  = 1 / dec;

              const evKey = `${sport}__${norm(name)}`;
              if (!evMap[evKey]) {
                evMap[evKey] = {
                  id: evKey, sport, league: sport,
                  // title = "Boston Celtics to win NBA Championship"
                  title:     name,
                  team_name: name,
                  market_type: 'futures',
                  bookmakers: {}, probs: [],
                };
              }
              const ev = evMap[evKey];
              if (!ev.bookmakers[bookie.key]) {
                ev.bookmakers[bookie.key] = {
                  name: bookie.title, prob: Math.round(prob*10000)/10000,
                  oddsDecimal: dec, oddsAmerican: null, deepLink: null,
                };
                ev.probs.push(prob);
              }
            }
          }
        }
      } catch(e) { console.warn(`[odds] ${sport}:`, e.message); }
    }));

    // Build from evMap
    for (const ev of Object.values(evMap)) {
      if (!ev.probs.length) continue;
      const avg = ev.probs.reduce((a,b)=>a+b,0) / ev.probs.length;
      markets.push({
        id: ev.id, sport: ev.sport, league: ev.league,
        title: ev.title, team_name: ev.team_name,
        market_type: 'futures',
        yesProb: Math.round(Math.min(Math.max(avg,0.005),0.99)*10000)/10000,
        bookCount: ev.probs.length,
        bookmakers: ev.bookmakers,
        bestDecimal: Math.max(...ev.probs) > 0 ? Math.round((1/Math.max(...ev.probs))*100)/100 : null,
      });
    }
  }

  if (!markets.length && !KEY) {
    // Только SharpAPI без futures — объясняем
    return res.status(200).json({
      ok: false,
      error: 'SHARP_NO_FUTURES',
      message: 'SharpAPI не поддерживает futures. Нужен ODDS_API_KEY (the-odds-api.com) для сравнения с Polymarket.',
      markets: [],
    });
  }

  res.status(200).json({
    ok: true, markets, count: markets.length,
    updatedAt: new Date().toISOString(),
  });
}

const evMap = {};
function norm(t) {
  return (t||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
}
