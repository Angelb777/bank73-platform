// routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { ROLES } = User;
const { PROMOTER_TYPES = [] } = User;
const auth = require('../middleware/auth');
const { hashPassword, isHashedPassword, verifyPassword } = require('../utils/passwords');
const audit = require('../utils/audit');

const router = express.Router();
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const isProd = process.env.NODE_ENV === 'production';

function sanitizePromoterProfile(input = {}) {
  const hasAny = input && typeof input === 'object' && Object.values(input).some(v => {
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== null && String(v).trim() !== '';
  });
  if (!hasAny) return undefined;

  const toNum = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const countriesRaw = Array.isArray(input.countries)
    ? input.countries
    : String(input.countries || input.paisesOperacion || '').split(/\r?\n|,/);
  const normalizePromoterType = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return 'No definido';
    const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const found = PROMOTER_TYPES.find(type =>
      type.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === normalized
    );
    return found || 'No definido';
  };

  return {
    companyName: String(input.companyName ?? input.sociedad ?? input.nombreSociedad ?? '').trim().slice(0, 180),
    promoterType: normalizePromoterType(input.promoterType ?? input.tipoPromotor ?? input.modeloPromotor),
    yearsExperience: toNum(input.yearsExperience ?? input.aniosExperiencia),
    deliveredProjects: toNum(input.deliveredProjects ?? input.proyectosEntregados),
    activeProjects: toNum(input.activeProjects ?? input.proyectosActivos),
    developedVolume: toNum(input.developedVolume ?? input.volumenDesarrollado),
    countries: Array.from(new Set(countriesRaw.map(x => String(x || '').trim()).filter(Boolean))).slice(0, 20),
    notes: String(input.notes ?? input.notas ?? '').trim().slice(0, 1000)
  };
}

// ROLE-SEP: helper para firmar tokens incluyendo status
function signToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), role: user.role, status: user.status, tenantKey: user.tenantKey },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
}

