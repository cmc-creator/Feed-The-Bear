// Adds one to a daily counter for /usage.html (analytics/{day}.counts), for
// things only the server knows happened (an email or push actually sent).
async function bump (db, fb, name) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    await db.doc(`analytics/${day}`).set({ counts: { [name]: fb.firestore.FieldValue.increment(1) } }, { merge: true });
  } catch (err) { console.warn('[FTB] usage count failed:', err.message); }
}
module.exports = { bump };
