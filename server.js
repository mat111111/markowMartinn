// Servidor del sitio: API + archivos estáticos.
// Ejecutar con: npm start  (ver README.md)

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const seed = require('./seed');
const mailer = require('./mailer');
const theme = require('./public/theme.js');

const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@sitio.local').toLowerCase();
const DEFAULT_ADMIN_PASSWORD = 'admin12345';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
const SESSION_DAYS = 30;
const RESET_MINUTES = 60;
const ORDER_STATUSES = ['pendiente', 'pagado', 'enviado', 'entregado', 'cancelado'];
const CONTENT_KEYS = ['settings', 'author', 'socials', 'recommendations', 'appearance'];

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---------- utilidades ----------

const now = () => new Date().toISOString();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function str(v, max = 500, { required = false, field = 'campo' } = {}) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) throw new HttpError(400, `Completá ${field}.`);
  if (s.length > max) throw new HttpError(400, `${field} supera los ${max} caracteres.`);
  return s;
}

function int(v, min, max, field = 'número') {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${field} tiene que ser un número entero entre ${min} y ${max}.`);
  }
  return n;
}

function safeUrl(v) {
  const s = str(v, 400, { field: 'el enlace' });
  if (!s) return '';
  if (/^https?:\/\//i.test(s) || /^mailto:/i.test(s)) return s;
  throw new HttpError(400, 'Los enlaces tienen que empezar con https:// o mailto:');
}

const IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
function imageField(incoming, previous) {
  // '' borra la imagen; una URL /media/... conserva la que ya estaba;
  // un data URL nuevo la reemplaza.
  if (incoming == null) return previous || '';
  if (incoming === '') return '';
  if (typeof incoming === 'string' && incoming.startsWith('/media/')) return previous || '';
  if (typeof incoming !== 'string' || !IMAGE_RE.test(incoming)) {
    throw new HttpError(400, 'La imagen tiene que ser PNG, JPG o WEBP.');
  }
  if (incoming.length > 3_000_000) throw new HttpError(400, 'La imagen es muy pesada (máximo 2 MB).');
  return incoming;
}

function parseJson(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const real = Buffer.from(hash, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}

const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(req, res, token, maxAgeSeconds) {
  const parts = [
    `sid=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    phone: u.phone,
    address: parseJson(u.address, {}),
  };
}

async function getContent(key) {
  const row = await db.get('SELECT value FROM content WHERE key = ?', [key]);
  return row ? parseJson(row.value, null) : null;
}

async function setContent(key, value) {
  const json = JSON.stringify(value);
  const exists = await db.get('SELECT key FROM content WHERE key = ?', [key]);
  if (exists) await db.run('UPDATE content SET value = ?, updated_at = ? WHERE key = ?', [json, now(), key]);
  else await db.run('INSERT INTO content (key, value, updated_at) VALUES (?, ?, ?)', [key, json, now()]);
}

// Pequeño límite de intentos de login por IP.
const attempts = new Map();
function checkRate(ip) {
  const t = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < t) {
    attempts.set(ip, { count: 1, reset: t + 15 * 60 * 1000 });
    return;
  }
  a.count += 1;
  if (a.count > 10) throw new HttpError(429, 'Demasiados intentos. Probá de nuevo en 15 minutos.');
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- middlewares ----------

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com',
      "script-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
  next();
});

app.use('/api', express.json({ limit: '6mb' }));

// Protección CSRF: las escrituras deben ser JSON y del mismo origen.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.is('application/json')) return next(new HttpError(415, 'Formato no soportado.'));
  const origin = req.get('origin');
  if (origin && new URL(origin).host !== req.get('host')) {
    return next(new HttpError(403, 'Origen no permitido.'));
  }
  next();
});

app.use(
  '/api',
  wrap(async (req, res, next) => {
    const token = parseCookies(req.headers.cookie).sid;
    req.user = null;
    if (token) {
      const s = await db.get('SELECT user_id, expires_at FROM sessions WHERE token = ?', [tokenHash(token)]);
      if (s && s.expires_at > now()) {
        req.user = await db.get('SELECT * FROM users WHERE id = ?', [s.user_id]);
        req.sessionToken = token;
      }
    }
    next();
  })
);

const requireUser = (req, res, next) =>
  req.user ? next() : next(new HttpError(401, 'Iniciá sesión para continuar.'));
const requireAdmin = (req, res, next) =>
  req.user && req.user.role === 'admin'
    ? next()
    : next(new HttpError(403, 'Necesitás una cuenta de administrador.'));

