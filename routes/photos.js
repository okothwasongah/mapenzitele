const router = require('express').Router();
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');

// Ensure upload directory exists
const UPLOAD_DIR = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG and WEBP allowed'));
  }
});

// POST /api/photos  — upload up to 6 photos
router.post('/', auth, upload.array('photos', 6), async (req, res) => {
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ error: 'No files uploaded' });

  try {
    // Count existing photos
    const count = await db.query('SELECT COUNT(*) FROM photos WHERE user_id=$1', [req.user.id]);
    const existing = parseInt(count.rows[0].count);
    const remaining = 6 - existing;
    if (remaining <= 0) return res.status(400).json({ error: 'Maximum 6 photos reached' });

    const toProcess = req.files.slice(0, remaining);
    const saved = [];

    for (let i = 0; i < toProcess.length; i++) {
      const file = toProcess[i];
      const filename = `${uuidv4()}.webp`;
      const filepath = path.join(UPLOAD_DIR, filename);

      // Resize & convert to webp
      await sharp(file.buffer)
        .resize(800, 1000, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(filepath);

      const url = `/uploads/${filename}`;
      const isPrimary = existing === 0 && i === 0;
      const sortOrder = existing + i;

      const { rows } = await db.query(
        `INSERT INTO photos (user_id, filename, url, is_primary, sort_order)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.user.id, filename, url, isPrimary, sortOrder]
      );
      saved.push(rows[0]);
    }

    res.status(201).json({ success: true, photos: saved });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Upload failed: ' + e.message });
  }
});

// PUT /api/photos/:id/primary  — set as profile photo
router.put('/:id/primary', auth, async (req, res) => {
  try {
    // Unset all
    await db.query('UPDATE photos SET is_primary=FALSE WHERE user_id=$1', [req.user.id]);
    // Set chosen
    const { rows } = await db.query(
      'UPDATE photos SET is_primary=TRUE WHERE id=$1 AND user_id=$2 RETURNING *',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Photo not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update primary photo' });
  }
});

// DELETE /api/photos/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'DELETE FROM photos WHERE id=$1 AND user_id=$2 RETURNING filename, is_primary',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Photo not found' });

    // Delete file from disk
    const fp = path.join(UPLOAD_DIR, rows[0].filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);

    // If deleted was primary, set first remaining as primary
    if (rows[0].is_primary) {
      await db.query(
        `UPDATE photos SET is_primary=TRUE WHERE id=(
           SELECT id FROM photos WHERE user_id=$1 ORDER BY sort_order ASC LIMIT 1
         )`,
        [req.user.id]
      );
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

// GET /api/photos/me
router.get('/me', auth, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM photos WHERE user_id=$1 ORDER BY sort_order ASC',
    [req.user.id]
  );
  res.json(rows);
});

// PUT /api/photos/reorder  — reorder photos
router.put('/reorder', auth, async (req, res) => {
  const { order } = req.body; // array of photo IDs in new order
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array of ids' });
  try {
    for (let i = 0; i < order.length; i++) {
      await db.query(
        'UPDATE photos SET sort_order=$1 WHERE id=$2 AND user_id=$3',
        [i, order[i], req.user.id]
      );
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to reorder photos' });
  }
});

module.exports = router;
