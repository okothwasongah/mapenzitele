const router = require('express').Router();
const axios = require('axios');
const db = require('../db');
const auth = require('../middleware/auth');

// ── M-PESA DARAJA HELPERS ─────────────────────────────
const DARAJA_BASE = () =>
  process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

async function getDarajaToken() {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  const credentials = Buffer.from(`${key}:${secret}`).toString('base64');
  const { data } = await axios.get(
    `${DARAJA_BASE()}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${credentials}` } }
  );
  return data.access_token;
}

function mpesaTimestamp() {
  // Daraja expects EAT (UTC+3) YYYYMMDDHHmmss
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return d.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

function mpesaPassword(timestamp) {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

// Mark a payment completed and unlock the user. Returns userId or null.
async function completePayment(checkoutRequestId, receipt) {
  await db.query(
    `UPDATE payments SET status='completed', mpesa_receipt=COALESCE($1, mpesa_receipt)
     WHERE checkout_request_id=$2 AND status!='completed'`,
    [receipt || null, checkoutRequestId]
  );
  const { rows } = await db.query(
    `UPDATE users SET is_paid=TRUE
     WHERE id=(SELECT user_id FROM payments WHERE checkout_request_id=$1)
     RETURNING id`,
    [checkoutRequestId]
  );
  return rows[0]?.id || null;
}

function notifyPaid(req, userId) {
  if (!userId) return;
  const io = req.app.get('io');
  const onlineUsers = req.app.get('onlineUsers');
  const sid = onlineUsers && onlineUsers.get(userId);
  if (io && sid) io.to(sid).emit('payment:confirmed', { userId });
}

// POST /api/payment/mpesa/stkpush
router.post('/mpesa/stkpush', auth, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  // Normalise phone: 07XX/01XX → 2547XX/2541XX, strip spaces and +
  const normalised = phone.replace(/[\s+]/g, '').replace(/^0/, '254');
  if (!/^254(7|1)\d{8}$/.test(normalised))
    return res.status(400).json({ error: 'Invalid Kenyan phone number' });

  try {
    const token = await getDarajaToken();
    const timestamp = mpesaTimestamp();
    const password = mpesaPassword(timestamp);

    const payload = {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: 200,
      PartyA: normalised,
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: normalised,
      CallBackURL: `${process.env.APP_URL}/api/payment/mpesa/callback`,
      AccountReference: 'MAPENZITELE',
      TransactionDesc: 'mapenziTELE Access Fee'
    };

    const { data } = await axios.post(
      `${DARAJA_BASE()}/mpesa/stkpush/v1/processrequest`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (data.ResponseCode !== '0')
      return res.status(400).json({ error: data.ResponseDescription });

    await db.query(
      `INSERT INTO payments (user_id, amount, method, phone, checkout_request_id, status)
       VALUES ($1, 200, 'mpesa', $2, $3, 'pending')`,
      [req.user.id, normalised, data.CheckoutRequestID]
    );

    res.json({
      success: true,
      checkoutRequestId: data.CheckoutRequestID,
      message: 'STK push sent. Enter your M-Pesa PIN to complete payment.'
    });
  } catch (e) {
    console.error('M-Pesa STK error:', e.response?.data || e.message);
    res.status(500).json({ error: 'M-Pesa request failed. Try again.' });
  }
});

// POST /api/payment/mpesa/callback  — Safaricom calls this
router.post('/mpesa/callback', async (req, res) => {
  const body = req.body?.Body?.stkCallback;
  if (!body) return res.status(200).json({ ResultCode: 0 });

  const { CheckoutRequestID, ResultCode, CallbackMetadata } = body;

  try {
    if (ResultCode === 0) {
      const receipt = CallbackMetadata?.Item?.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
      const userId = await completePayment(CheckoutRequestID, receipt);
      notifyPaid(req, userId);
    } else {
      await db.query(
        `UPDATE payments SET status='failed' WHERE checkout_request_id=$1 AND status='pending'`,
        [CheckoutRequestID]
      );
    }
  } catch (e) {
    console.error('Callback processing error:', e.message);
  }

  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// GET /api/payment/mpesa/status/:checkoutRequestId
// Falls back to a Daraja STK Query if the callback never arrived.
router.get('/mpesa/status/:checkoutRequestId', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT status, mpesa_receipt, created_at FROM payments
       WHERE checkout_request_id=$1 AND user_id=$2`,
      [req.params.checkoutRequestId, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Payment not found' });

    let { status } = rows[0];

    // Callback may have been lost — after 20s, ask Daraja directly
    const ageSec = (Date.now() - new Date(rows[0].created_at).getTime()) / 1000;
    if (status === 'pending' && ageSec > 20) {
      try {
        const token = await getDarajaToken();
        const timestamp = mpesaTimestamp();
        const { data } = await axios.post(
          `${DARAJA_BASE()}/mpesa/stkpushquery/v1/query`,
          {
            BusinessShortCode: process.env.MPESA_SHORTCODE,
            Password: mpesaPassword(timestamp),
            Timestamp: timestamp,
            CheckoutRequestID: req.params.checkoutRequestId
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        // ResultCode "0" = paid; "1032" = cancelled by user; "1037" = timeout
        if (data.ResultCode === '0') {
          const userId = await completePayment(req.params.checkoutRequestId, null);
          notifyPaid(req, userId);
          status = 'completed';
        } else if (['1032', '1', '1037', '2001'].includes(String(data.ResultCode))) {
          await db.query(
            `UPDATE payments SET status='failed' WHERE checkout_request_id=$1 AND status='pending'`,
            [req.params.checkoutRequestId]
          );
          status = 'failed';
        }
      } catch (qe) {
        // Query can 500 while transaction is still processing — stay pending
      }
    }

    if (status === 'completed') {
      const user = await db.query('SELECT is_paid FROM users WHERE id=$1', [req.user.id]);
      return res.json({ status: 'completed', is_paid: user.rows[0].is_paid, receipt: rows[0].mpesa_receipt });
    }
    res.json({ status });
  } catch (e) {
    res.status(500).json({ error: 'Failed to check payment status' });
  }
});

// POST /api/payment/admin/grant  — admin manually unlocks a user
// (bank transfers, customer support). Requires ADMIN_KEY env + x-admin-key header.
router.post('/admin/grant', async (req, res) => {
  const key = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY)
    return res.status(403).json({ error: 'Forbidden' });

  const { email, method = 'bank', reference = 'MANUAL' } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  try {
    const { rows } = await db.query('SELECT id FROM users WHERE email=$1', [email]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });

    await db.query(
      `INSERT INTO payments (user_id, amount, method, mpesa_receipt, status)
       VALUES ($1, 200, $2, $3, 'completed')`,
      [rows[0].id, method, reference]
    );
    await db.query('UPDATE users SET is_paid=TRUE WHERE id=$1', [rows[0].id]);
    notifyPaid(req, rows[0].id);
    res.json({ success: true, message: `Access granted to ${email}` });
  } catch (e) {
    res.status(500).json({ error: 'Failed to grant access' });
  }
});

// GET /api/payment/history
router.get('/history', auth, async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, amount, currency, method, mpesa_receipt, status, created_at FROM payments WHERE user_id=$1 ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json(rows);
});

module.exports = router;