// ---------- datos públicos del sitio ----------

function bookOut(b) {
  return {
    id: b.id,
    title: b.title,
    subtitle: b.subtitle,
    genre: b.genre,
    year: b.year,
    publisher: b.publisher,
    isbn: b.isbn,
    pages: b.pages,
    format: b.format,
    price: b.price,
    stock: b.stock,
    synopsis: b.synopsis,
    coverColor: b.cover_color,
    coverUrl: b.cover_image ? `/media/book/${b.id}?v=${encodeURIComponent(b.updated_at)}` : '',
    published: Boolean(b.published),
    featured: Boolean(b.featured),
    sort: b.sort,
  };
}

app.get(
  '/api/site',
  wrap(async (req, res) => {
    const isAdmin = req.user && req.user.role === 'admin';
    const books = await db.all(
      `SELECT * FROM books ${isAdmin ? '' : 'WHERE published = 1'} ORDER BY sort ASC, year DESC, id ASC`
    );
    const author = (await getContent('author')) || {};
    const authorRow = await db.get("SELECT updated_at FROM content WHERE key = 'author'");
    res.json({
      settings: (await getContent('settings')) || {},
      author: {
        ...author,
        photo: undefined,
        photoUrl: author.photo ? `/media/author?v=${encodeURIComponent(authorRow.updated_at)}` : '',
      },
      socials: (await getContent('socials')) || [],
      recommendations: (await getContent('recommendations')) || [],
      appearance: theme.normalize(await getContent('appearance')),
      books: books.map(bookOut),
      me: publicUser(req.user),
      ...(isAdmin ? { mail: mailer.mailStatus() } : {}),
    });
  })
);

function sendDataUrl(res, dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return res.status(404).end();
  res.setHeader('Content-Type', m[1]);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.end(Buffer.from(m[2], 'base64'));
}

app.get(
  '/media/book/:id',
  wrap(async (req, res) => {
    const row = await db.get('SELECT cover_image FROM books WHERE id = ?', [Number(req.params.id) || 0]);
    sendDataUrl(res, row && row.cover_image);
  })
);

app.get(
  '/media/author',
  wrap(async (req, res) => {
    const author = await getContent('author');
    sendDataUrl(res, author && author.photo);
  })
);

// ---------- cuentas ----------

async function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [tokenHash(token), userId, expires]);
  setSessionCookie(req, res, token, SESSION_DAYS * 86400);
}

function validEmail(v) {
  const e = str(v, 160, { required: true, field: 'el email' }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, 'El email no tiene un formato válido.');
  return e;
}

function validPassword(v) {
  const p = typeof v === 'string' ? v : '';
  if (p.length < 8) throw new HttpError(400, 'La contraseña tiene que tener al menos 8 caracteres.');
  if (p.length > 200) throw new HttpError(400, 'La contraseña es demasiado larga.');
  return p;
}

app.post(
  '/api/auth/register',
  wrap(async (req, res) => {
    checkRate(req.ip);
    const name = str(req.body.name, 120, { required: true, field: 'tu nombre' });
    const email = validEmail(req.body.email);
    const password = validPassword(req.body.password);
    if (await db.get('SELECT id FROM users WHERE email = ?', [email])) {
      throw new HttpError(409, 'Ya existe una cuenta con ese email. Probá ingresar.');
    }
    const row = await db.get(
      'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
      [name, email, hashPassword(password), 'customer', now()]
    );
    await createSession(req, res, row.id);
    const user = await db.get('SELECT * FROM users WHERE id = ?', [row.id]);
    res.status(201).json({ me: publicUser(user) });
  })
);

app.post(
  '/api/auth/login',
  wrap(async (req, res) => {
    checkRate(req.ip);
    const email = str(req.body.email, 160).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = email ? await db.get('SELECT * FROM users WHERE email = ?', [email]) : null;
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'El email o la contraseña no coinciden.');
    }
    if (req.body.adminOnly && user.role !== 'admin') {
      throw new HttpError(403, 'Esta cuenta no tiene permisos de administrador.');
    }
    await createSession(req, res, user.id);
    res.json({ me: publicUser(user) });
  })
);

app.post(
  '/api/auth/logout',
  wrap(async (req, res) => {
    if (req.sessionToken) await db.run('DELETE FROM sessions WHERE token = ?', [tokenHash(req.sessionToken)]);
    setSessionCookie(req, res, '', 0);
    res.json({ ok: true });
  })
);

