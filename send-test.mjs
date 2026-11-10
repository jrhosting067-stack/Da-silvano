// Sends one reviewed test order from _outbox for real.
//   node send-test.mjs              -> sends the newest _outbox order
//   node send-test.mjs <folder>     -> sends that order
// Requires SMTP_* in .env. Refuses anything not marked as a TEST ORDER.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
for (const line of (await readFile(path.join(ROOT, '.env'), 'utf8').catch(() => '')).split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) { console.error('Fill SMTP_HOST, SMTP_USER and SMTP_PASS in .env first.'); process.exit(1); }

const outbox = path.join(ROOT, '_outbox');
const folder = process.argv[2] || (await readdir(outbox)).filter(d => !d.startsWith('.')).sort().at(-1);
const { id, mails } = JSON.parse(await readFile(path.join(outbox, path.basename(folder), 'mails.json'), 'utf8'));
if (!mails.every(m => m.subject.startsWith('TEST ORDER'))) { console.error('Not a test order — refusing to send.'); process.exit(1); }

const { sendMails } = await import('./api/order.js');
console.log(`Sending ${id}:`);
mails.forEach(m => console.log(`  to ${[].concat(m.to).join(', ')} — ${m.subject}`));
const sent = await sendMails(mails, id);
sent.forEach(r => console.log(`  accepted: ${r.accepted.join(', ')}  rejected: ${r.rejected.join(', ') || 'none'}`));
