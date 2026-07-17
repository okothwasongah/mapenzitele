const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { requirePaid } = require('../middleware/auth');
const { sendPush } = require('../utils/push');

// GET /api/messages/:matchId  — fetch conversation
router.get('/:matchId', auth, requirePaid, async (req, res) => {
  try {
    // Verify user is part of this match
    const match = await db.query(
      'SELECT id FROM matches WHERE id=$1 AND (user1_id=$2 OR user2_id=$2)',
      [req.params.matchId, req.user.id]
    );
    if (!match.rows[0]) return res.status(403).json({ error: 'Not part of this match' });

    const { rows } = await db.query(
      `SELECT m.id, m.sender_id, m.text, m.type, m.media_url, m.is_read, m.created_at,
              u.name as sender_name,
              (SELECT url FROM photos WHERE user_id=m.sender_id AND is_primary=TRUE LIMIT 1) as sender_photo
       FROM messages m JOIN users u ON u.id=m.sender_id
       WHERE m.match_id=$1 ORDER BY m.created_at ASC LIMIT 200`,
      [req.params.matchId]
    );

    // Mark incoming as read
    await db.query(
      'UPDATE messages SET is_read=TRUE WHERE match_id=$1 AND sender_id!=$2 AND is_read=FALSE',
      [req.params.matchId, req.user.id]
    );

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// POST /api/messages/:matchId  — send message
router.post('/:matchId', auth, requirePaid, async (req, res) => {
  const { text, type = 'text', media_url } = req.body;
  if (!text && !media_url) return res.status(400).json({ error: 'text or media_url required' });

  try {
    const match = await db.query(
      'SELECT * FROM matches WHERE id=$1 AND (user1_id=$2 OR user2_id=$2)',
      [req.params.matchId, req.user.id]
    );
    if (!match.rows[0]) return res.status(403).json({ error: 'Not part of this match' });

    const { rows } = await db.query(
      `INSERT INTO messages (match_id, sender_id, text, type, media_url)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.matchId, req.user.id, text || null, type, media_url || null]
    );

    const msg = rows[0];

    // Real-time delivery via socket
    const io = req.app.get('io');
    const onlineUsers = req.app.get('onlineUsers');
    const m = match.rows[0];
    const receiverId = m.user1_id === req.user.id ? m.user2_id : m.user1_id;
    const targetSocket = onlineUsers.get(receiverId);
    if (targetSocket) {
      io.to(targetSocket).emit('message:receive', {
        ...msg, sender_name: req.user.name, matchId: req.params.matchId
      });
    } else {
      // Recipient offline → push so they come back
      const preview = type === 'image' ? '📷 Sent you a photo' : (text || '').slice(0, 80);
      sendPush(receiverId, {
        title: req.user.name,
        body: preview,
        data: { type: 'message', matchId: req.params.matchId, senderId: req.user.id }
      });
    }

    res.status(201).json(msg);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// GET /api/messages  — all conversations (inbox)
router.get('/', auth, requirePaid, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT m.id as match_id, m.created_at as matched_at,
              u.id as user_id, u.name, u.age, u.gender, u.is_online, u.last_seen,
              (SELECT url FROM photos WHERE user_id=u.id AND is_primary=TRUE LIMIT 1) as photo,
              (SELECT text FROM messages WHERE match_id=m.id ORDER BY created_at DESC LIMIT 1) as last_message,
              (SELECT created_at FROM messages WHERE match_id=m.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
              (SELECT COUNT(*) FROM messages WHERE match_id=m.id AND sender_id!=$1 AND is_read=FALSE)::int as unread_count
       FROM matches m
       JOIN users u ON u.id = CASE WHEN m.user1_id=$1 THEN m.user2_id ELSE m.user1_id END
       WHERE m.user1_id=$1 OR m.user2_id=$1
       ORDER BY last_message_at DESC NULLS LAST`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

module.exports = router;