app.get(
  '/api/auth/me',
  wrap(async (req, res) => {
    const me = publicUser(req.user);
    if (me && me.role === 'admin') {
      me.usingDefaultPassword = verifyPassword(DEFAULT_ADMIN_PASSWORD, req.user.password_hash);
    }
    res.json({ me });
  })
);

function addressIn(a = {}) {
  return {
    fullName: str(a.fullName, 120, { field: 'el nombre' }),
    street: str(a.street, 160, { field: 'la dirección' }),
    city: str(a.city, 80, { field: 'la localidad' }),
    province: str(a.province, 80, { field: 'la provincia' }),
    zip: str(a.zip, 12, { field: 'el código postal' }),
  };
}

app.put(
  '/api/me',
  requireUser,
  wrap(async (req, res) => {
    const name = str(req.body.name, 120, { required: true, field: 'tu nombre' });
    const phone = str(req.body.phone, 40, { field: 'el teléfono' });
    const address = addressIn(req.body.address);
    await db.run('UPDATE users SET name = ?, phone = ?, address = ? WHERE id = ?', [
      name,
      phone,
      JSON.stringify(address),
      req.user.id,
    ]);
    res.json({ me: publicUser(await db.get('SELECT * FROM users WHERE id = ?', [req.user.id])) });
  })
);

app.put(
  '/api/me/password',
  requireUser,
  wrap(async (req, res) => {
    if (!verifyPassword(String(req.body.current || ''), req.user.password_hash)) {
      throw new HttpError(400, 'La contraseña actual no es correcta.');
    }
    const next = validPassword(req.body.next);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(next), req.user.id]);
    // Cierra las demás sesiones abiertas de esta cuenta.
    await db.run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', [req.user.id, tokenHash(req.sessionToken)]);
    res.json({ ok: true });
    sendPasswordChanged(req.user, req).catch(() => {});
  })
);

// ---------- recuperar contraseña ----------
// Las contraseñas se guardan con hash: no se pueden leer ni reenviar.
// Se manda un link de un solo uso que vence en una hora para crear una nueva.

const resetRequests = new Map(); // límite por email: 3 pedidos por hora
function resetAllowed(email) {
  const t = Date.now();
  const list = (resetRequests.get(email) || []).filter((x) => x > t - 3600000);
  if (list.length >= 3) return false;
  list.push(t);
  resetRequests.set(email, list);
  return true;
}

async function createResetLink(user, req) {
  await db.run('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?', [user.id, now()]);
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + RESET_MINUTES * 60000).toISOString();
  await db.run('INSERT INTO password_resets (token, user_id, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)', [
    tokenHash(token),
    user.id,
    expires,
    now(),
  ]);
  return `${siteUrl(req)}/restablecer?t=${token}`;
}

async function sendResetEmail(user, req) {
  const settings = (await getContent('settings')) || {};
  const link = await createResetLink(user, req);
  await mailer.sendMail({
    to: user.email,
    toName: user.name,
    fromName: settings.siteName,
    replyTo: settings.contactEmail || undefined,
    ...mailer.resetEmail({ user, link, minutes: RESET_MINUTES, settings, accent: await emailAccent() }),
  });
}

async function sendPasswordChanged(user, req) {
  if (!mailer.mailStatus().configured) return;
  const settings = (await getContent('settings')) || {};
  await mailer.sendMail({
    to: user.email,
    toName: user.name,
    fromName: settings.siteName,
    replyTo: settings.contactEmail || undefined,
    ...mailer.passwordChangedEmail({ user, settings, siteUrl: siteUrl(req), accent: await emailAccent() }),
  });
}

app.post(
  '/api/auth/forgot',
  wrap(async (req, res) => {
    checkRate(req.ip);
    const email = validEmail(req.body.email);
    const mail = mailer.mailStatus();
    // Misma respuesta exista o no la cuenta, para no revelar qué emails están registrados.
    res.json({ ok: true, mailConfigured: mail.configured });
    if (!mail.configured) {
      console.warn('Pedido de recuperación de contraseña, pero el envío de mails no está configurado.');
      return;
    }
    if (!resetAllowed(email)) return;
    (async () => {
      const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
      if (user) await sendResetEmail(user, req);
    })().catch((err) => console.error('Mail de recuperación:', err.message));
  })
);

async function validReset(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const r = await db.get('SELECT * FROM password_resets WHERE token = ?', [tokenHash(token)]);
  if (!r || r.used || r.expires_at < now()) return null;
  return r;
}

