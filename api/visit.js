// POST /api/visit  — records one page visit
const { pipeline } = require('./_redis');
const KEY = 'visits';
const MAX = 5000;                      // keep at most 5,000 records
const MAX_AGE = 90 * 24 * 3600 * 1000; // and nothing older than 90 days

function parseUA(ua) {
  ua = ua || '';
  const bot = /bot\b|crawl|spider|slurp|facebookexternalhit|headless|lighthouse|curl\/|wget|python-requests/i.test(ua);
  const device = /ipad|tablet/i.test(ua) ? 'Tablet' : /mobi|iphone|android/i.test(ua) ? 'Mobile' : 'Desktop';
  const os = /windows nt/i.test(ua) ? 'Windows' : /iphone|ipad|ios/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android'
    : /mac os x/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : 'Other';
  const browser = /edg\//i.test(ua) ? 'Edge' : /opr\/|opera/i.test(ua) ? 'Opera' : /samsungbrowser/i.test(ua) ? 'Samsung Internet'
    : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Other';
  return { bot, device, os, browser };
}
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end(); }
  try {
    const h = req.headers;
    const ip = (h['x-forwarded-for'] || '').split(',')[0].trim() || h['x-real-ip'] || '';
    const ua = clip(h['user-agent'], 400);
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const rec = {
      t: Date.now(),
      ip,
      country: h['x-vercel-ip-country'] || '',
      region: h['x-vercel-ip-country-region'] || '',
      city: decodeURIComponent(h['x-vercel-ip-city'] || ''),
      ua, ...parseUA(ua),
      page: clip(body.page, 200),
      ref: clip(body.ref, 300),
      tag: clip(body.tag, 60),
      screen: clip(body.screen, 20),
      lang: clip(body.lang, 20),
      tz: clip(body.tz, 60)
    };
    const out = await pipeline([
      ['LPUSH', KEY, JSON.stringify(rec)],
      ['LTRIM', KEY, 0, MAX - 1],
      ['LINDEX', KEY, -1]
    ]);
    // gradual clean-up of records older than 90 days
    try { const oldest = JSON.parse(out[2] || 'null'); if (oldest && Date.now() - oldest.t > MAX_AGE) await pipeline([['RPOP', KEY, 20]]); } catch (e) {}
    return res.status(204).end();
  } catch (e) {
    return res.status(e.message === 'storage-not-configured' ? 503 : 500).json({ error: e.message });
  }
};
