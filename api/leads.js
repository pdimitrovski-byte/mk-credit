// /api/leads.js — Vercel serverless (Node.js)  → праќа e-mail со CSV
const nodemailer = require("nodemailer");

function withCors(res){
  const origin = process.env.ALLOW_CORS_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}
function normalizeBody(req){ if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; } }
function toCsv(obj){
  const cols=["full_name","first_name","last_name","phone_e164",
  "requested_amount_mkd","target_installment_mkd","partner","partner_id","partner_email",
  "consent","consent_timestamp","source","received_at"];
  const esc=v=>v==null?"":/[",\n]/.test(String(v))?`"${String(v).replace(/"/g,'""')}"`:String(v);
  const values=cols.map(k=>esc(k==="received_at"?new Date().toISOString():obj[k]));
  return cols.join(",")+"\n"+values.join(",")+"\n";
}
function subjectFrom(lead){
  const who = lead.full_name || `${lead.first_name||""} ${lead.last_name||""}`.trim() || "Lead";
  const partner = lead.partner || lead.partner_id || "(no partner)";
  return `Ново барање за кредит — ${who} — ${partner}`;
}
function htmlSummary(lead){ const f=k=>lead[k]??""; return `
  <h2>Ново барање за потрошувачки кредит</h2>
  <ul>
    <li><b>Име и презиме:</b> ${f('full_name') || (f('first_name')+" "+f('last_name')).trim()}</li>
    <li><b>Телефон:</b> ${f('phone_e164')}</li>
    <li><b>Износ (МКД):</b> ${f('requested_amount_mkd')}</li>
    <li><b>Посакувана рата (МКД):</b> ${f('target_installment_mkd')}</li>
    <li><b>Партнер:</b> ${f('partner') || f('partner_id') || '(n/a)'} ${f('partner_email')?`&lt;${f('partner_email')}&gt;`:''}</li>
    <li><b>Извор:</b> ${f('source') || 'landing'}</li>
    <li><b>Согласност:</b> ${String(f('consent'))} — ${f('consent_timestamp') || ''}</li>
  </ul>
  <p>Во прилог има CSV со истите податоци.</p>`; }

async function sendMail(lead){
  const { SMTP_HOST, SMTP_PORT="587", SMTP_USER, SMTP_PASS, SMTP_SECURE, TO_EMAIL, FROM_EMAIL, CC_PARTNER } = process.env;
  if(!SMTP_HOST || !SMTP_USER || !SMTP_PASS) throw new Error("SMTP credentials missing. Set SMTP_HOST, SMTP_USER, SMTP_PASS.");
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT)===465 || String(SMTP_SECURE).toLowerCase()==='true',
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  const to = lead.partner_email || TO_EMAIL || "ideamkkredit@yahoo.com";
  const csv = toCsv(lead);
  const mail = await transporter.sendMail({
    from: FROM_EMAIL || SMTP_USER,
    to,
    cc: String(CC_PARTNER).toLowerCase()==='true' && lead.partner_email ? lead.partner_email : undefined,
    subject: subjectFrom(lead),
    text: `Име: ${lead.full_name || (lead.first_name+" "+lead.last_name)}
Телефон: ${lead.phone_e164}
Износ (МКД): ${lead.requested_amount_mkd}
Рата (МКД): ${lead.target_installment_mkd}
Партнер: ${lead.partner || lead.partner_id || ''} ${lead.partner_email?`<${lead.partner_email}>`:''}
Извор: ${lead.source || 'landing'}
Согласност: ${lead.consent} — ${lead.consent_timestamp || ''}`,
    html: htmlSummary(lead),
    attachments: [{ filename:`lead-${new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14)}.csv`, content: csv, contentType:'text/csv' }]
  });
  return mail.messageId;
}

module.exports = async (req, res) => {
  withCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error: 'Method Not Allowed' });
  const body = normalizeBody(req);
  if(!body || (!body.full_name && !(body.first_name && body.last_name))) return res.status(400).json({ ok:false, error:'Missing name fields' });
  if(!body.phone_e164) return res.status(400).json({ ok:false, error:'Missing phone_e164' });
  try{
    const messageId = await sendMail({ ...body, received_at: new Date().toISOString() });
    res.status(200).json({ ok:true, messageId });
  } catch (err) {
    console.error(err); res.status(500).json({ ok:false, error: err.message || 'Send failure' });
  }
};