app.get(
  '/api/auth/reset',
  wrap(async (req, res) => {
    const r = await validReset(req.query.t);
    if (!r) return res.json({ valid: false });
    const user = await db.get('SELECT name, email FROM users WHERE id = ?', [r.user_id]);
    res.json(user ? { valid: true, email: user.email, name: user.name } : { valid: false });
  })
);

app.post(
  '/api/auth/reset',
  wrap(async (req, res) => {
    checkRate(req.ip);
    const r = await validReset(req.body.token);
    if (!r) throw new HttpError(400, 'El link venció o ya se usó. Pedí uno nuevo desde “¿Olvidaste tu contraseña?”.');
    const password = validPassword(req.body.password);
    const changed = await db.run('UPDATE password_resets SET used = 1 WHERE token = ? AND used = 0', [r.token]);
    if (!changed) throw new HttpError(400, 'Este link ya se usó. Pedí uno nuevo.');
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), r.user_id]);
    await db.run('DELETE FROM sessions WHERE user_id = ?', [r.user_id]);
    await db.run('DELETE FROM password_resets WHERE user_id = ?', [r.user_id]);
    await createSession(req, res, r.user_id);
    const user = await db.get('SELECT * FROM users WHERE id = ?', [r.user_id]);
    res.json({ me: publicUser(user) });
    sendPasswordChanged(user, req).catch(() => {});
  })
);

function orderOut(o) {
  return {
    id: o.id,
    items: parseJson(o.items, []),
    subtotal: o.subtotal,
    shippingCost: o.shipping_cost,
    total: o.total,
    status: o.status,
    shipping: parseJson(o.shipping, {}),
    notes: o.notes,
    createdAt: o.created_at,
    emailStatus: parseJson(o.email_status || '', null),
    customer: o.customer_name ? { name: o.customer_name, email: o.customer_email, phone: o.customer_phone } : undefined,
  };
}

app.get(
  '/api/me/orders',
  requireUser,
  wrap(async (req, res) => {
    const rows = await db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
    res.json({ orders: rows.map(orderOut) });
  })
);

// ---------- pedidos ----------

app.post(
  '/api/orders',
  requireUser,
  wrap(async (req, res) => {
    const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 30) : [];
    if (!items.length) throw new HttpError(400, 'El carrito está vacío.');

    const wanted = new Map();
    for (const it of items) {
      const id = int(it.bookId, 1, 1e9, 'El libro');
      const qty = int(it.qty, 1, 20, 'La cantidad');
      wanted.set(id, (wanted.get(id) || 0) + qty);
    }

    const method = req.body.method === 'retiro' ? 'retiro' : 'envio';
    const address = addressIn(req.body.address);
    const phone = str(req.body.phone, 40, { required: true, field: 'un teléfono de contacto' });
    if (method === 'envio') {
      for (const [k, label] of [
        ['fullName', 'el nombre de quien recibe'],
        ['street', 'la dirección'],
        ['city', 'la localidad'],
        ['province', 'la provincia'],
        ['zip', 'el código postal'],
      ]) {
        if (!address[k]) throw new HttpError(400, `Completá ${label}.`);
      }
    }
    const notes = str(req.body.notes, 600, { field: 'las notas' });

    // Precios y stock salen de la base, nunca del navegador.
    const lines = [];
    for (const [id, qty] of wanted) {
      const b = await db.get('SELECT id, title, price, stock, published FROM books WHERE id = ?', [id]);
      if (!b || !b.published) throw new HttpError(400, 'Uno de los libros ya no está disponible.');
      if (b.stock < qty) {
        throw new HttpError(409, `No hay stock suficiente de "${b.title}" (quedan ${b.stock}).`);
      }
      lines.push({ bookId: b.id, title: b.title, price: b.price, qty });
    }

    // Descuenta stock de forma condicional; si algo falla, devuelve lo descontado.
    const done = [];
    for (const l of lines) {
      const changed = await db.run('UPDATE books SET stock = stock - ? WHERE id = ? AND stock >= ?', [l.qty, l.bookId, l.qty]);
      if (!changed) {
        for (const d of done) await db.run('UPDATE books SET stock = stock + ? WHERE id = ?', [d.qty, d.bookId]);
        throw new HttpError(409, `Se agotó "${l.title}" mientras comprabas. Revisá el carrito.`);
      }
      done.push(l);
    }

    const settings = (await getContent('settings')) || {};
    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const free = Number(settings.freeShippingFrom) || 0;
    const shippingCost = method === 'envio' && !(free && subtotal >= free) ? Number(settings.shippingCost) || 0 : 0;

    const row = await db.get(
      `INSERT INTO orders (user_id, items, subtotal, shipping_cost, total, status, shipping, notes, created_at)
       VALUES (?, ?, ?, ?, ?, 'pendiente', ?, ?, ?) RETURNING id`,
      [
        req.user.id,
        JSON.stringify(lines),
        subtotal,
        shippingCost,
        subtotal + shippingCost,
        JSON.stringify({ method, phone, ...address }),
        notes,
        now(),
      ]
    );

    if (req.body.saveAddress) {
      await db.run('UPDATE users SET phone = ?, address = ? WHERE id = ?', [phone, JSON.stringify(address), req.user.id]);
    }

    const order = await db.get('SELECT * FROM orders WHERE id = ?', [row.id]);
    const mail = mailer.mailStatus();
    res.status(201).json({
      order: orderOut(order),
      paymentInstructions: settings.paymentInstructions || '',
      emailSent: mail.configured,
    });
    // Los mails salen después de responder, así el comprador no espera.
    notifyOrder(order, siteUrl(req)).catch((err) => console.error('Mails del pedido', order.id, err));
  })
);

