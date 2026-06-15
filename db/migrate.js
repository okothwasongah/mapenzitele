require('dotenv').config();
const db = require('./index');

async function migrate() {
  console.log('Running migrations...');
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(80) NOT NULL,
      email VARCHAR(200) UNIQUE NOT NULL,
      password_hash VARCHAR(200) NOT NULL,
      age INT CHECK (age >= 18 AND age <= 99),
      gender VARCHAR(30),
      looking_for VARCHAR(30),
      mood VARCHAR(60),
      city VARCHAR(100),
      occupation VARCHAR(100),
      tagline VARCHAR(200),
      bio TEXT,
      lat DECIMAL(10,7),
      lng DECIMAL(10,7),
      is_paid BOOLEAN DEFAULT FALSE,
      is_verified BOOLEAN DEFAULT FALSE,
      is_vip BOOLEAN DEFAULT FALSE,
      is_online BOOLEAN DEFAULT FALSE,
      last_seen TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS photos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      filename VARCHAR(300) NOT NULL,
      url VARCHAR(500) NOT NULL,
      is_primary BOOLEAN DEFAULT FALSE,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS vibes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      tag VARCHAR(60) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sparks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
      receiver_id UUID REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(20) DEFAULT 'like',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(sender_id, receiver_id)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user1_id UUID REFERENCES users(id) ON DELETE CASCADE,
      user2_id UUID REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user1_id, user2_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
      sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
      text TEXT,
      type VARCHAR(20) DEFAULT 'text',
      media_url VARCHAR(500),
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      amount INT NOT NULL,
      currency VARCHAR(10) DEFAULT 'KES',
      method VARCHAR(30),
      phone VARCHAR(30),
      mpesa_receipt VARCHAR(100),
      checkout_request_id VARCHAR(200),
      status VARCHAR(30) DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      from_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(40),
      message TEXT,
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_sparks_receiver ON sparks(receiver_id);
    CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id);
    CREATE INDEX IF NOT EXISTS idx_photos_user ON photos(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_location ON users(lat, lng);
  `);
  console.log('✅ All tables created.');
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
