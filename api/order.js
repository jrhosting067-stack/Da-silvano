// Kerstmenu order handler — Vercel serverless function (POST /api/order).
// Vercel: sends mail through SMTP (SMTP_HOST/PORT/USER/PASS env). Test mode is ignored in production.
// Local: test mode writes emails to ./_outbox (and sends them too when KERST_TEST_AUTOSEND=1).
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
// Read fresh on every request so config edits apply without a restart (vercel.json includes the file).
const CONFIG_URL = new URL('../kerst-config.json', import.meta.url);
const loadConfig = () => JSON.parse(readFileSync(CONFIG_URL, 'utf8'));
let CFG = loadConfig();

const TZ = 'Europe/Amsterdam';
const eur = n => '€ ' + n.toFixed(2).replace('.', ',');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const longDay = iso => new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
  .format(new Date(iso + 'T12:00:00+01:00'));

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw new Error('too large'); }
  return JSON.parse(raw || '{}');
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export function validate(b, now = new Date()) {
  const errors = {};
  const str = (k, max) => (typeof b[k] === 'string' ? b[k].trim() : '').slice(0, max);
  const order = {
    firstName: str('firstName', 60), lastName: str('lastName', 80),
    phone: str('phone', 30), email: str('email', 120), remarks: str('remarks', 1000),
    persons: Number(b.persons), pickupDay: b.pickupDay, dessert: b.dessert ?? null, addons: {}
  };
  if (CFG.soldOut) return { closed: 'Het kerstmenu is uitverkocht.' };
  if (now > new Date(CFG.deadline)) return { closed: 'Bestellen voor het kerstmenu is gesloten.' };

  if (!order.firstName) errors.firstName = 'Vul uw voornaam in';
  if (!order.lastName) errors.lastName = 'Vul uw achternaam in';
  if (order.phone.replace(/\D/g, '').length < 9) errors.phone = 'Vul een geldig telefoonnummer in';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(order.email)) errors.email = 'Vul een geldig e-mailadres in';
  if (!Number.isInteger(order.persons) || order.persons < CFG.minPersons || order.persons > CFG.maxPersons)
    errors.persons = `Te bestellen vanaf ${CFG.minPersons} personen`;
  if (!CFG.pickupDays.includes(order.pickupDay)) errors.pickup = 'Kies een ophaaldag';
  if (CFG.dessertChoice) {
    if (!CFG.desserts.some(d => d.id === order.dessert)) errors.dessert = 'Kies een dessert';
  } else order.dessert = null;

  const inAddons = b.addons && typeof b.addons === 'object' ? b.addons : {};
  for (const a of CFG.addons) {
    const q = Number(inAddons[a.id] || 0);
    if (!Number.isInteger(q) || q < 0 || q > a.max) errors.addons = 'Ongeldig aantal extra’s';
    else if (q > 0) order.addons[a.id] = q;
  }
  return { order, errors };
}

export function price(order) {
  const lines = [{ label: `Lazy Christmasplank × ${order.persons}`, amount: order.persons * CFG.pricePerPerson }];
  let pending = false;
  for (const a of CFG.addons) {
    const q = order.addons[a.id]; if (!q) continue;
    if (a.price == null) pending = true;
    lines.push({ label: `${a.name} × ${q}`, amount: a.price == null ? null : a.price * q });
  }
  const total = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  return { lines, total: Math.round(total * 100) / 100, pending };
}