// ---------- mails de pedidos ----------

function siteUrl(req) {
  return (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

async function emailAccent() {
  const a = theme.normalize(await getContent('appearance'));
  return a.custom && theme.contrast(a.accentColor, '#ffffff') >= 3 ? a.accentColor : '#2539c2';
}

async function notifyOrder(orderRow, url) {
  const order = orderOut(orderRow);
  const customer = await db.get('SELECT name, email FROM users WHERE id = ?', [orderRow.user_id]);
  const settings = (await getContent('settings')) || {};
  const accent = await emailAccent();
  const seller = settings.notifyEmail || settings.contactEmail || '';
  const st = mailer.mailStatus();
  const result = { at: now(), buyer: 'off', seller: 'off', error: '' };
  const errors = [];

  if (!st.configured) {
    errors.push(st.problem || 'El envío de mails no está configurado en el servidor.');
  } else {
    const ctx = { order, customer: customer || { name: '', email: '' }, settings, siteUrl: url, accent };
    if (customer) {
      try {
        await mailer.sendMail({ to: customer.email, toName: customer.name, replyTo: seller || undefined, fromName: settings.siteName, ...mailer.buyerEmail(ctx) });
        result.buyer = 'ok';
      } catch (err) {
        result.buyer = 'error';
        errors.push(`Comprador: ${err.message}`);
      }
    }
    if (seller) {
      try {
        await mailer.sendMail({ to: seller, replyTo: customer ? customer.email : undefined, fromName: settings.siteName, ...mailer.sellerEmail(ctx) });
        result.seller = 'ok';
      } catch (err) {
        result.seller = 'error';
        errors.push(`Vendedor: ${err.message}`);
      }
    } else {
      errors.push('Falta el email para avisos de pedidos en Ajustes.');
    }
  }
  result.error = errors.join(' · ');
  await db.run('UPDATE orders SET email_status = ? WHERE id = ?', [JSON.stringify(result), orderRow.id]);
  return result;
}

// ---------- administración ----------

const admin = express.Router();
admin.use(requireAdmin);

function optionalEmail(v, label) {
  const e = str(v, 160, { field: label.toLowerCase() }).toLowerCase();
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, `${label} no tiene un formato válido.`);
  return e;
}

function validateContent(key, body) {
  if (key === 'settings') {
    return {
      siteName: str(body.siteName, 80, { required: true, field: 'el nombre del sitio' }),
      currency: 'ARS',
      shippingCost: int(body.shippingCost, 0, 10_000_000, 'El costo de envío') ?? 0,
      freeShippingFrom: int(body.freeShippingFrom, 0, 100_000_000, 'El mínimo para envío gratis') ?? 0,
      contactEmail: optionalEmail(body.contactEmail, 'El email de contacto'),
      notifyEmail: optionalEmail(body.notifyEmail, 'El email para avisos de pedidos'),
      paymentInstructions: str(body.paymentInstructions, 1500, { field: 'las instrucciones de pago' }),
    };
  }
  if (key === 'appearance') {
    const a = theme.normalize(body);
    const scale = Number(body.fontScale);
    if (!(scale >= 85 && scale <= 130)) throw new HttpError(400, 'El tamaño de letra tiene que estar entre 85% y 130%.');
    for (const k of ['textColor', 'bgColor', 'accentColor']) {
      if (body[k] && !/^#[0-9a-fA-F]{6}$/.test(body[k])) throw new HttpError(400, 'Los colores tienen que tener el formato #RRGGBB.');
    }
    return a;
  }
  if (key === 'author') {
    const facts = (Array.isArray(body.facts) ? body.facts : []).slice(0, 6).map((f) => ({
      label: str(f.label, 60, { field: 'el dato' }),
      value: str(f.value, 80, { field: 'el valor' }),
    })).filter((f) => f.label || f.value);
    return {
      name: str(body.name, 100, { required: true, field: 'el nombre' }),
      role: str(body.role, 80, { field: 'la profesión' }),
      heroLine: str(body.heroLine, 200, { field: 'la frase principal' }),
      location: str(body.location, 200, { field: 'el origen' }),
      bio: str(body.bio, 6000, { field: 'la biografía' }),
      quote: str(body.quote, 300, { field: 'la cita' }),
      facts,
    };
  }
  if (key === 'socials') {
    if (!Array.isArray(body)) throw new HttpError(400, 'Formato de redes inválido.');
    return body.slice(0, 12).map((s, i) => ({
      id: str(s.id, 40) || `s${Date.now()}${i}`,
      network: str(s.network, 40, { required: true, field: 'el nombre de la red' }),
      handle: str(s.handle, 80, { field: 'el usuario' }),
      url: safeUrl(s.url),
    }));
  }
  if (key === 'recommendations') {
    if (!Array.isArray(body)) throw new HttpError(400, 'Formato de recomendaciones inválido.');
    return body.slice(0, 24).map((r, i) => ({
      id: str(r.id, 40) || `r${Date.now()}${i}`,
      title: str(r.title, 160, { required: true, field: 'el título recomendado' }),
      author: str(r.author, 120, { field: 'el autor recomendado' }),
      note: str(r.note, 600, { field: 'el comentario' }),
      link: safeUrl(r.link),
    }));
  }
  throw new HttpError(404, 'Sección desconocida.');
}

admin.put(
  '/content/:key',
  wrap(async (req, res) => {
    const key = req.params.key;
    if (!CONTENT_KEYS.includes(key)) throw new HttpError(404, 'Sección desconocida.');
    const value = validateContent(key, req.body);
    if (key === 'author') {
      const prev = (await getContent('author')) || {};
      value.photo = imageField(req.body.photo, prev.photo);
    }
    await setContent(key, value);
    res.json({ ok: true });
  })
);

function bookIn(body, prev = {}) {
  const color = str(body.coverColor, 9) || prev.cover_color || '#22344F';
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new HttpError(400, 'El color de tapa tiene que ser un color hexadecimal (#RRGGBB).');
  return {
    title: str(body.title, 160, { required: true, field: 'el título' }),
    subtitle: str(body.subtitle, 160, { field: 'el subtítulo' }),
    genre: str(body.genre, 60, { field: 'el género' }),
    year: int(body.year, 1800, 2100, 'El año'),
    publisher: str(body.publisher, 100, { field: 'la editorial' }),
    isbn: str(body.isbn, 20, { field: 'el ISBN' }),
    pages: int(body.pages, 1, 5000, 'Las páginas'),
    format: str(body.format, 80, { field: 'el formato' }),
    price: int(body.price, 0, 100_000_000, 'El precio') ?? 0,
    stock: int(body.stock, 0, 1_000_000, 'El stock') ?? 0,
    synopsis: str(body.synopsis, 4000, { field: 'la sinopsis' }),
    cover_image: imageField(body.coverUrl, prev.cover_image),
    cover_color: color,
    published: body.published === false ? 0 : 1,
    featured: body.featured ? 1 : 0,
    sort: int(body.sort, -1000, 1000, 'El orden') ?? 0,
  };
}

const BOOK_COLS = [
  'title', 'subtitle', 'genre', 'year', 'publisher', 'isbn', 'pages', 'format', 'price',
  'stock', 'synopsis', 'cover_image', 'cover_color', 'published', 'featured', 'sort',
];

admin.post(
  '/books',
  wrap(async (req, res) => {
    const b = bookIn(req.body);
    if (b.featured) await db.run('UPDATE books SET featured = 0');
    const row = await db.get(
      `INSERT INTO books (${BOOK_COLS.join(', ')}, updated_at) VALUES (${BOOK_COLS.map(() => '?').join(', ')}, ?) RETURNING id`,
      [...BOOK_COLS.map((c) => b[c]), now()]
    );
    res.status(201).json({ book: bookOut(await db.get('SELECT * FROM books WHERE id = ?', [row.id])) });
  })
);

admin.put(
  '/books/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const prev = await db.get('SELECT * FROM books WHERE id = ?', [id]);
    if (!prev) throw new HttpError(404, 'Ese libro no existe.');
    const b = bookIn(req.body, prev);
    if (b.featured) await db.run('UPDATE books SET featured = 0 WHERE id <> ?', [id]);
    await db.run(
      `UPDATE books SET ${BOOK_COLS.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      [...BOOK_COLS.map((c) => b[c]), now(), id]
    );
    res.json({ book: bookOut(await db.get('SELECT * FROM books WHERE id = ?', [id])) });
  })
);

admin.delete(
  '/books/:id',
  wrap(async (req, res) => {
    await db.run('DELETE FROM books WHERE id = ?', [Number(req.params.id)]);
    res.json({ ok: true });
  })
);

admin.get(
  '/orders',
  wrap(async (req, res) => {
    const rows = await db.all(
      `SELECT o.*, u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
       FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT 500`
    );
    res.json({ orders: rows.map(orderOut) });
  })
);

admin.put(
  '/orders/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const status = String(req.body.status || '');
    if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Estado de pedido inválido.');
    const order = await db.get('SELECT * FROM orders WHERE id = ?', [id]);
    if (!order) throw new HttpError(404, 'Ese pedido no existe.');
    if (order.status === 'cancelado' && status !== 'cancelado') {
      throw new HttpError(400, 'Un pedido cancelado no se puede reactivar. Pedile al cliente que haga uno nuevo.');
    }
    if (status === 'cancelado' && order.status !== 'cancelado') {
      // Devuelve el stock de los libros del pedido.
      for (const it of parseJson(order.items, [])) {
        await db.run('UPDATE books SET stock = stock + ? WHERE id = ?', [it.qty, it.bookId]);
      }
    }
    await db.run('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
    res.json({ ok: true });
  })
);

admin.post(
  '/orders/:id/resend',
  wrap(async (req, res) => {
    const order = await db.get('SELECT * FROM orders WHERE id = ?', [Number(req.params.id)]);
    if (!order) throw new HttpError(404, 'Ese pedido no existe.');
    const result = await notifyOrder(order, siteUrl(req));
    res.json({ emailStatus: result });
  })
);

admin.post(
  '/test-email',
  wrap(async (req, res) => {
    const settings = (await getContent('settings')) || {};
    const to = (req.body.to ? validEmail(req.body.to) : '') || settings.notifyEmail || settings.contactEmail || req.user.email;
    try {
      await mailer.sendMail({ to, fromName: settings.siteName, ...mailer.testEmail({ settings, accent: await emailAccent() }) });
    } catch (err) {
      throw new HttpError(502, `No se pudo enviar: ${err.message}`);
    }
    res.json({ ok: true, to });
  })
);

admin.get(
  '/users',
  wrap(async (req, res) => {
    const users = await db.all('SELECT id, name, email, role, phone, created_at FROM users ORDER BY id DESC LIMIT 1000');
    const counts = await db.all('SELECT user_id, COUNT(*) AS n FROM orders GROUP BY user_id');
    const byUser = Object.fromEntries(counts.map((c) => [c.user_id, Number(c.n)]));
    res.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        phone: u.phone,
        createdAt: u.created_at,
        orders: byUser[u.id] || 0,
      })),
    });
  })
);

admin.post(
  '/users',
  wrap(async (req, res) => {
    const name = str(req.body.name, 120, { required: true, field: 'el nombre' });
    const email = validEmail(req.body.email);
    const password = validPassword(req.body.password);
    const role = req.body.role === 'admin' ? 'admin' : 'customer';
    if (await db.get('SELECT id FROM users WHERE email = ?', [email])) {
      throw new HttpError(409, 'Ya existe una cuenta con ese email.');
    }
    await db.run('INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)', [
      name,
      email,
      hashPassword(password),
      role,
      now(),
    ]);
    res.status(201).json({ ok: true });
  })
);

admin.post(
  '/users/:id/send-reset',
  wrap(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [Number(req.params.id)]);
    if (!user) throw new HttpError(404, 'Ese usuario no existe.');
    try {
      await sendResetEmail(user, req);
    } catch (err) {
      throw new HttpError(502, `No se pudo enviar: ${err.message}`);
    }
    res.json({ ok: true, to: user.email });
  })
);

admin.put(
  '/users/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const role = req.body.role === 'admin' ? 'admin' : 'customer';
    if (id === req.user.id && role !== 'admin') {
      throw new HttpError(400, 'No podés quitarte el rol de administrador a vos mismo.');
    }
    await db.run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
    res.json({ ok: true });
  })
);

admin.delete(
  '/users/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'No podés borrar tu propia cuenta desde acá.');
    await db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
    await db.run('DELETE FROM users WHERE id = ?', [id]);
    res.json({ ok: true });
  })
);

app.use('/api/admin', admin);

app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado.' }));

// ---------- estáticos ----------

// La página principal se sirve con la apariencia guardada ya aplicada (sin parpadeo).
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const escHtml = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const sendIndex = wrap(async (req, res) => {
  const settings = (await getContent('settings')) || {};
  const css = theme.css(await getContent('appearance'));
  let html = INDEX_HTML.replace('<style id="appearanceStyle"></style>', `<style id="appearanceStyle">${css}</style>`);
  if (settings.siteName) html = html.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(settings.siteName)}</title>`);
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(html);
});

app.get(['/', '/index.html'], sendIndex);
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '1h' }));
app.get('*', sendIndex);

