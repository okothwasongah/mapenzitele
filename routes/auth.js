const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const sign = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// POST /api/auth/register
router.post('/register', [
  body('name').trim().isLength({ min: 2, max: 80 }),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('age').isInt({ min: 18, max: 99 }),
  body('gender').notEmpty(),
  body('looking_for').notEmpty(),
  body('mood').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  const { name, email, password, age, gender, looking_for, mood, city } = req.body;
  try {
    const exists = await db.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows[0]) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO users (name, email, password_hash, age, gender, looking_for, mood, city)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, email, is_paid, is_vip`,
      [name, email, hash, age, gender, looking_for, mood, city || null]
    );
    const user = rows[0];
    res.status(201).json({ token: sign(user.id), user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid credentials' });

  const { email, password } = req.body;
  try {
    const { rows } = await db.query('SELECT * FROM users WHERE email=$1', [email]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    // Update online status
    await db.query('UPDATE users SET is_online=TRUE, last_seen=NOW() WHERE id=$1', [user.id]);

    res.json({
      token: sign(user.id),
      user: {
        id: user.id, name: user.name, email: user.email,
        age: user.age, city: user.city, mood: user.mood,
        is_paid: user.is_paid, is_vip: user.is_vip, is_verified: user.is_verified
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.email, u.age, u.gender, u.looking_for, u.mood,
              u.city, u.occupation, u.tagline, u.bio, u.lat, u.lng,
              u.is_paid, u.is_vip, u.is_verified, u.is_online,
              COALESCE(json_agg(p ORDER BY p.sort_order) FILTER (WHERE p.id IS NOT NULL), '[]') as photos,
              COALESCE((SELECT json_agg(v.tag) FROM vibes v WHERE v.user_id=u.id), '[]') as vibes
       FROM users u
       LEFT JOIN photos p ON p.user_id=u.id
       WHERE u.id=$1 GROUP BY u.id`,
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, async (req, res) => {
  await db.query('UPDATE users SET is_online=FALSE, last_seen=NOW() WHERE id=$1', [req.user.id]);
  res.json({ success: true });
});

module.exports = router;
