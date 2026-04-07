// api/odds.js
// The Odds API — bookmaker odds for events
// Free tier: 500 requests/month at https://the-odds-api.com
// Add ODDS_API_KEY to Vercel environment variables

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  const key = process.env.ODDS_API_KEY;
  if (!key) {
    return res.status(200).json({
      ok: false,
      error: 'ODDS_API_KEY not set',
      markets: [],
      hint: 'Get free key at https://the-odds-api.com and add to Vercel Environment Variables'
    });
  }

  try {
    // Fetch all available sports first, then get odds for key sports
    const sports = ['americanfootball_nfl','basketball_nba','icehockey_nhl',
                    'baseball_mlb','soccer_epl','soccer_spain_la_liga',
                    'tennis_atp_french_open','mma_mixed_martial_arts'];

    const results = [];
    for (const sport of sports) {
      try {
        const r = await fetch(
          `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${key}&regions=us&markets=h2h&oddsFormat=decimal&dateFormat=iso`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (!r.ok) continue;
        const games = await r.json();
        for (const g of games) {
          // Get consensus probability from all bookmakers
          const bookProbs = [];
          for (const bookie of g.bookmakers || []) {
            const h2h = bookie.markets?.find(m => m.key === 'h2h');
            if (!h2h) continue;
            // Find home team outcome
            const home = h2h.outcomes?.find(o => o.name === g.home_team);
            if (home?.price) bookProbs.push(1 / home.price);
          }
          if (!bookProbs.length) continue;
          const avgProb = bookProbs.reduce((a,b) => a+b, 0) / bookProbs.length;
          results.push({
            id:          g.id,
            sport:       sport,
            title:       `${g.home_team} vs ${g.away_team}`,
            home_team:   g.home_team,
            away_team:   g.away_team,
            commence:    g.commence_time,
            yesProb:     Math.round(avgProb * 10000) / 10000, // home team wins
            bookCount:   bookProbs.length,
            bookmakers:  (g.bookmakers || []).map(b => ({
              name: b.title,
              prob: (() => {
                const h2h = b.markets?.find(m => m.key === 'h2h');
                const home = h2h?.outcomes?.find(o => o.name === g.home_team);
                return home?.price ? Math.round((1/home.price)*10000)/10000 : null;
              })()
            })).filter(b => b.prob != null)
          });
        }
      } catch(e) { /* skip sport */ }
    }

    res.status(200).json({
      ok: true,
      markets: results,
      count: results.length,
      updatedAt: new Date().toISOString()
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message, markets: [] });
  }
}
