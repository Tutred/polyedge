// api/odds.js — SharpAPI
// Данные: конкретные матчи NBA/MLB/NHL/UFC сегодня и ближайшие дни
// Хорошо матчится с Polymarket вопросами типа:
// "Will Ilia Topuria beat Justin Gaethje?" или "Will LA Lakers beat Houston Rockets?"

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  const KEY = process.env.SHARP_API_KEY;
  if (!KEY) {
    return res.status(200).json({
      ok: false, error: 'NO_KEY',
      message: 'Добавь SHARP_API_KEY в Vercel → Settings → Environment Variables',
      markets: [],
    });
  }

  const BASE    = 'https://api.sharpapi.io/api/v1';
  const HEADERS = { 'X-API-Key': KEY, 'Accept': 'application/json' };
  const LEAGUES = ['nba','nfl','mlb','nhl','epl','mls','uefacl','ufc'];

  try {
    const results = await Promise.all(
      LEAGUES.map(lg => fetchLeague(BASE, HEADERS, lg))
    );
    const rawLines = results.flat();

    // Группируем по паре команд + дата (убираем дубли от разных букмекеров)
    const evMap = {};
    for (const line of rawLines) {
      if (!line?.home_team || !line?.away_team) continue;

      // Ключ = "home_away_date" — объединяет дубли
      const dateKey = (line.commence_time || line.id || '').slice(0, 10);
      const homeKey = norm(line.home_team).replace(/\s+/g, '_');
      const awayKey = norm(line.away_team).replace(/\s+/g, '_');
      const key     = `${homeKey}_${awayKey}_${dateKey}`;

      if (!evMap[key]) {
        evMap[key] = {
          id:        key,
          league:    line.league || '',
          title:     line.event_name || `${line.home_team} vs ${line.away_team}`,
          home_team: line.home_team,
          away_team: line.away_team,
          commence:  line.commence_time || null,
          market_type: 'game',
          bookmakers: {},
          probs: [],
        };
      }
      const ev = evMap[key];

      // Определяем: это odds на home team или away team?
      const sel = (line.selection || '').toLowerCase();
      const homeN = norm(line.home_team);
      const isHome = sel === homeN || sel === 'home' || sel === '' ||
                     (!sel && !line.selection);

      if (!isHome) continue; // берём только home team вероятность

      const d    = parseFloat(line.odds_decimal) || 0;
      const prob = d > 1 ? (1/d) : (parseFloat(line.odds_probability) || 0);
      if (!prob || prob < 0.02 || prob > 0.98) continue;

      const sbKey = line.sportsbook || 'unknown';
      if (!ev.bookmakers[sbKey]) {
        ev.bookmakers[sbKey] = {
          name:         line.sportsbook_name || sbKey,
          prob:         Math.round(prob * 10000) / 10000,
          oddsDecimal:  d || null,
          oddsAmerican: line.odds_american || null,
          deepLink:     line.deep_link || null,
          evPct:        line.ev_percent || null,
        };
        ev.probs.push(prob);
      }
    }

    const markets = Object.values(evMap)
      .filter(ev => ev.probs.length >= 1)
      .map(ev => {
        const avg  = ev.probs.reduce((a,b) => a+b, 0) / ev.probs.length;
        const best = Math.max(...ev.probs);
        return {
          id:          ev.id,
          league:      ev.league,
          title:       ev.title,
          home_team:   ev.home_team,
          away_team:   ev.away_team,
          commence:    ev.commence,
          market_type: ev.market_type,
          yesProb:     Math.round(Math.min(Math.max(avg,0.02),0.98) * 10000) / 10000,
          bookCount:   ev.probs.length,
          bookmakers:  ev.bookmakers,
          bestDecimal: best > 0 ? Math.round((1/best)*100)/100 : null,
        };
      })
      .sort((a,b) => (a.commence||'').localeCompare(b.commence||''));

    res.status(200).json({
      ok: true, markets, count: markets.length,
      updatedAt: new Date().toISOString(),
    });

  } catch(e) {
    console.error('[odds]', e.message);
    res.status(200).json({ ok: false, error: e.message, markets: [] });
  }
}

async function fetchLeague(BASE, HEADERS, league) {
  try {
    const r = await fetch(
      `${BASE}/odds?league=${league}&market=moneyline&limit=100`,
      { headers: HEADERS, signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) { console.warn(`[odds] ${league}: ${r.status}`); return []; }
    const j = await r.json();
    const items = j.data || j.odds || (Array.isArray(j) ? j : []);
    return items.map(i => ({ ...i, league }));
  } catch(e) {
    console.warn(`[odds] ${league}:`, e.message);
    return [];
  }
}

function norm(t) {
  return (t||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
}
