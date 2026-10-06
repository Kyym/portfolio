// Sends instant alerts for new visitors and high-intent clicks.
// Email via Resend (RESEND_API_KEY + NOTIFY_EMAIL), WhatsApp via CallMeBot (CALLMEBOT_PHONE + CALLMEBOT_APIKEY).
// Optional: IGNORE_IPS="1.2.3.4,5.6.7.8" to skip your own visits.
const { pipeline } = require('./_redis');
const SITE = 'https://kevin-codes.vercel.app';

function withTimeout(p, ms) { return Promise.race([p, new Promise(r => setTimeout(r, ms))]); }

function isHighIntent(rec) {
  if (rec.type !== 'click') return false;
  const s = ((rec.label || '') + ' ' + (rec.href || '')).toLowerCase();
  return /\.pdf|download cv|cv \(pdf\)|contact form submitted|linkedin|whatsapp|wa\.me|mailto:|github/.test(s);
}

function host(r) { try { return r ? new URL(r).hostname.replace(/^www\./, '') : 'Direct'; } catch (e) { return r || 'Direct'; } }

function summary(rec) {
  const where = [rec.city, rec.country].filter(Boolean).join(', ') || 'Unknown location';
  const who = `${rec.device} · ${rec.browser} on ${rec.os}`;
  const lines = rec.type === 'view'
    ? ['New portfolio visitor', `From: ${host(rec.ref)}${rec.tag ? ' (tag: ' + rec.tag + ')' : ''}`]
    : [`Visitor clicked "${rec.label || rec.href}"`, rec.href ? `Link: ${rec.href}` : ''];
  return lines.concat([`Location: ${where}`, `IP: ${rec.ip}`, `Device: ${who}`,
    `Time: ${new Date(rec.t).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' })} EAT`, `Logs: ${SITE}/logs.html`]).filter(Boolean);
}

async function sendEmail(lines) {
  const key = process.env.RESEND_API_KEY, to = process.env.NOTIFY_EMAIL;
  if (!key || !to) return;
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.NOTIFY_FROM || 'Portfolio Alerts <onboarding@resend.dev>',
      to: [to],
      subject: '🔔 ' + lines[0],
      html: '<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;line-height:1.6">' +
        '<h2 style="margin:0 0 8px;color:#149ddd">' + esc(lines[0]) + '</h2>' +
        lines.slice(1).map(l => '<div>' + esc(l).replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>') + '</div>').join('') + '</div>'
    })
  });
}

async function sendWhatsApp(lines) {
  const phone = process.env.CALLMEBOT_PHONE, key = process.env.CALLMEBOT_APIKEY;
  if (!phone || !key) return;
  const text = '🔔 *' + lines[0] + '*\n' + lines.slice(1).join('\n');
  await fetch('https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(phone) +
    '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(key));
}

module.exports = async function notify(rec) {
  try {
    if (rec.bot) return;
    const ignore = (process.env.IGNORE_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (rec.ip && ignore.includes(rec.ip)) return;
    if (!(rec.type === 'view' || isHighIntent(rec))) return;
    // at most 4 alerts per visitor session, and never the same click twice
    const sk = 'notif:' + (rec.sid || rec.ip);
    const dk = 'notifd:' + (rec.sid || rec.ip) + ':' + (rec.type === 'view' ? 'view' : (rec.label + '|' + rec.href)).slice(0, 150);
    const [count, fresh] = await pipeline([['INCR', sk], ['SET', dk, '1', 'NX', 'EX', 86400], ['EXPIRE', sk, 86400]]);
    if (count > 4 || fresh !== 'OK') return;
    const lines = summary(rec);
    await withTimeout(Promise.allSettled([sendEmail(lines), sendWhatsApp(lines)]), 4500);
  } catch (e) { /* never break logging because of alerts */ }
};
