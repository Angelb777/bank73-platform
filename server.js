// server.js
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');

// Middlewares propios
const authMw = require('./middleware/auth');
const { requireActiveUser } = require('./middleware/auth');
const errorMw = require('./middleware/error');

// Rutas
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const milestoneRoutes = require('./routes/milestones');
const documentRoutes = require('./routes/documents');
const loanRoutes = require('./routes/loans');
const budgetRoutes = require('./routes/budget');
const inventoryRoutes = require('./routes/inventory');
const financeRoutes = require('./routes/finance');
const adminRoutes = require('./routes/admin');
const processRoutes = require('./routes/process');

// Comercial
const unitsRoutes = require('./routes/units');
const exportRoutes = require('./routes/export');
const ventasRoutes = require('./routes/ventas');

const permitRoutes = require('./routes/permits');
const chatRoutes = require('./routes/chat');

const app = express();

// ------- Safety nets de proceso -------
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});

/* =========================================================================
   Seguridad / middlewares base
   ========================================================================= */
const isLanDev = (process.env.NODE_ENV !== 'production');

if (isLanDev) {
  console.log('[SEC] helmet OFF (LAN/dev)');
} else {
  app.use(helmet());
}

app.use(cors({ origin: true, credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// DEV: no cachear HTML/CSS/JS
app.use((req, res, next) => {
  if (
    req.path === '/' ||
    req.path.endsWith('.html') ||
    req.path.endsWith('.css') ||
    req.path.endsWith('.js')
  ) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
  next();
});

/* =========================================================================
   Static
   ========================================================================= */
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(express.static(path.join(__dirname, 'public')));

/* =========================================================================
   Mongo
   ========================================================================= */
const { MONGO_URI, PORT = 3000 } = process.env;

if (!MONGO_URI) {
  console.error('[Mongo] Falta MONGO_URI (Render env var).');
}

mongoose.set('strictQuery', true);
mongoose.connect(MONGO_URI, {})
  .then(() => console.log('[Mongo] Conectado'))
  .catch((err) => {
    console.error('[Mongo] Error de conexión:', err.message);
  });

/* =========================================================================
   Health
   ========================================================================= */
app.get('/health', (req, res) => {
  const state = mongoose.connection.readyState; // 1 connected
  res.json({ status: 'ok', mongo: state === 1 ? 'connected' : state });
});

/* =========================================================================
   TENANT middleware ROBUSTO (para /api)
   ========================================================================= */
function tenantMw(req, _res, next) {
  let t =
    req.headers['x-tenant-key'] ||
    req.headers['x-tenant'] ||
    req.query?.tenantKey ||
    req.body?.tenantKey ||
    req.tenantKey;

  // fallback JWT
  if (!t) {
    const authHeader = req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token && process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        t = decoded?.tenantKey || t;
      } catch (_) {}
    }
  }

  req.tenantKey = t || req.tenantKey;
  req.tenant = req.tenant || { key: req.tenantKey, tenantKey: req.tenantKey };
  next();
}

// Prefijo API con tenantMw (AFECTA a todo /api)
app.use('/api', tenantMw);

/* =========================================================================
   Rutas públicas AUTH
   ========================================================================= */
app.use('/api/auth', authRoutes);

/* =========================================================================
   Rutas protegidas
   ========================================================================= */
const guard = [authMw, requireActiveUser];

app.use('/api/projects', ...guard, projectRoutes);
app.use('/api/milestones', ...guard, milestoneRoutes);
app.use('/api/documents', ...guard, documentRoutes);
app.use('/api/loans', ...guard, loanRoutes);
app.use('/api/budget', ...guard, budgetRoutes);
app.use('/api/inventory', ...guard, inventoryRoutes);

// Finanzas
app.use('/api', ...guard, financeRoutes);

// Admin
app.use('/api/admin', ...guard, adminRoutes);

// TRACE permits
app.use('/api/permits', (req, _res, next) => {
  console.log('[TRACE] /api/permits >>>', req.method, req.originalUrl);
  next();
});

// Permisos
app.use('/api/permits', ...guard, permitRoutes);

// Proceso (plantillas + checklists)
app.use('/api', ...guard, processRoutes);

// Comercial
app.use('/api/units', ...guard, unitsRoutes);
app.use('/api/export', ...guard, exportRoutes);
app.use('/api/ventas', ...guard, ventasRoutes);

// Chat
app.use('/api/chat', ...guard, chatRoutes);

/* =========================================================================
   SPA routes
   ========================================================================= */
app.get('/register', (_req, res) => res.sendFile(path.join(__dirname, 'public/register.html')));

app.get('/', (req, res) => {
  const file = path.join(__dirname, 'public/index.html');

  let stamp = 'NOFILE';
  try {
    const html = fs.readFileSync(file, 'utf8');
    stamp = (html.match(/INDEX_v\d+/)?.[0]) || 'NOSTAMP';
  } catch (_) {}

  console.log('[SERVE /] host=', req.headers.host, 'ip=', req.ip, 'file=', file, 'stamp=', stamp);
  res.sendFile(file);
});

app.get('/dashboard', (_req, res) => res.sendFile(path.join(__dirname, 'public/dashboard.html')));
app.get('/portfolio', (_req, res) => res.sendFile(path.join(__dirname, 'public/portfolio.html')));
app.get('/project', (_req, res) => res.sendFile(path.join(__dirname, 'public/project.html')));

/* =========================================================================
   Cron diario (documentos próximos a expirar)
   ========================================================================= */
const Document = require('./models/Document');
cron.schedule('0 2 * * *', async () => {
  try {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expiring = await Document.find({ expiryDate: { $gte: now, $lte: in30 } }).limit(50);
    if (expiring.length) {
      console.warn(`[CRON] Documentos próximos a expirar (${expiring.length}):`);
      expiring.forEach(d =>
        console.warn(` - ${d.originalname} (project ${d.projectId}) expira ${d.expiryDate?.toISOString()?.slice(0,10)}`)
      );
    }
  } catch (e) {
    console.error('[CRON] Error revisando expiraciones:', e.message);
  }
});

/* =========================================================================
   Error handlers (AL FINAL)
   ========================================================================= */
app.use(errorMw);

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('[ERROR FALLBACK]', err);

  if (err?.name === 'ValidationError') {
    return res.status(400).json({
      error: 'validation_error',
      details: Object.fromEntries(
        Object.entries(err.errors || {}).map(([k, v]) => [k, v?.message || String(v)])
      )
    });
  }

  if (err?.name === 'CastError') {
    return res.status(400).json({ error: 'bad_request', detail: 'ID inválido' });
  }

  if (err?.status === 401) return res.status(401).json({ error: 'unauthorized' });
  if (err?.status === 403) return res.status(403).json({ error: 'forbidden' });

  return res.status(500).json({ error: 'server_error' });
});

// 404 FINAL (después de rutas + error handlers)
app.use((req, res) => res.status(404).send('Not Found'));

/* =========================================================================
   Listen
   ========================================================================= */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[HTTP] Listening on 0.0.0.0:${PORT}`);
});
