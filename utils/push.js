// utils/push.js — send a push to a user across all their devices
const db = require('../db');
let admin = null;
try { admin = require('firebase-admin'); } catch (e) {}

async function sendPush(userId, { title, body, data = {} }) {
  if (!admin || !admin.apps || !admin.apps.length) return; // push not configured
  try {
    const { rows } = await db.query('SELECT token FROM device_tokens WHERE user_id=$1', [userId]);
    if (!rows.length) return;
    const tokens = rows.map(r => r.token);

    // all data values must be strings for FCM
    const strData = {};
    for (const k in data) strData[k] = String(data[k]);

    const resp = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: strData,
      android: {
        priority: 'high',
        notification: { channelId: 'mapenzitele_default', sound: 'default' }
      }
    });

    // prune dead tokens
    resp.responses.forEach((r, i) => {
      if (!r.success && r.error &&
          ['messaging/registration-token-not-registered',
           'messaging/invalid-registration-token'].includes(r.error.code)) {
        db.query('DELETE FROM device_tokens WHERE token=$1', [tokens[i]]).catch(() => {});
      }
    });
  } catch (e) {
    console.warn('sendPush error:', e.message);
  }
}

module.exports = { sendPush };