// ---------- errores ----------

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El archivo es demasiado grande.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Datos con formato inválido.' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Algo falló en el servidor. Probá de nuevo.' : err.message });
});

// ---------- arranque ----------

async function seedIfEmpty() {
  if (!(await getContent('settings'))) {
    await setContent('settings', seed.SETTINGS);
    await setContent('author', seed.AUTHOR);
    await setContent('socials', seed.SOCIALS);
    await setContent('recommendations', seed.RECOMMENDATIONS);
    let sort = 0;
    for (const b of seed.BOOKS) {
      const row = { subtitle: '', isbn: '', cover_image: '', published: 1, ...b, sort: sort++ };
      await db.run(
        `INSERT INTO books (${BOOK_COLS.join(', ')}, updated_at) VALUES (${BOOK_COLS.map(() => '?').join(', ')}, ?)`,
        [...BOOK_COLS.map((c) => row[c] ?? null), now()]
      );
    }
    console.log('Contenido de ejemplo cargado.');
  }
  if (!(await db.get("SELECT id FROM users WHERE role = 'admin'"))) {
    await db.run('INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)', [
      'Administración',
      ADMIN_EMAIL,
      hashPassword(ADMIN_PASSWORD),
      'admin',
      now(),
    ]);
    console.log(`Cuenta de administrador creada: ${ADMIN_EMAIL}`);
    if (ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
      console.log(`Contraseña inicial: ${DEFAULT_ADMIN_PASSWORD}  (cambiala desde "Mi cuenta" apenas entres)`);
    }
  }
  // Recuperación del administrador sin mail: definí ADMIN_RESET_PASSWORD, reiniciá,
  // entrá con ADMIN_EMAIL y esa contraseña, y después borrá la variable.
  if (process.env.ADMIN_RESET_PASSWORD) {
    const pass = process.env.ADMIN_RESET_PASSWORD;
    if (pass.length < 8) {
      console.warn('ADMIN_RESET_PASSWORD tiene que tener al menos 8 caracteres. No se cambió nada.');
    } else {
      const u = await db.get('SELECT id FROM users WHERE email = ?', [ADMIN_EMAIL]);
      if (u) await db.run("UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?", [hashPassword(pass), u.id]);
      else await db.run('INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)', ['Administración', ADMIN_EMAIL, hashPassword(pass), 'admin', now()]);
      if (u) await db.run('DELETE FROM sessions WHERE user_id = ?', [u.id]);
      console.warn(`Contraseña de ${ADMIN_EMAIL} restablecida con ADMIN_RESET_PASSWORD. Borrá esa variable y volvé a publicar.`);
    }
  }
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [now()]);
  await db.run('DELETE FROM password_resets WHERE expires_at < ?', [now()]);
}

db.init()
  .then(seedIfEmpty)
  .then(() => {
    app.listen(PORT, () => console.log(`Sitio listo en http://localhost:${PORT}  (base: ${db.dialect})`));
  })
  .catch((err) => {
    console.error('No se pudo iniciar el servidor:', err);
    process.exit(1);
  });
