// GET /api/visits  — list visits (requires x-admin-key header matching ADMIN_KEY)
// DELETE /api/visits — clear all visits (same key)
const crypto = require('crypto');
const { pipeline } = require('./_redis');

function authorised(req) {
  const expected = process.env.ADMIN_KEY || '';
  const given = req.headers['x-admin-key'] || '';
  if (!expected || expected.length < 12) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (!authorised(req)) return res.status(401).json({ error: 'unauthorised' });
  try {
    if (req.method === 'DELETE') { await pipeline([['DEL', 'visits']]); return res.status(200).json({ ok: true }); }
    if (req.method !== 'GET') return res.status(405).end();
    const [items] = await pipeline([['LRANGE', 'visits', 0, 4999]]);
    const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
    const visits = (items || []).map(s => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(v => v && v.t >= cutoff);
    return res.status(200).json({ count: visits.length, visits });
  } catch (e) {
    return res.status(e.message === 'storage-not-configured' ? 503 : 500).json({ error: e.message });
  }
};