// POST /api/auth/login
// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    // 👇 unifica cómo obtenemos tenantKey
    const tenantKey =
      req.tenant?.key || req.tenant?.tenantKey || req.tenantKey ||
      req.headers['x-tenant-key'] || req.headers['x-tenant'];

    if (!tenantKey) {
      return res.status(400).json({ error: 'Falta tenantKey en la petición' });
    }

    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email y password requeridos' });

    const norm = String(email).trim().toLowerCase();
    let user = await User.findOne({
      tenantKey,                                  // <-- usa el mismo tenantKey
      email: { $regex: `^${esc(norm)}$`, $options: 'i' }
    });

    // Bootstrap admin opcional
    if (process.env.ALLOW_ADMIN_BOOTSTRAP === '1') {
      const admEmail = String(process.env.ADMIN_EMAIL || 'admin@trustforbanks.local').toLowerCase();
      const admPass  = String(process.env.ADMIN_PASSWORD || 'admin123');
      if (norm === admEmail && password === admPass) {
        user = await User.findOneAndUpdate(
          { tenantKey, email: admEmail },         // <-- usa el mismo tenantKey
          {
            $set: {
              name: 'Administrador',
              password: hashPassword(admPass),
              role: 'admin',
              status: 'active'
            },
            $setOnInsert: { tenantKey, email: admEmail }
          },
          { new: true, upsert: true }
        );
      }
    }

    if (!user || !verifyPassword(password, user.password)) {
      if (!isProd) {
        console.warn('[LOGIN 401]', { tenantKey, email: norm, found: !!user });
      }
      await audit(req, 'auth.login_failed', {
        tenantKey,
        actorEmail: norm,
        status: 'failure',
        message: 'Credenciales inválidas',
        metadata: { email: norm, foundUser: !!user }
      });
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (!isHashedPassword(user.password)) {
      user.password = hashPassword(password);
      await user.save();
    }

    if (user.status !== 'active') {
      const reason = user.status === 'pending'
        ? 'Cuenta pendiente de aprobación por un administrador.'
        : 'Cuenta bloqueada por un administrador.';
      await audit(req, 'auth.login_blocked', {
        tenantKey,
        actorUserId: user._id,
        actorEmail: user.email,
        actorRole: user.role,
        targetType: 'user',
        targetId: user._id,
        status: 'blocked',
        message: reason,
        metadata: { userStatus: user.status }
      });
      return res.status(403).json({ error: reason, status: user.status });
    }

    // 👇 FIRMA el token con el mismo tenantKey calculado
    const token = jwt.sign(
      { userId: user._id.toString(), role: user.role, status: user.status, tenantKey },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    await audit(req, 'auth.login_success', {
      tenantKey,
      actorUserId: user._id,
      actorEmail: user.email,
      actorRole: user.role,
      targetType: 'user',
      targetId: user._id,
      message: 'Login correcto'
    });

    res.json({
      token,
      role: user.role,
      status: user.status,
      name: user.name,
      email: user.email
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/register
// ROLE-SEP: crea usuario en estado 'pending' y guarda roleRequested (bank|promoter|commercial)
// No inicia sesión automáticamente.
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, roleRequested } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email y password son requeridos' });
    }

    // Validar roleRequested (acepta todos los nuevos menos 'admin')
const requested = String(roleRequested || 'bank').toLowerCase();

const allowedRequested =
  (User.REQUESTABLE_ROLES && Array.isArray(User.REQUESTABLE_ROLES))
    ? User.REQUESTABLE_ROLES                                  // si la exportas desde el modelo
    : (Array.isArray(ROLES) ? ROLES.filter(r => r !== 'admin') // fallback: todos los ROLES menos admin
                            : ['bank','promoter','commercial','gerencia','socios','contable','financiero','legal','tecnico']);

if (!allowedRequested.includes(requested)) {
  return res.status(400).json({ error: 'roleRequested inválido' });
}

    const normEmail = String(email).trim().toLowerCase();
    const exists = await User.findOne({ tenantKey: req.tenantKey, email: normEmail });
    if (exists) return res.status(409).json({ error: 'El email ya está registrado' });

    const userPayload = {
      tenantKey: req.tenantKey,
      name,
      email: normEmail,
      password: hashPassword(password),
      role: 'bank',               // ROLE-SEP: valor por defecto del schema, no habilita acceso
      status: 'pending',          // ROLE-SEP: pendiente hasta aprobación de admin
      roleRequested: requested    // ROLE-SEP
    };

    if (requested === 'promoter') {
      const profileInput = req.body?.promoterProfile || req.body?.perfilPromotor || {};
      const companyName = String(
        req.body?.promoterCompanyName ??
        req.body?.sociedad ??
        profileInput.companyName ??
        profileInput.sociedad ??
        profileInput.nombreSociedad ??
        ''
      ).trim();

      if (!companyName) {
        return res.status(400).json({ error: 'El nombre de la sociedad es obligatorio para promotores.' });
      }

      userPayload.promoterProfile = sanitizePromoterProfile({ ...profileInput, companyName });
    }

    const user = await User.create(userPayload);

    await audit(req, 'auth.register_requested', {
      tenantKey: req.tenantKey,
      actorUserId: user._id,
      actorEmail: user.email,
      actorRole: user.role,
      targetType: 'user',
      targetId: user._id,
      status: 'info',
      message: 'Registro pendiente de aprobación',
      metadata: { roleRequested: user.roleRequested, name: user.name }
    });

    // ROLE-SEP: no devolvemos token: cuenta pendiente
    return res.status(201).json({
      message: 'Registro recibido. Tu cuenta está pendiente de aprobación por un administrador.',
      status: 'pending',
      roleRequested: user.roleRequested
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Lista de roles (si la UI la pide)
router.get('/roles', (_req, res) => res.json({ roles: ROLES })); // ROLE-SEP

// Quién soy
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findOne(
      { _id: req.user.userId, tenantKey: req.user.tenantKey },
      { password: 0 }
    );
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({
      userId: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,       // ROLE-SEP
      status: user.status,   // ROLE-SEP
      tenantKey: user.tenantKey
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ======== DEV ONLY: diagnóstico útil ======== */
if (!isProd) {
  router.get('/dev/users', async (req, res) => {
    const users = await User.find({ tenantKey: req.tenantKey }, { password: 0 }).sort({ createdAt: -1 });
    res.json({ tenantKey: req.tenantKey, count: users.length, users });
  });
}

module.exports = router;
