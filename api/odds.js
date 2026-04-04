// api/odds.js — Vercel Serverless Function
// Proxies The Odds API to keep API key secret on server side

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ 
      available: false, 
      message: 'ODDS_API_KEY not configured' 
    });
  }

  try {
    const sport = req.query.sport || 'politics';
    const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${apiKey}&regions=eu,uk,us&markets=h2h&oddsFormat=decimal`;
    const resp = await fetch(url);
    
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Odds API error ${resp.status}: ${txt}`);
    }

    const data = await resp.json();
    const remaining = resp.headers.get('x-requests-remaining');
    
    res.status(200).json({ 
      available: true,
      data,
      requestsRemaining: remaining,
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ available: false, error: e.message });
  }
}
