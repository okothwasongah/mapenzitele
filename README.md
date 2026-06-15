# mapenziTELE 🔥

> Premium casual dating platform — Node.js + PostgreSQL + Socket.IO + M-Pesa

---

## 🚀 Deploy to Railway in 5 Steps

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/mapenzitele.git
git push -u origin main
```

### 2. Create Railway Project
1. Go to [railway.app](https://railway.app) → **New Project**
2. Choose **Deploy from GitHub repo** → select `mapenzitele`
3. Click **Add Service** → **Database** → **PostgreSQL**
4. Railway auto-sets `DATABASE_URL` in your environment

### 3. Set Environment Variables
In Railway dashboard → your service → **Variables**, add:
```
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
APP_URL=https://YOUR-APP.up.railway.app
CLIENT_URL=https://YOUR-APP.up.railway.app
NODE_ENV=production
MPESA_CONSUMER_KEY=<from Safaricom Developer Portal>
MPESA_CONSUMER_SECRET=<from Safaricom Developer Portal>
MPESA_SHORTCODE=<your Paybill or Till number>
MPESA_PASSKEY=<from Safaricom>
MPESA_ENV=production
```

### 4. Run Database Migration
In Railway → your service → **Shell**:
```bash
npm run migrate
```

### 5. Go Live ✅
Railway auto-deploys on every push to `main`.

---

## 🛠 Local Development

```bash
npm install
cp .env.example .env
# Fill in .env values (use MPESA_ENV=sandbox for testing)
npm run migrate
npm run dev
```
Open http://localhost:3000

---

## 📁 Project Structure
```
mapenzitele/
├── server.js           # Express + Socket.IO entry point
├── routes/
│   ├── auth.js         # Register, login, /me
│   ├── users.js        # Discover, profile update, location
│   ├── matches.js      # Sparks, matches, who-liked-me
│   ├── messages.js     # Chat inbox + send
│   ├── photos.js       # Upload, delete, set primary
│   └── payment.js      # M-Pesa STK push + callback
├── middleware/
│   └── auth.js         # JWT verify + requirePaid guard
├── db/
│   ├── index.js        # PostgreSQL pool
│   └── migrate.js      # Schema migration
├── public/
│   ├── index.html      # Full SPA frontend
│   └── uploads/        # User photo files (auto-created)
├── .env.example
├── railway.json
└── package.json
```

## 🔑 M-Pesa Setup
1. Register at https://developer.safaricom.co.ke
2. Create an app → get Consumer Key & Secret
3. Use Paybill **174379** + your Passkey for sandbox
4. Set `CallBackURL` = `https://YOUR-APP.up.railway.app/api/payment/mpesa/callback`
5. Switch `MPESA_ENV=production` and use your real Paybill for live

## 🔒 Security Features
- Passwords hashed with bcrypt (12 rounds)
- JWT tokens (30-day expiry)
- Rate limiting on all endpoints
- Helmet.js HTTP headers
- requirePaid middleware guards all paid features
- Input validation on all routes
