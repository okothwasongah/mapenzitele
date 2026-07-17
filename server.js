require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || '*', methods: ['GET', 'POST'] }
});

// ── SECURITY ──────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
app.set('trust proxy', 1);
app.use((req, res, next) => {
  if (req.headers.host === 'mapenzitele.co.ke' && !req.path.startsWith('/api/payment/mpesa/callback')) {
    return res.redirect(301, 'https://www.mapenzitele.co.ke' + req.url);
  }
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 600,
  message: { error: 'Too many requests' },
  skip: (req) => req.path.startsWith('/payment/mpesa/callback')
});
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many auth attempts' } });
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// ── STATIC FILES ──────────────────────────────────────
app.use('/uploads', express.static(process.env.UPLOAD_DIR || path.join(__dirname, 'public/uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// ── ROUTES ────────────────────────────────────────────
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/users',   require('./routes/users'));
app.use('/api/matches', require('./routes/matches'));
app.use('/api/messages',require('./routes/messages'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/photos',  require('./routes/photos'));
app.use('/api/push',    require('./routes/push'));

// ── SOCKET.IO REAL-TIME CHAT ──────────────────────────
const onlineUsers = new Map(); // userId -> socketId

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('user:online', (userId) => {
    onlineUsers.set(userId, socket.id);
    io.emit('user:status', { userId, online: true });
  });

  socket.on('typing:start', ({ senderId, receiverId }) => {
    const targetSocket = onlineUsers.get(receiverId);
    if (targetSocket) io.to(targetSocket).emit('typing:show', { senderId });
  });

  socket.on('typing:stop', ({ senderId, receiverId }) => {
    const targetSocket = onlineUsers.get(receiverId);
    if (targetSocket) io.to(targetSocket).emit('typing:hide', { senderId });
  });

  socket.on('disconnect', () => {
    for (const [userId, sid] of onlineUsers.entries()) {
      if (sid === socket.id) {
        onlineUsers.delete(userId);
        io.emit('user:status', { userId, online: false });
        break;
      }
    }
  });
});

// Expose io to routes
app.set('io', io);
app.set('onlineUsers', onlineUsers);

// ── CATCH-ALL → serve index.html ──────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── ERROR HANDLER ─────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🔥 mapenziTELE running on port ${PORT}`));
