/* Sends one email through Brevo (same setup as digest.js). Returns false,
   without sending, until BREVO_API_KEY and DIGEST_FROM_EMAIL are set. */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const emailReady = () => !!(process.env.BREVO_API_KEY && process.env.DIGEST_FROM_EMAIL);

async function sendEmail ({ to, name, subject, html, tag }) {
  if (!emailReady() || !to) return false;
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
    body: JSON.stringify({
      sender: { name: 'Feed The Bear', email: process.env.DIGEST_FROM_EMAIL },
      to: [{ email: to, ...(name ? { name } : {}) }],
      subject,
      htmlContent: html,
      ...(tag ? { tags: [tag] } : {}),
    }),
  });
  if (!resp.ok) throw new Error(`Brevo ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return true;
}

// The plain card layout the app's emails share.
function emailHtml (rows) {
  return `<!doctype html><html><body style="margin:0;background:#f7f3ec;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" style="max-width:520px;background:#fffaf2;border-radius:16px;padding:24px" cellpadding="0" cellspacing="0">
    <tr><td style="font-size:18px;font-weight:800;color:#2a1d16">🐻 Feed The Bear</td></tr>
    ${rows.map(r => `<tr><td style="padding-top:14px;font-size:16px;line-height:1.5;color:#2a1d16">${r}</td></tr>`).join('')}
  </table>
  <p style="max-width:520px;font-size:12px;color:#8a7a6c;line-height:1.5">NyxCollective LLC · ${esc(process.env.DIGEST_ADDRESS || '')}</p>
  </td></tr></table></body></html>`;
}

module.exports = { sendEmail, emailHtml, emailReady, esc };