function orderId() {
  return 'K26-' + Date.now().toString(36).slice(-4).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

function buildEmails(order, priced, id) {
  const name = `${order.firstName} ${order.lastName}`;
  const dessert = order.dessert ? CFG.desserts.find(d => d.id === order.dessert).name : null;
  const rows = [
    ...priced.lines.map(l => [l.label, l.amount == null ? 'prijs volgt' : eur(l.amount)]),
    ['Ophalen', `${longDay(order.pickupDay)}, ${CFG.pickupTime}`],
    ...(dessert ? [['Dessert', dessert]] : []),
  ];
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-family:Georgia,serif;font-size:15px;line-height:1.35">
    ${rows.map(([l, r]) => `<tr><td style="padding:9px 8px 9px 0;border-bottom:1px solid #e5dccb;vertical-align:top">${esc(l)}</td><td style="padding:9px 0 9px 8px;border-bottom:1px solid #e5dccb;text-align:right;vertical-align:top">${esc(r)}</td></tr>`).join('')}
    <tr><td style="padding:12px 8px 0 0"><strong>Totaal</strong></td><td style="padding:12px 0 0 8px;text-align:right;white-space:nowrap"><strong>${eur(priced.total)}</strong></td></tr></table>`;
  const pendingNote = priced.pending ? '<p style="color:#7a6a55">Extra’s zonder prijs worden bij het ophalen afgerekend.</p>' : '';
  const remarks = order.remarks ? `<p><strong>Opmerkingen:</strong><br>${esc(order.remarks).replace(/\n/g, '<br>')}</p>` : '';
  const wrap = body => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f6f1e7;padding:16px 8px;color:#1b1714;font-family:Georgia,serif">
    <div style="max-width:560px;margin:0 auto;background:#fff;padding:24px 20px;border-top:4px solid #8e1f2a;box-sizing:border-box">${body}</div></body></html>`;

  const restaurant = {
    to: CFG.orderEmail, replyTo: order.email,
    subject: `Kerstbestelling ${id} — ${name} — ${order.persons} pers. — ${longDay(order.pickupDay)}`,
    html: wrap(`<h2 style="margin-top:0">Nieuwe kerstbestelling ${esc(id)}</h2>
      <p><strong>${esc(name)}</strong><br>Tel: <a href="tel:${esc(order.phone.replace(/[^\d+]/g, ''))}" style="color:#8e1f2a">${esc(order.phone)}</a><br>E-mail: <a href="mailto:${esc(order.email)}" style="color:#8e1f2a">${esc(order.email)}</a></p>
      ${table}${pendingNote}${remarks}`),
  };
  const customer = {
    to: order.email, replyTo: CFG.orderEmail,
    subject: `Bevestiging kerstbestelling Da Silvano (${id})`,
    html: wrap(`<h2 style="margin-top:0;font-weight:normal">Grazie mille, ${esc(order.firstName)}!</h2>
      <p>Wij hebben uw bestelling voor de <strong>Lazy Christmasplank</strong> ontvangen.</p>
      ${table}${pendingNote}${remarks}
      <p>${esc(CFG.paymentNote || '')}</p>
      <p>U kunt uw bestelling ophalen op <strong>${esc(longDay(order.pickupDay))}</strong> tussen ${esc(CFG.pickupTime)} uur bij
      Da Silvano, Lange Noordstraat 26, Middelburg.</p>
      <p>Iets wijzigen? Beantwoord deze e-mail of bel ${esc(CFG.phone)}.</p>
      <p style="font-style:italic;color:#8e1f2a">Team Da Silvano wenst u fijne Kerstdagen en een gelukkig 2027</p>
      <p style="color:#7a6a55;font-size:13px">Ordernummer ${esc(id)}</p>`),
  };
  return [restaurant, customer];
}

// TEST MODE (KERST_TEST_MODE=1; never in Vercel production): every email is marked as a test and
// the restaurant copy also goes to KERST_TEST_CC. Locally the emails are saved to _outbox and only
// sent when KERST_TEST_AUTOSEND=1 (or later with send-test.mjs).
const TEST_NOTICE = `<div style="background:#fff4d6;border:1px solid #e0b84b;padding:14px 16px;margin:0 0 24px;font-family:Arial,sans-serif;font-size:14px;line-height:1.5">
  <strong>TEST ORDER</strong> — Hey, no worries, this is Jazz just testing out the system to see it works. Below is how a real order will show up.</div>`;
export function markAsTest(mails) {
  const cc = process.env.KERST_TEST_CC;
  return mails.map((m, i) => ({
    ...m,
    to: i === 0 && cc ? [m.to, cc] : m.to,
    subject: 'TEST ORDER — ' + m.subject,
    html: m.html.replace('box-sizing:border-box">', 'box-sizing:border-box">' + TEST_NOTICE),
  }));
}
const isTest = () => process.env.KERST_TEST_MODE === '1' && process.env.VERCEL_ENV !== 'production';

export async function sendMails(mails, id) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  const { default: nodemailer } = await import('nodemailer');
  // Resolve with the OS resolver (some networks time out on Node's own DNS), keep TLS checked against the real hostname.
  const { address } = await lookup(SMTP_HOST, { family: 4 });
  const t = nodemailer.createTransport({ host: address, port: Number(SMTP_PORT || 587), secure: Number(SMTP_PORT) === 465, auth: { user: SMTP_USER, pass: SMTP_PASS }, tls: { servername: SMTP_HOST } });
  const from = `"Da Silvano" <${SMTP_USER}>`;
  const sent = [await t.sendMail({ from, ...mails[0] })];   // the restaurant must get it
  try { sent.push(await t.sendMail({ from, ...mails[1] })); } // customer confirmation is best effort
  catch (e) { console.error('confirmation mail failed', id, e.message); }
  return sent;
}

