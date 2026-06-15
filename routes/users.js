const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { requirePaid } = require('../middleware/auth');

// Haversine distance in km
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// GET /api/users/discover  — sorted by distance if user has location
router.get('/discover', auth, requirePaid, async (req, res) => {
  try {
    const me = await db.query('SELECT lat, lng, looking_for, gender FROM users WHERE id=$1', [req.user.id]);
    const { lat, lng } = me.rows[0];

    const { rows } = await db.query(
      `SELECT u.id, u.name, u.age, u.city, u.mood, u.tagline, u.bio,
              u.occupation, u.lat, u.lng, u.is_online, u.is_verified, u.is_vip,
              u.last_seen,
              COALESCE(json_agg(p ORDER BY p.sort_order) FILTER (WHERE p.id IS NOT NULL), '[]') as photos,
              COALESCE((SELECT json_agg(v.tag) FROM vibes v WHERE v.user_id=u.id), '[]') as vibes
       FROM users u
       LEFT JOIN photos p ON p.user_id=u.id
       WHERE u.id != $1
         AND u.is_paid = TRUE
         AND u.id NOT IN (
           SELECT receiver_id FROM sparks WHERE sender_id=$1
           UNION SELECT sender_id FROM sparks WHERE receiver_id=$1
         )
       GROUP BY u.id
       ORDER BY u.is_online DESC, u.last_seen DESC
       LIMIT 50`,
      [req.user.id]
    );

    let users = rows;
    // Sort by real distance if location available
    if (lat && lng) {
      users = rows
        .map(u => ({
          ...u,
          distance_km: u.lat && u.lng ? haversine(lat, lng, u.lat, u.lng) : 99999
        }))
        .sort((a, b) => a.distance_km - b.distance_km);
    }

    res.json(users);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load profiles' });
  }
});

// GET /api/users/:id  — single profile
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.age, u.city, u.mood, u.tagline, u.bio,
              u.occupation, u.lat, u.lng, u.is_online, u.is_verified, u.is_vip, u.last_seen,
              COALESCE(json_agg(p ORDER BY p.sort_order) FILTER (WHERE p.id IS NOT NULL), '[]') as photos,
              COALESCE((SELECT json_agg(v.tag) FROM vibes v WHERE v.user_id=u.id), '[]') as vibes
       FROM users u LEFT JOIN photos p ON p.user_id=u.id
       WHERE u.id=$1 GROUP BY u.id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load user' });
  }
});

// PUT /api/users/me  — update own profile
router.put('/me', auth, async (req, res) => {
  const { name, age, city, occupation, tagline, bio, mood, vibes } = req.body;
  try {
    await db.query(
      `UPDATE users SET name=$1, age=$2, city=$3, occupation=$4, tagline=$5, bio=$6, mood=$7
       WHERE id=$8`,
      [name, age, city, occupation, tagline, bio, mood, req.user.id]
    );
    // Update vibes
    if (Array.isArray(vibes)) {
      await db.query('DELETE FROM vibes WHERE user_id=$1', [req.user.id]);
      for (const tag of vibes.slice(0, 12)) {
        await db.query('INSERT INTO vibes (user_id, tag) VALUES ($1,$2)', [req.user.id, tag]);
      }
    }
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PUT /api/users/me/location
router.put('/me/location', auth, async (req, res) => {
  const { lat, lng } = req.body;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  try {
    await db.query('UPDATE users SET lat=$1, lng=$2 WHERE id=$3', [lat, lng, req.user.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// GET /api/users/me/notifications
router.get('/me/notifications', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT n.*, u.name as from_name,
              (SELECT url FROM photos WHERE user_id=n.from_user_id AND is_primary=TRUE LIMIT 1) as from_photo
       FROM notifications n
       LEFT JOIN users u ON u.id=n.from_user_id
       WHERE n.user_id=$1
       ORDER BY n.created_at DESC LIMIT 30`,
      [req.user.id]
    );
    // Mark as read
    await db.query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1', [req.user.id]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

module.exports = router;
