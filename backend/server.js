require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const rateLimit = require('express-rate-limit');
const path    = require('path');
const db       = require('./utils/database');
const rdpProxy = require('./utils/rdpproxy');
const rdpConsole = require('./utils/rdpConsole');

const app  = express();
app.set('trust proxy', true);
app.set('etag', false); // Prevent 304s stripping our X-VM-Cache-* headers
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const startedAt = Date.now();

// Security middleware
app.use(helmet());
const corsOrigins = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || 'http://localhost:5173,https://vps.penguinhosting.host')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const allowAll = String(process.env.CORS_ALLOW_ALL || '').toLowerCase() === 'true';
    if (allowAll) return cb(null, true);
    const ok = corsOrigins.some(p => {
      if (p === '*') return true;
      if (p === origin) return true;
      if (p.includes('*')) {
        const re = new RegExp('^' + p.split('*').map(s => s.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')).join('.*') + '$');
        return re.test(origin);
      }
      return false;
    });
    cb(ok ? null : new Error('Not allowed by CORS'), ok);
  },
  credentials: true,
  exposedHeaders: ['X-VM-Cache-Synced-At', 'X-VM-Cache-Syncing', 'X-VM-Cache-Error'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => {
    // Skip rate limiting for admin users — they need frequent polling
    try {
      const jwt = require('jsonwebtoken');
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) return false;
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
      return decoded?.role === 'admin';
    } catch {
      return false;
    }
  },
});
app.use('/api/', limiter);

// Auth rate limit (stricter)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again later.' },
});
app.use('/api/auth/login', authLimiter);

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// Logging
app.use(morgan('combined'));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/vms', require('./routes/vms'));
app.use('/api/vms-mgmt', require('./routes/vms_create'));
app.use('/api/isos', require('./routes/isos'));
app.use('/api/bandwidth', require('./routes/bandwidth'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/ddos', require('./routes/ddos'));


// Clean up expired sessions and old login attempts every hour
setInterval(() => {
  db.run('DELETE FROM sessions WHERE expires_at < NOW()').catch(() => {});
  db.run('DELETE FROM login_attempts WHERE created_at < NOW() - INTERVAL 1 DAY').catch(() => {});
  db.run('DELETE FROM bandwidth_history WHERE recorded_at < NOW() - INTERVAL 7 DAY').catch(() => {});
}, 60 * 60 * 1000);

// Background monitor: collect bandwidth snapshots + check alert rules every 60s
const monitor = require('./utils/monitor');
monitor.start();

// Health check
app.get('/api/health', async (req, res) => {
  const t0 = Date.now();
  let dbOk = false;
  let dbLatencyMs = null;
  try {
    await db.get('SELECT 1 AS ok');
    dbOk = true;
    dbLatencyMs = Date.now() - t0;
  } catch {}
  const rdpSessions = rdpProxy.getActiveSessions();
  const consoleSessions = rdpConsole.getActiveSessions();
  const rdpCount = Object.values(rdpSessions).reduce((sum, v) => sum + Number(v || 0), 0);
  const consoleCount = Object.values(consoleSessions).reduce((sum, v) => sum + Number(v || 0), 0);
  
  res.json({
    status: dbOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    database: { ok: dbOk, latency_ms: dbLatencyMs },
    sessions: {
      rdp: { total: rdpCount, by_vm: rdpSessions },
      console: { total: consoleCount, by_vm: consoleSessions },
      total: rdpCount + consoleCount,
    },
  });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
  });
}

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialise DB then start
db.init().then(() => {
  const server = app.listen(PORT, HOST, () => {
    console.log(`\n🖥️  Hyper-V Control Panel`);
    console.log(`📡 Backend API: http://${HOST}:${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  });

  // Long-running ops (emergency reset) can take 3-5 min.
  // Set server-level timeouts well above that so Cloudflare/nginx won't
  // drop the connection before the PowerShell script finishes.
  server.timeout          = 360000; // 6 min — time allowed per request
  server.keepAliveTimeout = 360000; // 6 min — keep-alive idle timeout
  server.headersTimeout   = 370000; // must be slightly above keepAliveTimeout

  // In-browser console (node-rdpjs → canvas)
  rdpConsole.attach(server);
  // Legacy raw RDP WebSocket proxy (optional clients)
  rdpProxy.attach(server);
}).catch(err => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
