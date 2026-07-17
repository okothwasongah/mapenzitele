// routes/push.js — device token registration + FCM sending
// Requires: npm install firebase-admin
const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

let admin = null;
try {
  admin = require('firebase-admin');
  if (!admin.apps.length && process.env.FIREBASE_SERVICE_ACCOUNT) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
  }
} catch (e) {
  console.warn('firebase-admin not configured — push disabled');
}

// POST /api/push/register  — save/refresh a device token
router.post('/register', auth, async (req, res) => {
  const { token, platform } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  try {
    await db.query(
      `INSERT INTO device_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id=$1, updated_at=NOW()`,
      [req.user.id, token, platform || 'android']
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to register token' });
  }
});

// POST /api/push/unregister  — on logout
router.post('/unregister', auth, async (req, res) => {
  const { token } = req.body;
  if (token) await db.query('DELETE FROM device_tokens WHERE token=$1', [token]);
  res.json({ success: true });
});

module.exports = router;
