/* TEMPORARY: makes the bear avatar pictures (Gemini image model, the logo as
   the style reference). Removed again once the avatars are in assets/.
   Locked to a one-time secret; only its SHA-256 is here. */
const crypto = require('crypto');

const SECRET_SHA = 'e18a9d2cdb330b16cb15f4ded959264e20df268e39cdf0e73dd41e3582dc7b74';
const MODELS = ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview', 'gemini-3-pro-image-preview'];

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const sha = crypto.createHash('sha256').update(String(body.secret || '')).digest('hex');
  if (req.method !== 'POST' || sha !== SECRET_SHA) return res.status(404).json({ error: 'Not found' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'no key' });
  const logo = Buffer.from(await (await fetch('https://www.feed-the-bear.com/feedbear.jpg')).arrayBuffer()).toString('base64');
  const errors = [];
  for (const model of body.model ? [body.model] : MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: logo } }, { text: String(body.prompt || '').slice(0, 2000) }] }],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
        }),
      });
      const j = await r.json();
      if (!r.ok) { errors.push(`${model}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`); continue; }
      const img = (j.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
      if (!img) { errors.push(`${model}: no image ${JSON.stringify(j).slice(0, 200)}`); continue; }
      return res.status(200).json({ model, mime: img.inlineData.mimeType, data: img.inlineData.data });
    } catch (err) { errors.push(`${model}: ${err.message}`); }
  }
  return res.status(502).json({ errors });
};
