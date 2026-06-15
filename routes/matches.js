const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { requirePaid } = require('../middleware/auth');

// POST /api/matches/spark  — like or super-like someone
router.post('/spark', auth, requirePaid, async (req, res) => {
  const { receiver_id, type = 'like' } = req.body;
  if (!receiver_id) return res.status(400).json({ error: 'receiver_id required' });
  if (receiver_id === req.user.id) return res.status(400).json({ error: 'Cannot spark yourself' });

  try {
    // Insert spark (ignore duplicate)
    await db.query(
      `INSERT INTO sparks (sender_id, receiver_id, type) VALUES ($1,$2,$3)
       ON CONFLICT (sender_id, receiver_id) DO UPDATE SET type=$3`,
      [req.user.id, receiver_id, type]
    );

    // Check if mutual → create match
    const mutual = await db.query(
      'SELECT id FROM sparks WHERE sender_id=$1 AND receiver_id=$2',
      [receiver_id, req.user.id]
    );

    let matched = false;
    let matchId = null;

    if (mutual.rows[0]) {
      // Ensure match exists
      const existing = await db.query(
        `SELECT id FROM matches WHERE (user1_id=$1 AND user2_id=$2) OR (user1_id=$2 AND user2_id=$1)`,
        [req.user.id, receiver_id]
      );
      if (!existing.rows[0]) {
        const m = await db.query(
          `INSERT INTO matches (user1_id, user2_id) VALUES ($1,$2) RETURNING id`,
          [req.user.id, receiver_id]
        );
        matchId = m.rows[0].id;
      } else {
        matchId = existing.rows[0].id;
      }
      matched = true;

      // Notify both users
      await db.query(
        `INSERT INTO notifications (user_id, from_user_id, type, message)
         VALUES ($1,$2,'match','You have a new match!')`,
        [receiver_id, req.user.id]
      );
    } else {
      // Notify receiver of spark
      const label = type === 'super' ? 'sent you a Super Spark ⚡' : 'sparked your profile 🔥';
      await db.query(
        `INSERT INTO notifications (user_id, from_user_id, type, message) VALUES ($1,$2,$3,$4)`,
        [receiver_id, req.user.id, type, label]
      );
    }

    // Real-time notification via socket
    const io = req.app.get('io');
    const onlineUsers = req.app.get('onlineUsers');
    const targetSocket = onlineUsers.get(receiver_id);
    if (targetSocket) {
      io.to(targetSocket).emit('notification:new', {
        type: matched ? 'match' : type,
        fromUserId: req.user.id,
        fromName: req.user.name
      });
    }

    res.json({ matched, matchId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to spark' });
  }
});

// GET /api/matches  — all matches for current user
router.get('/', auth, requirePaid, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT m.id as match_id, m.created_at as matched_at,
              u.id, u.name, u.age, u.city, u.mood, u.is_online, u.last_seen,
              (SELECT url FROM photos WHERE user_id=u.id AND is_primary=TRUE LIMIT 1) as photo
       FROM matches m
       JOIN users u ON u.id = CASE WHEN m.user1_id=$1 THEN m.user2_id ELSE m.user1_id END
       WHERE m.user1_id=$1 OR m.user2_id=$1
       ORDER BY m.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load matches' });
  }
});

// DELETE /api/matches/:matchId
router.delete('/:matchId', auth, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM matches WHERE id=$1 AND (user1_id=$2 OR user2_id=$2)',
      [req.params.matchId, req.user.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to unmatch' });
  }
});

// GET /api/matches/who-sparked-me
router.get('/who-sparked-me', auth, requirePaid, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.type, s.created_at, u.id, u.name, u.age, u.city,
              (SELECT url FROM photos WHERE user_id=u.id AND is_primary=TRUE LIMIT 1) as photo
       FROM sparks s JOIN users u ON u.id=s.sender_id
       WHERE s.receiver_id=$1 AND s.sender_id NOT IN (
         SELECT CASE WHEN user1_id=$1 THEN user2_id ELSE user1_id END FROM matches WHERE user1_id=$1 OR user2_id=$1
       )
       ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load sparks' });
  }
});

module.exports = router;
