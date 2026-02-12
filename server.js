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
const authMw = require('./middleware/auth');               // exporta también requireActiveUser
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
const financeRoutes = require('./routes/finance');   // << Finanzas
const adminRoutes = require('./routes/admin');       // Admin
const processRoutes = require('./routes/process');   // Proceso (plantillas + checklists)

// Comercial
const unitsRoutes = require('./routes/units');
const exportRoutes = require('./routes/export');
const ventasRoutes = require('./routes/ventas');

const permitRoutes   = require('./routes/permits');

const chatRoutes   = require('./routes/chat');

const app = express();

// ------- Safety nets de proceso (no tumbar Node en dev) -------
process.on('unhandledRejection', (reason, p) => {
  console.error('[UNHANDLED REJECTION]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
  // En producción podrías decidir process.exit(1); aquí lo dejamos vivo para no "echarte"
});


/* =========================================================================
   Seguridad / middlewares base
   ========================================================================= */
const isLanDev = (process.env.NODE_ENV !== 'production');

if (isLanDev) {
  // sin helmet en LAN/dev para evitar políticas raras mientras debug
  console.log('[SEC] helmet OFF (LAN/dev)');
} else {
  app.use(helmet());
}

app.use(cors({ origin: true, credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// DEV: no cachear HTML/CSS/JS (para que IP y localhost siempre carguen lo último)
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
  console.error('[Mongo] Faltó MONGO_URI en .env');
  process.exit(1);
}
mongoose.set('strictQuery', true);
mongoose.connect(MONGO_URI, {})
  .then(() => console.log('[Mongo] Conectado'))
  .catch((err) => {
    console.error('[Mongo] Error de conexión:', err.message);
    process.exit(1);
  });

/* =========================================================================
   Health
   ========================================================================= */
app.get('/health', (req, res) => {
  const state = mongoose.connection.readyState; // 1 connected
  res.json({ status: 'ok', mongo: state === 1 ? 'connected' : state });
});

/* =========================================================================
   TENANT middleware ROBUSTO (antes de cualquier ruta /api)
   - Lee X-Tenant-Key o X-Tenant; si no viene, intenta sacarlo del JWT.
   - Normaliza req.tenantKey y req.tenant = { key, tenantKey }.
   ========================================================================= */
function tenantMw(req, _res, next) {
  let t =
    req.headers['x-tenant-key'] ||
    req.headers['x-tenant'] ||
    req.query?.tenantKey ||
    req.body?.tenantKey ||
    req.tenantKey;

  // fallback: intentar leer del JWT si viene Authorization
  if (!t) {
    const authHeader = req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token && process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        t = decoded?.tenantKey || t;
      } catch (_) { /* noop: token inválido, seguimos sin tenant */ }
    }
  }

  req.tenantKey = t || req.tenantKey; // no pisar si ya estaba
  // Exponer objeto compat
  req.tenant = req.tenant || { key: req.tenantKey, tenantKey: req.tenantKey };
  next();
}

// Prefijo API con middleware de tenant (afecta a todo /api)
app.use('/api', tenantMw);

/* =========================================================================
   Rutas públicas de AUTH
   - Importante: llegan con tenantMw ya ejecutado para firmar el token con ese tenant.
   ========================================================================= */
app.use('/api/auth', authRoutes);

/* =========================================================================
   Rutas protegidas (TENANT -> AUTH -> [ACTIVE] -> ROUTER)
   Si prefieres no revalidar contra BD en todas, cambia requireActiveUser por authMw.
   ========================================================================= */
const guard = [tenantMw, authMw, requireActiveUser];

app.use('/api/projects',   ...guard, projectRoutes);
app.use('/api/milestones', ...guard, milestoneRoutes);
app.use('/api/documents',  ...guard, documentRoutes);
app.use('/api/loans',      ...guard, loanRoutes);
app.use('/api/budget',     ...guard, budgetRoutes);
app.use('/api/inventory',  ...guard, inventoryRoutes);

// Finanzas montado con el mismo guard
app.use('/api',            ...guard, financeRoutes);

// Admin (el router valida rol ADMIN internamente)
app.use('/api/admin',      ...guard, adminRoutes);

// justo antes de: app.use('/api/permits', ...guard, permitRoutes);
app.use('/api/permits', (req, _res, next) => {
  console.log('[TRACE] /api/permits >>>', req.method, req.originalUrl);
  next();
});

// ✅ Permisos (plantillas + instancia por proyecto)
app.use('/api/permits', tenantMw, authMw, permitRoutes);

// ✅ Proceso (plantillas + checklists)
app.use('/api', tenantMw, authMw, requireActiveUser, processRoutes);

// Comercial
app.use('/api/units',      ...guard, unitsRoutes);
app.use('/api/export',     ...guard, exportRoutes);
app.use('/api/ventas',     ...guard, ventasRoutes);

app.use('/api/chat',       ...guard, chatRoutes);

/* =========================================================================
   Error handler
   ========================================================================= */
app.use(errorMw);

/* =========================================================================
   Error handler (fallback por si errorMw no captura todo)
   ========================================================================= */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('[ERROR FALLBACK]', err);

  if (err?.name === 'ValidationError') {
    // No tumbar el server: devolver 400 con detalle
    return res.status(400).json({
      error: 'validation_error',
      details: Object.fromEntries(
        Object.entries(err.errors || {}).map(([k, v]) => [k, v?.message || String(v)])
      )
    });
  }

  // Mongoose cast/objectId inválido
  if (err?.name === 'CastError') {
    return res.status(400).json({ error: 'bad_request', detail: 'ID inválido' });
  }

  // Auth habitual
  if (err?.status === 401) return res.status(401).json({ error: 'unauthorized' });
  if (err?.status === 403) return res.status(403).json({ error: 'forbidden' });

  return res.status(500).json({ error: 'server_error' });
});


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
   SPA routes
   ========================================================================= */
app.get('/register',  (_req, res) => res.sendFile(path.join(__dirname, 'public/register.html')));
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
app.get('/dashboard', (_req, res) => res.sendFile(path.join(__dirname, 'public/dashboard.html'))); // Vista admin
app.get('/portfolio', (_req, res) => res.sendFile(path.join(__dirname, 'public/portfolio.html')));
app.get('/project',   (_req, res) => res.sendFile(path.join(__dirname, 'public/project.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[HTTP] LAN: http://192.168.1.138:${PORT}`);
  console.log(`[HTTP] Local: http://localhost:${PORT}`);
});

