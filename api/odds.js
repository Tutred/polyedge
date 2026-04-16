// api/odds.js — SharpAPI (sharpapi.io)
// Free: 12 req/min, DraftKings + FanDuel
// Hobby $79/mo: 32 sportsbooks + arbitrage
// Add SHARP_API_KEY to Vercel → Settings → Environment Variables

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  const KEY = process.env.SHARP_API_KEY;
  if (!KEY) {
    return res.status(200).json({
      ok: false, error: 'NO_KEY',
      message: 'Добавь SHARP_API_KEY в Vercel → Settings → Environment Variables',
      howto: 'sharpapi.io — бесплатно, без карты',
      markets: [],
    });
  }

  const BASE = 'https://api.sharpapi.io/api/v1';
  const HEADERS = { 'X-API-Key': KEY, 'Accept': 'application/json' };

  const LEAGUES = ['nba','nfl','mlb','nhl','ncaab','ncaaf','epl','mls','uefacl','ufc'];

  try {
    // Fetch all leagues in parallel
    const results = await Promise.all(
      LEAGUES.map(league => fetchLeague(BASE, HEADERS, league))
    );

    const rawLines = results.flat();

    // Group by event_id — collect all bookmaker lines per event
    const evMap = {};
    for (const line of rawLines) {
      if (!line) continue;
      const key = line.event_id || line.id || (line.home_team + '|' + line.away_team);
      if (!evMap[key]) {
        evMap[key] = {
          id:        key,
          sport:     line.sport    || '',
          league:    line.league   || '',
          title:     line.event_name || `${line.home_team||''} vs ${line.away_team||''}`,
          home_team: line.home_team || '',
          away_team: line.away_team || '',
          commence:  line.commence_time || line.starts_at || null,
          bookmakers: {},
          homeProbs:  [],
        };
      }
      const ev = evMap[key];
      const isHome = !line.selection || line.selection === line.home_team;
      if (!isHome) continue; // only track home team probability

      const prob = line.odds_probability != null
        ? line.odds_probability
        : line.odds_decimal > 0 ? 1 / ev.odds_decimal : null;
      if (!prob || prob < 0.01 || prob > 0.99) continue;

      const sbKey  = line.sportsbook || 'unknown';
      const sbName = line.sportsbook_name || sbKey;
      const dec    = line.odds_decimal || null;
      const amer   = line.odds_american || null;

      // Remove vig: fairProb = homeProb / (homeProb + awayProb)
      // We don't have awayProb here so just use raw prob (vig ~5% typical)
      ev.bookmakers[sbKey] = { name: sbName, prob, oddsDecimal: dec, oddsAmerican: amer,
                               deepLink: line.deep_link || null, evPct: line.ev_percent || null };
      ev.homeProbs.push(prob);
    }

    // Build final market list
    const markets = Object.values(evMap)
      .filter(ev => ev.homeProbs.length >= 1)
      .map(ev => {
        const avg = ev.homeProbs.reduce((a,b) => a+b, 0) / ev.homeProbs.length;
        const best = Math.max(...ev.homeProbs);
        return {
          id:        ev.id,
          sport:     ev.sport,
          league:    ev.league,
          title:     ev.title,
          home_team: ev.home_team,
          away_team: ev.away_team,
          commence:  ev.commence,
          yesProb:   Math.round(Math.min(Math.max(avg, 0.01), 0.99) * 10000) / 10000,
          bookCount: ev.homeProbs.length,
          bookmakers: ev.bookmakers,
          bestDecimal: best > 0 ? Math.round((1/best)*100)/100 : null,
        };
      })
      .sort((a,b) => new Date(a.commence) - new Date(b.commence));

    res.status(200).json({ ok: true, markets, count: markets.length, updatedAt: new Date().toISOString() });

  } catch(e) {
    console.error('[sharp]', e.message);
    res.status(200).json({ ok: false, error: e.message, markets: [] });
  }
}

async function fetchLeague(BASE, HEADERS, league) {
  try {
    const r = await fetch(`${BASE}/odds?league=${league}&market=moneyline&limit=100`, {
      headers: HEADERS, signal: AbortSignal.timeout(7000),
    });
    if (!r.ok) {
      if (r.status === 401) throw new Error('Неверный API ключ');
      return [];
    }
    const j = await r.json();
    return j.data || j.odds || (Array.isArray(j) ? j : []);
  } catch(e) {
    console.warn(`[sharp] ${league}:`, e.message);
    return [];
  }
}