async function deliver(mails, id, order) {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  const canSend = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
  const test = isTest();
  const autoSend = canSend && (!test || process.env.KERST_TEST_AUTOSEND === '1');
  if (process.env.VERCEL) {                       // no disk on Vercel: send or fail loudly
    if (!autoSend) throw new Error('SMTP not configured (or test autosend off)');
    await sendMails(mails, id);
    return test ? 'smtp-test' : 'smtp';
  }
  if (autoSend && !test) { await sendMails(mails, id); return 'smtp'; }
  if (autoSend) await sendMails(mails, id);      // local test + autosend: send, and keep a copy below
  const dir = path.join(fileURLToPath(new URL('../_outbox', import.meta.url)), `${new Date().toISOString().replace(/[:.]/g, '-')}-${id}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, '1-restaurant.html'), `<!-- To: ${mails[0].to} | Reply-To: ${mails[0].replyTo} | Subject: ${mails[0].subject} -->\n` + mails[0].html);
  await writeFile(path.join(dir, '2-klant.html'), `<!-- To: ${mails[1].to} | Reply-To: ${mails[1].replyTo} | Subject: ${mails[1].subject} -->\n` + mails[1].html);
  await writeFile(path.join(dir, 'order.json'), JSON.stringify({ id, order }, null, 2));
  await writeFile(path.join(dir, 'mails.json'), JSON.stringify({ id, mails }, null, 2));
  console.log(`[kerst] order ${id} ${autoSend ? 'SENT (test) and saved' : 'written'} to ${dir}${autoSend ? '' : ' (no mail sent)'}`);
  return autoSend ? 'smtp-test' : 'outbox';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { ok: false, message: 'Method not allowed' }); }
  let body;
  try { body = await readBody(req); } catch { return send(res, 400, { ok: false, message: 'Ongeldige aanvraag.' }); }

  // Honeypot: bots fill the hidden "website" field. Pretend success, do nothing.
  if (body.website) return send(res, 200, { ok: true, orderId: 'K26-OK', total: 0 });

  try { CFG = loadConfig(); } catch (e) { console.error('config load failed', e); }
  const { order, errors, closed } = validate(body);
  if (closed) return send(res, 409, { ok: false, message: closed });
  if (Object.keys(errors).length) return send(res, 422, { ok: false, message: 'Controleer de gemarkeerde velden.', errors });

  const priced = price(order);
  const id = orderId();
  try {
    let mails = buildEmails(order, priced, id);
    if (isTest()) mails = markAsTest(mails);
    const via = await deliver(mails, id, order);
    return send(res, 200, { ok: true, orderId: id, total: priced.total, via });
  } catch (e) {
    console.error('order delivery failed', id, e);
    return send(res, 502, { ok: false, message: 'Uw bestelling kon niet verstuurd worden.' });
  }
}
