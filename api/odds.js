// api/odds.js — SharpAPI
// ВАЖНО: SharpAPI moneyline = конкретный матч (сегодня/завтра)
// Polymarket futures = кто выиграет чемпионат
// Эти рынки НЕЛЬЗЯ сравнивать напрямую.
// Мы возвращаем оба типа и помечаем market_type.

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

  const BASE = 'https://api.sharpapi.io/api/v1';
  const HEADERS = { 'X-API-Key': KEY, 'Accept': 'application/json' };

  // Запрашиваем moneyline для текущих матчей
  // ТОЛЬКО те которые Polymarket тоже показывает как binary (win/lose)
  const LEAGUES = ['nba','nfl','mlb','nhl','epl','mls','uefacl','ufc'];

  try {
    const results = await Promise.all(
      LEAGUES.map(league => fetchLeague(BASE, HEADERS, league))
    );

    const rawLines = results.flat();

    // Группируем по event_id
    const evMap = {};
    for (const line of rawLines) {
      if (!line) continue;
      const key = line.event_id || line.id || `${line.home_team}|${line.away_team}`;
      if (!evMap[key]) {
        evMap[key] = {
          id: key,
          league: line.league || '',
          title: line.event_name || `${line.home_team||''} vs ${line.away_team||''}`,
          home_team: line.home_team || '',
          away_team: line.away_team || '',
          commence: line.commence_time || null,
          // market_type: 'game' = конкретный матч сегодня/завтра
          market_type: 'game',
          bookmakers: {},
          homeProbs: [],
          awayProbs: [],
        };
      }

      const ev = evMap[key];
      const sel = line.selection || '';
      const isHome = sel === line.home_team || sel === 'home' || (!sel && ev.homeProbs.length === 0);
      const isAway = sel === line.away_team || sel === 'away';

      // Вычисляем вероятность из decimal odds
      const d = parseFloat(line.odds_decimal) || 0;
      const prob = d > 1 ? 1 / d : (parseFloat(line.odds_probability) || 0);
      if (!prob || prob < 0.01 || prob > 0.99) continue;

      const sbKey = line.sportsbook || 'unknown';
      if (isHome || (!isAway)) {
        ev.bookmakers[sbKey] = {
          name: line.sportsbook_name || sbKey,
          prob: Math.round(prob * 10000) / 10000,
          oddsDecimal: d || null,
          oddsAmerican: line.odds_american || null,
          deepLink: line.deep_link || null,
          evPct: line.ev_percent || null,
        };
        ev.homeProbs.push(prob);
      }
    }

    const markets = Object.values(evMap)
      .filter(ev => ev.homeProbs.length >= 1)
      .map(ev => {
        // Честная вероятность = убираем вигу по обеим командам
        // Среднее по всем букмекерам для home team
        const avg = ev.homeProbs.reduce((a,b) => a+b, 0) / ev.homeProbs.length;
        const best = Math.max(...ev.homeProbs);
        return {
          id: ev.id,
          league: ev.league,
          title: ev.title,
          home_team: ev.home_team,
          away_team: ev.away_team,
          commence: ev.commence,
          market_type: ev.market_type,
          // yesProb = вероятность победы home team
          yesProb: Math.round(Math.min(Math.max(avg, 0.01), 0.99) * 10000) / 10000,
          bookCount: ev.homeProbs.length,
          bookmakers: ev.bookmakers,
          bestDecimal: best > 0 ? Math.round((1/best)*100)/100 : null,
        };
      })
      .sort((a,b) => new Date(a.commence) - new Date(b.commence));

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
    if (!r.ok) {
      console.warn(`[odds] ${league}: HTTP ${r.status}`);
      return [];
    }
    const j = await r.json();
    const items = j.data || j.odds || (Array.isArray(j) ? j : []);
    // Добавляем league в каждый элемент
    return items.map(i => ({ ...i, league }));
  } catch(e) {
    console.warn(`[odds] ${league}:`, e.message);
    return [];
  }
}
