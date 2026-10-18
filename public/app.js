/* Sitio del autor: página pública, tienda, cuentas y panel de administración. */
'use strict';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const moneyFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const money = (n) => moneyFmt.format(Number(n) || 0);
const dateFmt = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '');
const orderNo = (id) => '#' + String(id).padStart(4, '0');
const STATUSES = ['pendiente', 'pagado', 'enviado', 'entregado', 'cancelado'];

async function api(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new Error('No hay conexión con el servidor. Revisá tu internet y probá de nuevo.');
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* respuesta sin cuerpo */
  }
  if (!res.ok) throw new Error(data.error || 'No se pudo completar la acción.');
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('toast--error', isError);
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), isError ? 5000 : 2600);
}

// Elige tinta clara u oscura según el color de tapa.
function inkFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#f3f1ea';
  const n = parseInt(m[1], 16);
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.36 ? '#16191f' : '#f3f1ea';
}

function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function paragraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Reduce una imagen en el navegador antes de subirla (JPEG liviano).
function fileToDataUrl(file, maxW, maxH, quality = 0.86) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      reject(new Error('Elegí una imagen JPG, PNG o WEBP.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width, maxH / img.height);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.textContent = label || 'Guardando…';
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.label || btn.textContent;
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const state = {
  site: null,
  me: null,
  cart: [],
  afterAuth: null,
  accountTab: 'pedidos',
  adminTab: 'autor',
  editingBook: null,
  pendingCover: null,
  pendingPhoto: null,
  draftRecs: null,
  draftSocials: null,
  adminOrders: [],
  orderFilter: 'todos',
  adminUsers: [],
  draftAppearance: null,
};

const isAdmin = () => state.me && state.me.role === 'admin';
const bookById = (id) => state.site.books.find((b) => b.id === Number(id));

function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem('cart.v1') || '[]');
    state.cart = Array.isArray(raw) ? raw.filter((i) => Number.isInteger(i.id) && i.qty > 0) : [];
  } catch {
    state.cart = [];
  }
}
function saveCart() {
  try {
    localStorage.setItem('cart.v1', JSON.stringify(state.cart));
  } catch {
    /* modo privado: el carrito vive solo en memoria */
  }
}

async function loadSite() {
  const data = await api('GET', '/api/site');
  state.site = data;
  state.me = data.me;
  if (isAdmin()) {
    try {
      const me = await api('GET', '/api/auth/me');
      state.me = me.me;
    } catch {
      /* sin datos extra */
    }
  }
  renderAll();
}

// ---------------------------------------------------------------------------
// Página pública
// ---------------------------------------------------------------------------

function coverHTML(b, { small = false } = {}) {
  const authorName = state.site?.author?.name || '';
  if (b.coverUrl) {
    return `<div class="cover cover--image${small ? ' cover--sm' : ''}"><img src="${esc(b.coverUrl)}" alt="Tapa de ${esc(b.title)}" loading="lazy"></div>`;
  }
  const c = /^#[0-9a-f]{6}$/i.test(b.coverColor) ? b.coverColor : '#22344f';
  return `<div class="cover${small ? ' cover--sm' : ''}" style="--c:${c};--ci:${inkFor(c)}" role="img" aria-label="Tapa de ${esc(b.title)}">
    <span class="cover__author">${esc(authorName)}</span>
    <span class="cover__title">${esc(b.title)}<span class="cover__rule" aria-hidden="true"></span></span>
    <span class="cover__pub">${esc(b.publisher || b.genre || '')}</span>
  </div>`;
}

function stockChip(b) {
  if (isAdmin() && !b.published) return '<span class="chip chip--hidden">Oculto</span>';
  if (b.stock <= 0) return '<span class="chip chip--out">Agotado</span>';
  if (b.stock <= 10) return `<span class="chip chip--low">Últimos ${b.stock}</span>`;
  return '';
}

function renderAll() {
  const { author, settings } = state.site;
  applyAppearance(state.draftAppearance || state.site.appearance);
  document.title = settings.siteName || author.name || 'Sitio';
  $('#wordmark').textContent = settings.siteName || author.name;
  document.body.classList.toggle('is-admin', isAdmin());
  $('#adminbar').hidden = !isAdmin();
  $$('.editbtn').forEach((b) => (b.hidden = !isAdmin()));

  renderHeader();
  renderHero();
  renderShelf();
  renderBio();
  renderRecs();
  renderSocials();
  renderFooter();
  renderCartCount();
  if ($('#adminDialog').open) renderAdmin();
}

function applyAppearance(a) {
  const tag = $('#appearanceStyle');
  if (tag && window.SiteTheme) tag.textContent = SiteTheme.css(a);
}

function renderHeader() {
  const btn = $('#accountBtn');
  if (state.me) {
    btn.textContent = state.me.name.split(' ')[0] || 'Mi cuenta';
    btn.setAttribute('aria-label', 'Abrir mi cuenta');
  } else {
    btn.textContent = 'Ingresar';
    btn.removeAttribute('aria-label');
  }
}

function renderHero() {
  const { author, books } = state.site;
  $('#heroRole').textContent = author.role || '';
  const words = String(author.name || '').trim().split(/\s+/);
  const last = words.length > 1 ? words.pop() : '';
  $('#heroName').innerHTML = esc(words.join(' ')) + (last ? ` <em>${esc(last)}</em>` : '');
  $('#heroLine').textContent = author.heroLine || '';
  $('#heroLine').hidden = !author.heroLine;

  const visible = books.filter((b) => b.published);
  const f = visible.find((b) => b.featured) || visible[0];
  const box = $('#heroFeature');
  if (!f) {
    box.innerHTML = '';
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const label = f.featured ? (f.year >= new Date().getFullYear() - 1 ? `Nueva ${esc((f.genre || 'obra').toLowerCase())}` : 'Destacado') : 'De su obra';
  box.innerHTML = `
    <button class="book__coverbtn" data-book="${f.id}" aria-label="Ver ${esc(f.title)}">${coverHTML(f)}</button>
    <div class="feature__meta">
      <span class="feature__label">${label}${f.year ? ' · ' + esc(f.year) : ''}</span>
      <h2 class="feature__title">${esc(f.title)}</h2>
      <p class="feature__info">${[f.publisher, f.pages ? f.pages + ' páginas' : ''].filter(Boolean).map(esc).join(' · ')}</p>
      <span class="feature__price">${money(f.price)}</span>
      <div class="hero__cta">
        ${f.stock > 0
          ? `<button class="btn btn--small" data-add="${f.id}">Agregar al carrito</button>`
          : '<span class="chip chip--out">Agotado</span>'}
        <button class="linkbtn" data-book="${f.id}">Leer la sinopsis</button>
      </div>
    </div>`;
}

function renderShelf() {
  const books = state.site.books.filter((b) => isAdmin() || b.published);
  const shelf = $('#shelf');
  const visibleCount = state.site.books.filter((b) => b.published).length;
  $('#obraNote').textContent = visibleCount
    ? `${visibleCount} ${visibleCount === 1 ? 'libro' : 'libros'} · Envíos a todo el país`
    : '';
  if (!books.length) {
    shelf.innerHTML = `<div class="empty" style="grid-column:1/-1">${
      isAdmin() ? 'Todavía no cargaste libros. Usá “Editar libros” para agregar el primero.' : 'Pronto vas a encontrar los libros acá.'
    }</div>`;
    return;
  }
  shelf.innerHTML = books
    .map((b) => {
      const meta = [b.genre, b.year].filter(Boolean).map(esc).join(' · ');
      const out = b.stock <= 0 || !b.published;
      return `<article class="book">
        <button class="book__coverbtn" data-book="${b.id}" aria-label="Ver detalle de ${esc(b.title)}">${coverHTML(b)}</button>
        <div class="book__body">
          <p class="book__meta">${meta}</p>
          <h3 class="book__title"><button data-book="${b.id}">${esc(b.title)}</button></h3>
          <div>${stockChip(b)}${isAdmin() && b.featured ? ' <span class="chip chip--accent">Destacado</span>' : ''}</div>
          <div class="book__buy">
            <span class="price">${money(b.price)}</span>
            <button class="addbtn" data-add="${b.id}" ${out ? 'disabled' : ''}>${b.stock <= 0 ? 'Sin stock' : 'Agregar'}</button>
          </div>
          ${isAdmin() ? `<div class="book__admin"><button class="editbtn" style="margin-left:0" data-editbook="${b.id}">Editar este libro</button><span class="muted" style="font-size:.78rem">Stock: ${b.stock}</span></div>` : ''}
        </div>
      </article>`;
    })
    .join('');
}

function renderBio() {
  const a = state.site.author;
  $('#bioPhoto').innerHTML = a.photoUrl
    ? `<img src="${esc(a.photoUrl)}" alt="Retrato de ${esc(a.name)}">`
    : `<span class="bio__monogram" aria-hidden="true">${esc(initials(a.name))}</span>`;
  $('#bioLocation').textContent = a.location || '';
  $('#bioText').innerHTML = paragraphs(a.bio);
  const facts = (a.facts || []).filter((f) => f.label || f.value);
  $('#bioFacts').innerHTML = facts.map((f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('');
  $('#bioFacts').hidden = !facts.length;
  $('#bioQuote').textContent = a.quote || '';
  $('#bioQuote').hidden = !a.quote;
}

function renderRecs() {
  const recs = state.site.recommendations || [];
  $('#lecturas').hidden = !recs.length && !isAdmin();
  $('#recs').innerHTML = recs.length
    ? recs
        .map(
          (r) => `<li class="rec">
        <h3 class="rec__title">${r.link ? `<a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.title)}</a>` : esc(r.title)}</h3>
        <p class="rec__author">${esc(r.author)}</p>
        ${r.note ? `<p class="rec__note">${esc(r.note)}</p>` : ''}
      </li>`
        )
        .join('')
    : '<li class="empty" style="grid-column:1/-1">Sin lecturas cargadas todavía.</li>';
}

function renderSocials() {
  const s = state.site.socials || [];
  $('#socials').innerHTML = s
    .map(
      (x) => `<li class="social"><a href="${esc(x.url)}" target="_blank" rel="noopener me">
      <span class="social__net">${esc(x.network)}</span>
      <span class="social__handle">${esc(x.handle)}</span>
      <span class="social__arrow" aria-hidden="true">↗</span></a></li>`
    )
    .join('');
  const mail = state.site.settings.contactEmail;
  $('#contact').innerHTML = mail
    ? `<span class="contact__label">Prensa, talleres y presentaciones</span>
       <a class="contact__mail" href="mailto:${esc(mail)}">${esc(mail)}</a>
       <button class="linkbtn" data-copy="${esc(mail)}">Copiar email</button>`
    : '';
}

function renderFooter() {
  const { author, settings } = state.site;
  $('#footerName').textContent = settings.siteName || author.name;
  $('#footerMeta').textContent = `© ${new Date().getFullYear()} ${author.name}. Textos e imágenes de uso reservado.`;
  const ship = [];
  if (settings.shippingCost) {
    ship.push(`<p><strong>Envíos a todo el país</strong> · ${money(settings.shippingCost)}</p>`);
  } else {
    ship.push('<p><strong>Envío sin cargo</strong> a todo el país</p>');
  }
  if (settings.freeShippingFrom && settings.shippingCost) ship.push(`<p>Gratis en compras desde ${money(settings.freeShippingFrom)}</p>`);
  ship.push('<p>Pagos por Mercado Pago o transferencia</p>');
  $('#footerShip').innerHTML = ship.join('');
  $('#adminLoginForm').hidden = isAdmin();
  $('#adminActive').hidden = !isAdmin();
}

// ---------------------------------------------------------------------------
// Diálogos
// ---------------------------------------------------------------------------

function openDialog(id) {
  const d = document.getElementById(id);
  if (!d.open) d.showModal();
  return d;
}
function closeDialog(d) {
  if (typeof d === 'string') d = document.getElementById(d);
  if (d && d.open) d.close();
}

let confirmResolve = null;
function confirmAction(text, yesLabel = 'Borrar') {
  $('#confirmText').textContent = text;
  $('#confirmYes').textContent = yesLabel;
  openDialog('confirmDialog');
  return new Promise((resolve) => (confirmResolve = resolve));
}

function openBook(id) {
  const b = bookById(id);
  if (!b) return;
  const specs = [
    ['Género', b.genre],
    ['Año', b.year],
    ['Editorial', b.publisher],
    ['Páginas', b.pages],
    ['Formato', b.format],
    ['ISBN', b.isbn],
  ].filter(([, v]) => v);
  $('#bookDialogBody').innerHTML = `
    <div class="bookdetail">
      <div>${coverHTML(b)}</div>
      <div class="bookdetail__info">
        <p class="eyebrow">${esc(state.site.author.name)}</p>
        <h2 class="bookdetail__title" id="bookDialogTitle">${esc(b.title)}</h2>
        ${b.subtitle ? `<p class="bookdetail__sub">${esc(b.subtitle)}</p>` : ''}
        <p class="bookdetail__syn">${esc(b.synopsis)}</p>
        <dl class="specs">${specs.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        <div class="bookdetail__buy">
          <span class="price">${money(b.price)}</span>
          ${b.stock > 0 && b.published
            ? `<button class="btn" data-add="${b.id}" data-close-after>Agregar al carrito</button>`
            : '<span class="chip chip--out">Agotado por ahora</span>'}
          ${b.stock > 0 && b.stock <= 10 ? `<span class="chip chip--low">Quedan ${b.stock}</span>` : ''}
        </div>
        ${isAdmin() ? `<div><button class="editbtn" style="margin-left:0" data-editbook="${b.id}">Editar este libro</button></div>` : ''}
      </div>
    </div>`;
  openDialog('bookDialog');
}

// ---------------------------------------------------------------------------
// Cuentas
// ---------------------------------------------------------------------------

function openAuth(tab = 'login', lead) {
  $('#authLead').textContent = lead || 'Ingresá para comprar y seguir tus pedidos.';
  setAuthTab(tab);
  $$('#authDialog .form__error').forEach((e) => (e.textContent = ''));
  openDialog('authDialog');
  setTimeout(() => (tab === 'login' ? $('#loginEmail') : $('#regName')).focus(), 50);
}

function setAuthTab(tab) {
  $('#loginForm').hidden = tab !== 'login';
  $('#registerForm').hidden = tab !== 'register';
  $('#tabLogin').setAttribute('aria-selected', String(tab === 'login'));
  $('#tabRegister').setAttribute('aria-selected', String(tab === 'register'));
}

async function afterLogin(me) {
  state.me = me;
  closeDialog('authDialog');
  await loadSite();
  toast(`Hola, ${me.name.split(' ')[0]}.`);
  if (state.afterAuth === 'checkout') {
    state.afterAuth = null;
    openCheckout();
  }
}

async function logout() {
  try {
    await api('POST', '/api/auth/logout', {});
  } catch {
    /* igual cerramos del lado del navegador */
  }
  state.me = null;
  $$('dialog[open]').forEach((d) => d.close());
  await loadSite();
  toast('Cerraste sesión.');
}

function openAccount(tab) {
  if (!state.me) return openAuth('login');
  state.accountTab = tab || state.accountTab;
  openDialog('accountDialog');
  renderAccount();
}

async function renderAccount() {
  $$('[data-accounttab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.accounttab === state.accountTab)));
  const body = $('#accountBody');
  const me = state.me;
  if (state.accountTab === 'pedidos') {
    body.innerHTML = '<p class="loading">Cargando pedidos…</p>';
    try {
      const { orders } = await api('GET', '/api/me/orders');
      body.innerHTML = orders.length
        ? `<div class="orders">${orders.map((o) => orderCard(o, false)).join('')}</div>`
        : `<div class="empty">Todavía no hiciste pedidos.<br><a class="linkbtn" href="#obra" data-close-account>Ver los libros</a></div>`;
    } catch (e) {
      body.innerHTML = `<p class="form__error">${esc(e.message)}</p>`;
    }
  } else if (state.accountTab === 'datos') {
    const a = me.address || {};
    body.innerHTML = `
      <form class="form" id="profileForm" novalidate>
        <div class="field"><label for="pfName">Nombre y apellido</label><input id="pfName" name="name" value="${esc(me.name)}" autocomplete="name" required></div>
        <div class="field"><label>Email</label><input value="${esc(me.email)}" disabled></div>
        <div class="field"><label for="pfPhone">Teléfono</label><input id="pfPhone" name="phone" value="${esc(me.phone)}" autocomplete="tel"></div>
        <fieldset class="fieldset"><legend>Dirección de envío</legend>
          ${addressFields(a, 'pf')}
        </fieldset>
        <p class="form__error" role="alert"></p>
        <div class="form__actions"><button class="btn" type="submit">Guardar mis datos</button></div>
      </form>`;
  } else {
    body.innerHTML = `
      ${me.usingDefaultPassword ? '<div class="notice"><strong>Contraseña inicial.</strong> Esta cuenta de administración sigue con la clave de instalación. Cambiala ahora.</div>' : ''}
      <form class="form" id="passwordForm" novalidate>
        <div class="field"><label for="pwCur">Contraseña actual</label><input id="pwCur" name="current" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="pwNew">Nueva contraseña</label><input id="pwNew" name="next" type="password" autocomplete="new-password" minlength="8" required><small>Mínimo 8 caracteres.</small></div>
        <p class="form__error" role="alert"></p>
        <div class="form__actions"><button class="btn" type="submit">Cambiar contraseña</button></div>
      </form>`;
  }
}

function addressFields(a = {}, p) {
  return `<div class="form__grid">
    <div class="field form__full"><label for="${p}FullName">Quien recibe</label><input id="${p}FullName" name="fullName" value="${esc(a.fullName)}" autocomplete="name"></div>
    <div class="field form__full"><label for="${p}Street">Calle, número, piso y depto.</label><input id="${p}Street" name="street" value="${esc(a.street)}" autocomplete="street-address"></div>
    <div class="field"><label for="${p}City">Localidad</label><input id="${p}City" name="city" value="${esc(a.city)}" autocomplete="address-level2"></div>
    <div class="field"><label for="${p}Province">Provincia</label><input id="${p}Province" name="province" value="${esc(a.province)}" autocomplete="address-level1"></div>
    <div class="field"><label for="${p}Zip">Código postal</label><input id="${p}Zip" name="zip" value="${esc(a.zip)}" autocomplete="postal-code" inputmode="numeric"></div>
  </div>`;
}

function emailLine(o) {
  const e = o.emailStatus;
  const btn = `<button class="linkbtn" data-resend="${o.id}">${e ? 'Reenviar mails' : 'Enviar mails'}</button>`;
  if (!e) return `<div class="order__mail">Mails: enviando o sin registro. ${btn}</div>`;
  const mark = (v) => (v === 'ok' ? '✓ enviado' : v === 'error' ? '✕ falló' : '— no enviado');
  return `<div class="order__mail${e.error ? ' order__mail--err' : ''}">
    <span>Mail al comprador: ${mark(e.buyer)}</span><span>Mail al vendedor: ${mark(e.seller)}</span>${btn}
    ${e.error ? `<span class="order__mailerr">${esc(e.error)}</span>` : ''}</div>`;
}

function orderCard(o, admin) {
  const ship = o.shipping || {};
  const shipText =
    ship.method === 'retiro'
      ? 'Retiro a coordinar'
      : [ship.fullName, ship.street, [ship.city, ship.province].filter(Boolean).join(', '), ship.zip ? 'CP ' + ship.zip : '']
          .filter(Boolean)
          .map(esc)
          .join('<br>');
  return `<article class="order">
    <div class="order__head">
      <div><span class="order__id">Pedido ${orderNo(o.id)}</span> <span class="order__date">· ${fmtDate(o.createdAt)}</span></div>
      <span class="chip status status--${esc(o.status)}">${esc(o.status)}</span>
    </div>
    ${admin
      ? `<div class="order__cust">${o.customer
          ? `<strong>${esc(o.customer.name)}</strong><span>${esc(o.customer.email)}</span>`
          : '<span class="muted">Cuenta eliminada</span>'}
          ${ship.phone ? `<span>Tel. ${esc(ship.phone)}</span>` : ''}</div>`
      : ''}
    <ul class="order__items">${o.items.map((i) => `<li><span>${i.qty} × ${esc(i.title)}</span><span>${money(i.price * i.qty)}</span></li>`).join('')}
      <li class="muted"><span>Envío</span><span>${o.shippingCost ? money(o.shippingCost) : 'Sin cargo'}</span></li></ul>
    <div class="order__ship">${shipText}${o.notes ? `<br><em>Nota: ${esc(o.notes)}</em>` : ''}</div>
    ${admin ? emailLine(o) : ''}
    <div class="order__foot">
      <span class="order__total">Total ${money(o.total)}</span>
      ${admin
        ? `<label class="check" style="gap:.5rem">Estado
            <select data-orderstatus="${o.id}" ${o.status === 'cancelado' ? 'disabled' : ''}>
              ${STATUSES.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
            </select></label>`
        : ''}
    </div>
  </article>`;
}

// ---------------------------------------------------------------------------
// Carrito y compra
// ---------------------------------------------------------------------------

function cartLines() {
  return state.cart
    .map((i) => ({ ...i, book: bookById(i.id) }))
    .filter((l) => l.book && l.book.published);
}

function cartTotals(method = 'envio') {
  const s = state.site.settings;
  const subtotal = cartLines().reduce((sum, l) => sum + l.book.price * l.qty, 0);
  const free = Number(s.freeShippingFrom) || 0;
  const shipping = method === 'envio' && subtotal > 0 && !(free && subtotal >= free) ? Number(s.shippingCost) || 0 : 0;
  return { subtotal, shipping, total: subtotal + shipping };
}

function renderCartCount() {
  const n = cartLines().reduce((s, l) => s + l.qty, 0);
  $('#cartCount').textContent = n;
}

function addToCart(id) {
  const b = bookById(id);
  if (!b || b.stock <= 0) return;
  const line = state.cart.find((i) => i.id === b.id);
  if (line) {
    if (line.qty >= b.stock) return toast(`No hay más stock de “${b.title}”.`, true);
    line.qty += 1;
  } else {
    state.cart.push({ id: b.id, qty: 1 });
  }
  saveCart();
  renderCartCount();
  toast(`Agregaste “${b.title}” al carrito.`);
  if ($('#cartDialog').open) renderCart();
}

function changeQty(id, delta) {
  const line = state.cart.find((i) => i.id === id);
  const b = bookById(id);
  if (!line || !b) return;
  line.qty = Math.max(0, Math.min(b.stock, line.qty + delta));
  if (line.qty === 0) state.cart = state.cart.filter((i) => i.id !== id);
  saveCart();
  renderCart();
  renderCartCount();
}

function openCart() {
  openDialog('cartDialog');
  renderCart();
}

function renderCart() {
  const lines = cartLines();
  const body = $('#cartBody');
  const foot = $('#cartFoot');
  if (!lines.length) {
    body.innerHTML = '<div class="empty">Tu carrito está vacío.<br><a class="linkbtn" href="#obra" data-close-cart>Ver los libros</a></div>';
    foot.innerHTML = '';
    return;
  }
  body.innerHTML = `<ul class="cartlist">${lines
    .map(
      (l) => `<li class="cartitem">
      <div>${coverHTML(l.book, { small: true })}</div>
      <div>
        <p class="cartitem__title">${esc(l.book.title)}</p>
        <span class="cartitem__price">${money(l.book.price)} c/u</span>
      </div>
      <div class="cartitem__right">
        <div class="stepper" role="group" aria-label="Cantidad de ${esc(l.book.title)}">
          <button data-qty="${l.id}" data-delta="-1" aria-label="Quitar uno">−</button>
          <span>${l.qty}</span>
          <button data-qty="${l.id}" data-delta="1" aria-label="Sumar uno" ${l.qty >= l.book.stock ? 'disabled' : ''}>+</button>
        </div>
        <span class="price">${money(l.book.price * l.qty)}</span>
      </div>
    </li>`
    )
    .join('')}</ul>`;
  const t = cartTotals('envio');
  const s = state.site.settings;
  const missing = s.freeShippingFrom && s.shippingCost && t.subtotal < s.freeShippingFrom ? s.freeShippingFrom - t.subtotal : 0;
  foot.innerHTML = `
    <div class="totals">
      <div><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
      <div><span>Envío a domicilio</span><span>${t.shipping ? money(t.shipping) : 'Sin cargo'}</span></div>
      <div class="totals__total"><span>Total</span><span>${money(t.total)}</span></div>
    </div>
    ${missing ? `<p class="hint">Te faltan ${money(missing)} para el envío gratis.</p>` : ''}
    <button class="btn btn--block" data-action="checkout">Finalizar compra</button>`;
}

function openCheckout() {
  if (!cartLines().length) return;
  if (!state.me) {
    state.afterAuth = 'checkout';
    closeDialog('cartDialog');
    openAuth('register', 'Para finalizar la compra, creá tu cuenta o ingresá con la que ya tenés.');
    return;
  }
  closeDialog('cartDialog');
  const me = state.me;
  const a = me.address || {};
  $('#checkoutBody').innerHTML = `
    <h2 class="modal__title" id="checkoutTitle">Finalizar compra</h2>
    <p class="modal__lead">Revisá tus datos. El pago se coordina después de confirmar el pedido.</p>
    <form class="form" id="checkoutForm" novalidate>
      <div class="segmented" role="radiogroup" aria-label="Forma de entrega">
        <label><input type="radio" name="method" value="envio" checked><span>Envío a domicilio</span><small>Correo, 3 a 7 días hábiles</small></label>
        <label><input type="radio" name="method" value="retiro"><span>Retiro a coordinar</span><small>En presentaciones o talleres</small></label>
      </div>
      <div id="coAddress">${addressFields({ fullName: me.name, ...a }, 'co')}</div>
      <div class="form__grid">
        <div class="field"><label for="coPhone">Teléfono de contacto</label><input id="coPhone" name="phone" value="${esc(me.phone)}" autocomplete="tel" required></div>
        <div class="field"><label>Email</label><input value="${esc(me.email)}" disabled></div>
        <div class="field form__full"><label for="coNotes">Notas (opcional)</label><textarea id="coNotes" name="notes" rows="2" style="min-height:76px" placeholder="Si querés una dedicatoria, escribí a nombre de quién."></textarea></div>
      </div>
      <label class="check"><input type="checkbox" name="saveAddress" checked> Guardar estos datos para la próxima compra</label>
      <div class="totals" id="coTotals"></div>
      <p class="form__error" role="alert"></p>
      <button class="btn btn--block" type="submit">Confirmar pedido</button>
    </form>`;
  renderCheckoutTotals();
  openDialog('checkoutDialog');
}

function renderCheckoutTotals() {
  const form = $('#checkoutForm');
  if (!form) return;
  const method = form.elements.method.value;
  $('#coAddress').hidden = method !== 'envio';
  const t = cartTotals(method);
  $('#coTotals').innerHTML = `
    ${cartLines().map((l) => `<div><span>${l.qty} × ${esc(l.book.title)}</span><span>${money(l.book.price * l.qty)}</span></div>`).join('')}
    <div><span>Envío</span><span>${t.shipping ? money(t.shipping) : 'Sin cargo'}</span></div>
    <div class="totals__total"><span>Total</span><span>${money(t.total)}</span></div>`;
}

async function submitCheckout(form) {
  const err = $('.form__error', form);
  err.textContent = '';
  const d = formData(form);
  const btn = $('button[type=submit]', form);
  setBusy(btn, true, 'Enviando pedido…');
  try {
    const res = await api('POST', '/api/orders', {
      items: cartLines().map((l) => ({ bookId: l.id, qty: l.qty })),
      method: d.method,
      phone: d.phone,
      notes: d.notes,
      saveAddress: Boolean(d.saveAddress),
      address: { fullName: d.fullName, street: d.street, city: d.city, province: d.province, zip: d.zip },
    });
    state.cart = [];
    saveCart();
    await loadSite();
    $('#checkoutBody').innerHTML = `
      <div class="success">
        <p class="eyebrow">Pedido recibido</p>
        <span class="success__num">${orderNo(res.order.id)}</span>
        <p class="modal__lead" style="margin:0">Total ${money(res.order.total)}. ${res.emailSent
          ? `Te mandamos la confirmación a <strong>${esc(state.me.email)}</strong>. Si no la ves en unos minutos, revisá la carpeta de spam.`
          : 'Guardá este número de pedido. También lo vas a encontrar en Mi cuenta.'}</p>
        ${res.paymentInstructions ? `<div class="success__box">${esc(res.paymentInstructions)}</div>` : ''}
        <div class="form__actions form__actions--start">
          <button class="btn" data-action="myorders">Ver mis pedidos</button>
          <button class="btn btn--ghost" data-close>Seguir mirando</button>
        </div>
      </div>`;
  } catch (e) {
    err.textContent = e.message;
    setBusy(btn, false);
    if (/stock|agot|disponible/i.test(e.message)) loadSite().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Panel de administración
// ---------------------------------------------------------------------------

function openAdmin(tab, bookId) {
  if (!isAdmin()) return;
  $$('dialog[open]').forEach((d) => d.close());
  if (tab) state.adminTab = tab;
  state.editingBook = bookId ? Number(bookId) : null;
  state.pendingCover = null;
  state.pendingPhoto = null;
  state.draftRecs = null;
  state.draftSocials = null;
  discardAppearance();
  openDialog('adminDialog');
  renderAdmin();
}

function renderAdmin() {
  $$('[data-admintab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.admintab === state.adminTab)));
  const body = $('#adminBody');
  const notice = state.me?.usingDefaultPassword
    ? `<div class="notice"><strong>Seguridad:</strong> la cuenta de administración usa la contraseña inicial. <button class="linkbtn" data-action="changepass">Cambiarla ahora</button></div>`
    : '';
  const render = {
    autor: adminAuthor,
    libros: adminBooks,
    recomendaciones: adminRecs,
    redes: adminSocials,
    pedidos: adminOrders,
    usuarios: adminUsers,
    apariencia: adminAppearance,
    ajustes: adminSettings,
  }[state.adminTab];
  body.innerHTML = notice + '<div id="adminContent"></div>';
  render($('#adminContent'));
  body.scrollTop = 0;
}

// --- Autor ---
function adminAuthor(el) {
  const a = state.site.author;
  const facts = [...(a.facts || [])];
  while (facts.length < 3) facts.push({ label: '', value: '' });
  const photo = state.pendingPhoto !== null ? state.pendingPhoto : a.photoUrl;
  el.innerHTML = `
    <p class="panel__intro">Lo que cambies acá se ve en la portada y en la sección Biografía apenas guardás.</p>
    <form class="form" id="authorForm" novalidate>
      <div class="field"><span class="fieldlabel">Foto</span>
        <div class="imgpick">
          <div class="imgpick__thumb">${photo ? `<img src="${esc(photo)}" alt="">` : 'Sin foto'}</div>
          <div class="form__actions form__actions--start">
            <span class="btn btn--small btn--ghost filebtn">Subir foto<input type="file" accept="image/png,image/jpeg,image/webp" data-upload="photo" aria-label="Subir foto"></span>
            ${photo ? '<button type="button" class="linkbtn linkbtn--danger" data-action="removephoto">Quitar</button>' : ''}
          </div>
        </div>
        <small>Vertical (4:5) se ve mejor. Se reduce automáticamente.</small>
      </div>
      <div class="form__grid">
        <div class="field"><label for="auName">Nombre</label><input id="auName" name="name" value="${esc(a.name)}" required></div>
        <div class="field"><label for="auRole">Profesión</label><input id="auRole" name="role" value="${esc(a.role)}" placeholder="Escritora, novelista, poeta…"></div>
        <div class="field form__full"><label for="auLine">Frase de portada</label><input id="auLine" name="heroLine" value="${esc(a.heroLine)}"></div>
        <div class="field form__full"><label for="auLoc">Origen y lugar de residencia</label><input id="auLoc" name="location" value="${esc(a.location)}"></div>
        <div class="field form__full"><label for="auBio">Biografía</label><textarea id="auBio" name="bio" rows="10">${esc(a.bio)}</textarea><small>Dejá una línea en blanco entre párrafos.</small></div>
        <div class="field form__full"><label for="auQuote">Cita destacada</label><input id="auQuote" name="quote" value="${esc(a.quote)}"></div>
      </div>
      <fieldset class="fieldset"><legend>Datos breves</legend>
        ${facts
          .slice(0, 6)
          .map(
            (f, i) => `<div class="form__grid">
          <div class="field"><label for="fl${i}">Dato ${i + 1}</label><input id="fl${i}" name="factLabel${i}" value="${esc(f.label)}" placeholder="Ej.: Traducciones"></div>
          <div class="field"><label for="fv${i}">Valor</label><input id="fv${i}" name="factValue${i}" value="${esc(f.value)}" placeholder="Ej.: Portugués, italiano"></div>
        </div>`
          )
          .join('')}
      </fieldset>
      <p class="form__error" role="alert"></p>
      <div class="form__actions"><button class="btn" type="submit">Guardar autor</button></div>
    </form>`;
}

async function saveAuthor(form) {
  const d = formData(form);
  const facts = [];
  for (let i = 0; i < 6; i++) {
    if (d['factLabel' + i] !== undefined) facts.push({ label: d['factLabel' + i], value: d['factValue' + i] });
  }
  const body = { name: d.name, role: d.role, heroLine: d.heroLine, location: d.location, bio: d.bio, quote: d.quote, facts };
  if (state.pendingPhoto !== null) body.photo = state.pendingPhoto;
  await adminSave(form, () => api('PUT', '/api/admin/content/author', body), 'Datos del autor guardados.');
  state.pendingPhoto = null;
}

// --- Libros ---
function adminBooks(el) {
  if (state.editingBook) return adminBookForm(el);
  const books = state.site.books;
  el.innerHTML = `
    <div class="panel__bar">
      <h3 class="panel__h">${books.length} ${books.length === 1 ? 'libro' : 'libros'}</h3>
      <button class="btn btn--small" data-action="newbook">Agregar libro</button>
    </div>
    ${books.length
      ? `<ul class="adminlist">${books
          .map(
            (b) => `<li class="adminrow">
        <div>${coverHTML(b, { small: true })}</div>
        <div>
          <p class="adminrow__title">${esc(b.title)}</p>
          <p class="adminrow__meta"><span>${money(b.price)}</span><span>Stock ${b.stock}</span>${[b.genre, b.year].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}
            ${!b.published ? '<span class="chip chip--hidden">Oculto</span>' : ''}${b.featured ? '<span class="chip chip--accent">Destacado</span>' : ''}${b.stock <= 0 ? '<span class="chip chip--out">Agotado</span>' : ''}</p>
        </div>
        <div class="adminrow__actions">
          <button class="btn btn--small btn--ghost" data-editbook="${b.id}">Editar</button>
          <button class="iconbtn iconbtn--danger" data-deletebook="${b.id}" aria-label="Borrar ${esc(b.title)}" title="Borrar">✕</button>
        </div>
      </li>`
          )
          .join('')}</ul>`
      : '<div class="empty">No hay libros cargados.</div>'}`;
}

function adminBookForm(el) {
  const isNew = state.editingBook === 'new';
  const b = isNew
    ? { title: '', subtitle: '', genre: 'Novela', year: new Date().getFullYear(), publisher: '', isbn: '', pages: '', format: 'Tapa blanda', price: '', stock: 0, synopsis: '', coverColor: '#22344f', coverUrl: '', published: true, featured: false, sort: state.site.books.length }
    : bookById(state.editingBook);
  if (!b) {
    state.editingBook = null;
    return adminBooks(el);
  }
  el.innerHTML = `
    <div class="panel__bar">
      <button class="linkbtn" data-action="backbooks">← Volver a la lista</button>
      ${!isNew ? `<button class="linkbtn linkbtn--danger" data-deletebook="${b.id}">Borrar libro</button>` : ''}
    </div>
    <form class="form" id="bookForm" novalidate>
      <div class="bookedit">
        <div class="bookedit__preview">
          <div id="bookPreview"></div>
          <span class="btn btn--small btn--ghost filebtn">Subir tapa<input type="file" accept="image/png,image/jpeg,image/webp" data-upload="cover" aria-label="Subir imagen de tapa"></span>
          <button type="button" class="linkbtn linkbtn--danger" data-action="removecover" id="removeCoverBtn">Quitar imagen</button>
          <div class="field"><label for="bkColor">Color de tapa</label><input id="bkColor" name="coverColor" type="color" value="${esc(b.coverColor || '#22344f')}"><small>Se usa si no subís imagen.</small></div>
        </div>
        <div class="form">
          <div class="form__grid">
            <div class="field form__full"><label for="bkTitle">Título</label><input id="bkTitle" name="title" value="${esc(b.title)}" required></div>
            <div class="field"><label for="bkSub">Subtítulo</label><input id="bkSub" name="subtitle" value="${esc(b.subtitle)}"></div>
            <div class="field"><label for="bkGenre">Género</label><input id="bkGenre" name="genre" value="${esc(b.genre)}" list="genres"><datalist id="genres"><option>Novela</option><option>Cuentos</option><option>Poesía</option><option>Ensayo</option><option>Crónicas</option><option>Infantil</option></datalist></div>
            <div class="field"><label for="bkPrice">Precio (ARS)</label><input id="bkPrice" name="price" type="number" min="0" step="100" inputmode="numeric" value="${esc(b.price)}" required></div>
            <div class="field"><label for="bkStock">Stock</label><input id="bkStock" name="stock" type="number" min="0" step="1" inputmode="numeric" value="${esc(b.stock)}"></div>
            <div class="field"><label for="bkPub">Editorial</label><input id="bkPub" name="publisher" value="${esc(b.publisher)}"></div>
            <div class="field"><label for="bkYear">Año</label><input id="bkYear" name="year" type="number" min="1800" max="2100" value="${esc(b.year)}"></div>
            <div class="field"><label for="bkPages">Páginas</label><input id="bkPages" name="pages" type="number" min="1" value="${esc(b.pages)}"></div>
            <div class="field"><label for="bkIsbn">ISBN</label><input id="bkIsbn" name="isbn" value="${esc(b.isbn)}"></div>
            <div class="field form__full"><label for="bkFormat">Formato</label><input id="bkFormat" name="format" value="${esc(b.format)}" placeholder="Tapa blanda, 14 × 21 cm"></div>
            <div class="field form__full"><label for="bkSyn">Sinopsis</label><textarea id="bkSyn" name="synopsis" rows="7">${esc(b.synopsis)}</textarea></div>
            <div class="field"><label for="bkSort">Orden en el estante</label><input id="bkSort" name="sort" type="number" value="${esc(b.sort)}"><small>Los números más bajos aparecen primero.</small></div>
          </div>
          <label class="check"><input type="checkbox" name="published" ${b.published ? 'checked' : ''}> Visible en la tienda</label>
          <label class="check"><input type="checkbox" name="featured" ${b.featured ? 'checked' : ''}> Destacar en la portada</label>
          <p class="form__error" role="alert"></p>
          <div class="form__actions">
            <button type="button" class="btn btn--ghost" data-action="backbooks">Cancelar</button>
            <button class="btn" type="submit">${isNew ? 'Crear libro' : 'Guardar cambios'}</button>
          </div>
        </div>
      </div>
    </form>`;
  renderBookPreview();
}

function renderBookPreview() {
  const form = $('#bookForm');
  if (!form) return;
  const current = state.editingBook === 'new' ? {} : bookById(state.editingBook) || {};
  const coverUrl = state.pendingCover !== null ? state.pendingCover : current.coverUrl || '';
  $('#bookPreview').innerHTML = coverHTML({
    title: form.elements.title.value || 'Título del libro',
    publisher: form.elements.publisher.value,
    genre: form.elements.genre.value,
    coverColor: form.elements.coverColor.value,
    coverUrl,
  });
  $('#removeCoverBtn').hidden = !coverUrl;
}

async function saveBook(form) {
  const d = formData(form);
  const body = {
    title: d.title,
    subtitle: d.subtitle,
    genre: d.genre,
    price: d.price,
    stock: d.stock,
    publisher: d.publisher,
    year: d.year,
    pages: d.pages,
    isbn: d.isbn,
    format: d.format,
    synopsis: d.synopsis,
    sort: d.sort,
    coverColor: d.coverColor,
    published: Boolean(d.published),
    featured: Boolean(d.featured),
  };
  if (state.pendingCover !== null) body.coverUrl = state.pendingCover;
  const isNew = state.editingBook === 'new';
  const ok = await adminSave(
    form,
    () => (isNew ? api('POST', '/api/admin/books', body) : api('PUT', `/api/admin/books/${state.editingBook}`, body)),
    isNew ? 'Libro creado.' : 'Libro guardado.',
    false
  );
  if (ok) {
    state.editingBook = null;
    state.pendingCover = null;
    renderAdmin();
  }
}

async function deleteBook(id) {
  const b = bookById(id);
  if (!b) return;
  const yes = await confirmAction(`¿Borrar “${b.title}”? Los pedidos que ya lo incluyen no se modifican.`);
  if (!yes) return;
  try {
    await api('DELETE', `/api/admin/books/${b.id}`);
    state.editingBook = null;
    state.cart = state.cart.filter((i) => i.id !== b.id);
    saveCart();
    await loadSite();
    renderAdmin();
    toast('Libro borrado.');
  } catch (e) {
    toast(e.message, true);
  }
}

// --- Listas editables (lecturas y redes) ---
function repeatEditor(el, { list, fields, title, addLabel, kind, intro }) {
  el.innerHTML = `
    <p class="panel__intro">${intro}</p>
    <div class="repeat">
      ${list
        .map(
          (item, i) => `<div class="repeat__item">
        <div class="repeat__tools">
          <span class="repeat__n">${title} ${i + 1}</span>
          <div class="iconbtns">
            <button type="button" class="iconbtn" data-move="${kind}" data-idx="${i}" data-dir="-1" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="iconbtn" data-move="${kind}" data-idx="${i}" data-dir="1" aria-label="Bajar" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="iconbtn iconbtn--danger" data-remove="${kind}" data-idx="${i}" aria-label="Quitar">✕</button>
          </div>
        </div>
        <div class="form__grid">
          ${fields
            .map(
              (f) => `<div class="field ${f.full ? 'form__full' : ''}">
            <label for="${kind}-${i}-${f.key}">${f.label}</label>
            ${f.textarea
              ? `<textarea id="${kind}-${i}-${f.key}" rows="3" style="min-height:84px" data-draft="${kind}" data-idx="${i}" data-key="${f.key}" placeholder="${esc(f.placeholder || '')}">${esc(item[f.key])}</textarea>`
              : `<input id="${kind}-${i}-${f.key}" value="${esc(item[f.key])}" data-draft="${kind}" data-idx="${i}" data-key="${f.key}" placeholder="${esc(f.placeholder || '')}">`}
          </div>`
            )
            .join('')}
        </div>
      </div>`
        )
        .join('')}
    </div>
    <p class="form__error" role="alert" id="repeatError"></p>
    <div class="form__actions" style="justify-content:space-between">
      <button type="button" class="btn btn--small btn--ghost" data-additem="${kind}">${addLabel}</button>
      <button type="button" class="btn" data-saverepeat="${kind}">Guardar cambios</button>
    </div>`;
}

function adminRecs(el) {
  if (!state.draftRecs) state.draftRecs = structuredClone(state.site.recommendations || []);
  repeatEditor(el, {
    list: state.draftRecs,
    kind: 'recs',
    title: 'Lectura',
    addLabel: 'Agregar lectura',
    intro: 'Libros que el autor recomienda. Se muestran en el orden de esta lista.',
    fields: [
      { key: 'title', label: 'Título' },
      { key: 'author', label: 'Autor' },
      { key: 'note', label: 'Por qué lo recomienda', textarea: true, full: true },
      { key: 'link', label: 'Enlace (opcional)', full: true, placeholder: 'https://' },
    ],
  });
}

function adminSocials(el) {
  if (!state.draftSocials) state.draftSocials = structuredClone(state.site.socials || []);
  repeatEditor(el, {
    list: state.draftSocials,
    kind: 'socials',
    title: 'Red',
    addLabel: 'Agregar red',
    intro: 'Redes y enlaces que aparecen en “Redes y contacto”. El email de contacto se edita en Ajustes.',
    fields: [
      { key: 'network', label: 'Nombre', placeholder: 'Instagram' },
      { key: 'handle', label: 'Usuario o texto', placeholder: '@usuario' },
      { key: 'url', label: 'Enlace', full: true, placeholder: 'https://' },
    ],
  });
}

const drafts = {
  recs: { get: () => state.draftRecs, blank: () => ({ id: '', title: '', author: '', note: '', link: '' }), key: 'recommendations', render: adminRecs },
  socials: { get: () => state.draftSocials, blank: () => ({ id: '', network: '', handle: '', url: '' }), key: 'socials', render: adminSocials },
};

async function saveRepeat(kind, btn) {
  const d = drafts[kind];
  const list = d.get().filter((x) => Object.entries(x).some(([k, v]) => k !== 'id' && String(v).trim()));
  setBusy(btn, true);
  try {
    await api('PUT', `/api/admin/content/${d.key}`, list);
    if (kind === 'recs') state.draftRecs = null;
    else state.draftSocials = null;
    await loadSite();
    toast('Cambios guardados.');
  } catch (e) {
    $('#repeatError').textContent = e.message;
    setBusy(btn, false);
  }
}

// --- Pedidos ---
async function loadAdminOrders() {
  const { orders } = await api('GET', '/api/admin/orders');
  state.adminOrders = orders;
  const pending = orders.filter((o) => o.status === 'pendiente').length;
  const c = $('#pendingCount');
  c.textContent = pending;
  c.hidden = !pending;
}

async function adminOrders(el, refresh = true) {
  if (refresh) {
    el.innerHTML = '<p class="loading">Cargando pedidos…</p>';
    try {
      await loadAdminOrders();
    } catch (e) {
      el.innerHTML = `<p class="form__error">${esc(e.message)}</p>`;
      return;
    }
  }
  const orders = state.adminOrders;
  const valid = orders.filter((o) => o.status !== 'cancelado');
  const count = (s) => orders.filter((o) => o.status === s).length;
  const shown = state.orderFilter === 'todos' ? orders : orders.filter((o) => o.status === state.orderFilter);
  el.innerHTML = `
    <dl class="stats">
      <div class="stat"><dt>Pendientes de pago</dt><dd>${count('pendiente')}</dd></div>
      <div class="stat"><dt>Pagados sin enviar</dt><dd>${count('pagado')}</dd></div>
      <div class="stat"><dt>Libros vendidos</dt><dd>${valid.reduce((s, o) => s + o.items.reduce((a, i) => a + i.qty, 0), 0)}</dd></div>
      <div class="stat"><dt>Facturado</dt><dd>${money(valid.filter((o) => o.status !== 'pendiente').reduce((s, o) => s + o.total, 0))}</dd></div>
    </dl>
    <div class="filterbar" role="group" aria-label="Filtrar por estado">
      ${['todos', ...STATUSES]
        .map((s) => `<button class="filter" data-orderfilter="${s}" aria-pressed="${state.orderFilter === s}">${s[0].toUpperCase() + s.slice(1)}${s !== 'todos' && count(s) ? ` · ${count(s)}` : ''}</button>`)
        .join('')}
    </div>
    ${shown.length ? `<div class="orders">${shown.map((o) => orderCard(o, true)).join('')}</div>` : '<div class="empty">No hay pedidos en este estado.</div>'}`;
}

async function changeOrderStatus(select) {
  const id = Number(select.dataset.orderstatus);
  const status = select.value;
  const order = state.adminOrders.find((o) => o.id === id);
  if (status === 'cancelado') {
    const yes = await confirmAction(`¿Cancelar el pedido ${orderNo(id)}? El stock de sus libros vuelve a la tienda y no se puede reactivar.`, 'Cancelar pedido');
    if (!yes) {
      select.value = order.status;
      return;
    }
  }
  try {
    await api('PUT', `/api/admin/orders/${id}`, { status });
    order.status = status;
    toast(`Pedido ${orderNo(id)}: ${status}.`);
    if (status === 'cancelado') await loadSite();
    adminOrders($('#adminContent'), true);
  } catch (e) {
    select.value = order.status;
    toast(e.message, true);
  }
}

// --- Usuarios ---
async function adminUsers(el) {
  el.innerHTML = '<p class="loading">Cargando usuarios…</p>';
  try {
    const { users } = await api('GET', '/api/admin/users');
    state.adminUsers = users;
  } catch (e) {
    el.innerHTML = `<p class="form__error">${esc(e.message)}</p>`;
    return;
  }
  const users = state.adminUsers;
  el.innerHTML = `
    <p class="panel__intro">Los lectores crean su cuenta al comprar. Desde acá podés crear cuentas a mano y dar acceso de administración a otra persona.</p>
    <div class="tablewrap">
      <table class="table">
        <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th class="num">Pedidos</th><th>Alta</th><th><span class="sr">Acciones</span></th></tr></thead>
        <tbody>${users
          .map(
            (u) => `<tr>
          <td>${esc(u.name)}${u.id === state.me.id ? ' <span class="muted">(vos)</span>' : ''}</td>
          <td>${esc(u.email)}</td>
          <td><select data-userrole="${u.id}" aria-label="Rol de ${esc(u.name)}" ${u.id === state.me.id ? 'disabled' : ''}>
            <option value="customer" ${u.role === 'customer' ? 'selected' : ''}>Comprador</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option></select></td>
          <td class="num">${u.orders}</td>
          <td class="muted">${fmtDate(u.createdAt).split(',')[0]}</td>
          <td>${u.id === state.me.id ? '' : `<button class="iconbtn iconbtn--danger" data-deleteuser="${u.id}" aria-label="Borrar ${esc(u.name)}" title="Borrar">✕</button>`}</td>
        </tr>`
          )
          .join('')}</tbody>
      </table>
    </div>
    <form class="form" id="newUserForm" novalidate style="margin-top:var(--s-6)">
      <h3 class="panel__h">Crear usuario</h3>
      <div class="form__grid">
        <div class="field"><label for="nuName">Nombre</label><input id="nuName" name="name" required></div>
        <div class="field"><label for="nuEmail">Email</label><input id="nuEmail" name="email" type="email" required></div>
        <div class="field"><label for="nuPass">Contraseña inicial</label><input id="nuPass" name="password" type="text" minlength="8" autocomplete="off" required><small>Mínimo 8 caracteres. Pasásela a la persona por un canal privado.</small></div>
        <div class="field"><label for="nuRole">Rol</label><select id="nuRole" name="role"><option value="customer">Comprador</option><option value="admin">Administrador</option></select></div>
      </div>
      <p class="form__error" role="alert"></p>
      <div class="form__actions"><button class="btn" type="submit">Crear usuario</button></div>
    </form>`;
}

// --- Ajustes ---
function adminSettings(el) {
  const s = state.site.settings;
  el.innerHTML = `
    <form class="form" id="settingsForm" novalidate>
      <div class="form__grid">
        <div class="field"><label for="stName">Nombre del sitio</label><input id="stName" name="siteName" value="${esc(s.siteName)}" required><small>Aparece en la pestaña del navegador y en la cabecera.</small></div>
        <div class="field"><label for="stMail">Email de contacto</label><input id="stMail" name="contactEmail" type="email" value="${esc(s.contactEmail)}"></div>
        <div class="field"><label for="stShip">Costo de envío (ARS)</label><input id="stShip" name="shippingCost" type="number" min="0" step="100" value="${esc(s.shippingCost)}"><small>Poné 0 si el envío es siempre gratis.</small></div>
        <div class="field"><label for="stFree">Envío gratis desde (ARS)</label><input id="stFree" name="freeShippingFrom" type="number" min="0" step="1000" value="${esc(s.freeShippingFrom)}"><small>Poné 0 para no ofrecer envío gratis.</small></div>
        <div class="field form__full"><label for="stPay">Instrucciones de pago</label><textarea id="stPay" name="paymentInstructions" rows="5">${esc(s.paymentInstructions)}</textarea><small>Se muestran al comprador cuando confirma el pedido y van en su mail de confirmación. Podés poner tu alias, CBU o link de pago.</small></div>
      </div>
      <fieldset class="fieldset"><legend>Mails de pedidos</legend>
        ${mailStatusHTML()}
        <div class="field"><label for="stNotify">Email del vendedor (avisos de pedidos)</label><input id="stNotify" name="notifyEmail" type="email" value="${esc(s.notifyEmail)}" placeholder="${esc(s.contactEmail || 'tu@email.com')}"><small>Acá te llega un mail por cada compra. Si lo dejás vacío se usa el email de contacto.</small></div>
        <div class="form__actions form__actions--start">
          <button type="button" class="btn btn--small btn--ghost" data-action="testemail" ${state.site.mail?.configured ? '' : 'disabled'}>Enviar mail de prueba</button>
          <span class="muted" id="testEmailResult" style="font-size:.85rem"></span>
        </div>
      </fieldset>
      <p class="form__error" role="alert"></p>
      <div class="form__actions"><button class="btn" type="submit">Guardar ajustes</button></div>
    </form>`;
}

function mailStatusHTML() {
  const m = state.site.mail || {};
  const names = { brevo: 'Brevo', smtp: 'SMTP', consola: 'modo prueba (se muestran en la consola del servidor)' };
  if (m.configured) {
    return `<div class="mailstatus mailstatus--ok"><strong>Mails activos.</strong> Se envían con ${esc(names[m.provider] || m.provider)}${m.from ? ` desde <strong>${esc(m.from)}</strong>` : ''}. Cada pedido manda una confirmación al comprador y un aviso al vendedor.</div>`;
  }
  return `<div class="mailstatus mailstatus--off"><strong>Mails desactivados.</strong> ${esc(m.problem || 'Falta configurar BREVO_API_KEY y MAIL_FROM en el servidor (ver README).')} Los pedidos se registran igual.</div>`;
}

// --- Apariencia ---
function colorField(key, label, value) {
  return `<div class="field">
    <label for="ap-${key}">${label}</label>
    <div class="colorpick">
      <input type="color" id="ap-${key}" name="${key}" value="${esc(value)}">
      <input type="text" name="${key}Hex" value="${esc(value)}" maxlength="7" spellcheck="false" autocomplete="off" aria-label="${label} en código hexadecimal">
    </div>
  </div>`;
}

function presetActive(p, a) {
  if (!p.custom) return !a.custom;
  return a.custom && p.textColor === a.textColor && p.bgColor === a.bgColor && p.accentColor === a.accentColor;
}

function swatchesHTML(a) {
  const D = SiteTheme.DEFAULTS;
  return SiteTheme.PRESETS.map((p) => {
    const text = p.custom ? p.textColor : D.textColor;
    const bg = p.custom ? p.bgColor : D.bgColor;
    const accent = p.custom ? p.accentColor : D.accentColor;
    return `<button type="button" class="swatch" data-preset="${p.id}" aria-pressed="${presetActive(p, a)}">
      <span class="swatch__chip" style="background:${bg};color:${text}">Aa<i style="background:${accent}"></i></span>
      <span class="swatch__name">${esc(p.name)}</span></button>`;
  }).join('');
}

function warningsHTML(a) {
  const w = SiteTheme.warnings(a);
  return w.length ? `<div class="notice" style="margin:0">${w.map(esc).join('<br>')}</div>` : '';
}

function adminAppearance(el) {
  if (!state.draftAppearance) state.draftAppearance = { ...state.site.appearance };
  const a = state.draftAppearance;
  applyAppearance(a);
  el.innerHTML = `
    <p class="panel__intro">Lo que cambies se ve en vivo en la página de atrás. Se aplica a todos los visitantes recién cuando guardás.</p>
    <form class="form" id="appearanceForm" novalidate>
      <fieldset class="fieldset fieldset--first"><legend>Tamaño de letra</legend>
        <div class="scale">
          <span class="scale__a scale__a--sm" aria-hidden="true">A</span>
          <input type="range" id="apScale" name="fontScale" min="85" max="130" step="5" value="${a.fontScale}" aria-label="Tamaño de letra">
          <span class="scale__a scale__a--lg" aria-hidden="true">A</span>
          <output id="apScaleVal" for="apScale">${a.fontScale}%</output>
        </div>
        <small class="muted">100% es el tamaño original. Agranda o achica los textos de todo el sitio.</small>
      </fieldset>
      <fieldset class="fieldset"><legend>Paletas listas</legend>
        <div class="swatches" id="apSwatches">${swatchesHTML(a)}</div>
        <small class="muted">“Original” usa el diseño de fábrica, que cambia solo a modo oscuro según la configuración de cada visitante.</small>
      </fieldset>
      <fieldset class="fieldset"><legend>Colores</legend>
        <label class="check"><input type="checkbox" name="custom" ${a.custom ? 'checked' : ''}> Usar estos colores en todo el sitio</label>
        <div class="colors" id="apColors" ${a.custom ? '' : 'data-off'}>
          ${colorField('textColor', 'Letras', a.textColor)}
          ${colorField('bgColor', 'Fondo', a.bgColor)}
          ${colorField('accentColor', 'Acento (botones y enlaces)', a.accentColor)}
        </div>
        <div id="apWarnings">${warningsHTML(a)}</div>
      </fieldset>
      <p class="form__error" role="alert"></p>
      <div class="form__actions" style="justify-content:space-between">
        <button type="button" class="linkbtn" data-action="resetappearance">Volver al diseño original</button>
        <div class="form__actions" style="padding:0">
          <button type="button" class="btn btn--ghost" data-action="discardappearance">Descartar</button>
          <button class="btn" type="submit">Guardar apariencia</button>
        </div>
      </div>
    </form>`;
}

function readAppearanceForm(form, source) {
  const a = state.draftAppearance;
  const f = form.elements;
  a.fontScale = Number(f.fontScale.value);
  a.custom = f.custom.checked;
  const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v);
  for (const k of ['textColor', 'bgColor', 'accentColor']) {
    if (source && source.name === k + 'Hex') {
      let v = source.value.trim();
      if (v && v[0] !== '#') v = '#' + v;
      if (isHex(v)) {
        a[k] = v.toLowerCase();
        f[k].value = a[k];
      }
    } else {
      a[k] = f[k].value.toLowerCase();
      if (f[k + 'Hex'] !== source) f[k + 'Hex'].value = a[k];
    }
  }
  // Tocar un color activa los colores personalizados.
  if (source && /Color/.test(source.name) && !a.custom) {
    a.custom = true;
    f.custom.checked = true;
  }
  $('#apScaleVal').textContent = a.fontScale + '%';
  $('#apColors').toggleAttribute('data-off', !a.custom);
  $('#apSwatches').innerHTML = swatchesHTML(a);
  $('#apWarnings').innerHTML = warningsHTML(a);
  applyAppearance(a);
}

function discardAppearance() {
  if (!state.draftAppearance) return;
  state.draftAppearance = null;
  applyAppearance(state.site.appearance);
}

async function adminSave(form, fn, okMsg, rerender = true) {
  const err = $('.form__error', form);
  if (err) err.textContent = '';
  const btn = $('button[type=submit]', form);
  setBusy(btn, true);
  try {
    await fn();
    await loadSite();
    if (rerender) renderAdmin();
    toast(okMsg);
    return true;
  } catch (e) {
    if (err) err.textContent = e.message;
    else toast(e.message, true);
    setBusy(btn, false);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

document.addEventListener('click', async (e) => {
  const t = e.target;

  // clic en el fondo de un diálogo lo cierra
  if (t instanceof HTMLDialogElement && t.id !== 'confirmDialog') {
    const r = t.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) t.close();
    return;
  }

  const el = t.closest('button, a, [data-close]');
  if (!el) return;
  const ds = el.dataset;

  if ('close' in ds) return closeDialog(el.closest('dialog'));
  if (ds.confirm) {
    closeDialog('confirmDialog');
    confirmResolve?.(ds.confirm === 'yes');
    confirmResolve = null;
    return;
  }
  if ('closeCart' in ds) return closeDialog('cartDialog');
  if ('closeAccount' in ds) return closeDialog('accountDialog');
  if (ds.panel) return openAdmin(ds.panel);
  if (ds.editbook) return openAdmin('libros', ds.editbook);
  if (ds.book && !ds.add) return openBook(ds.book);
  if (ds.add) {
    addToCart(Number(ds.add));
    if ('closeAfter' in ds) closeDialog('bookDialog');
    return;
  }
  if (ds.qty) return changeQty(Number(ds.qty), Number(ds.delta));
  if (ds.copy) {
    try {
      await navigator.clipboard.writeText(ds.copy);
      toast('Email copiado.');
    } catch {
      toast(ds.copy);
    }
    return;
  }
  if (ds.authtab) return setAuthTab(ds.authtab);
  if (ds.accounttab) {
    state.accountTab = ds.accounttab;
    return renderAccount();
  }
  if (ds.admintab) {
    discardAppearance();
    state.adminTab = ds.admintab;
    state.editingBook = null;
    state.pendingCover = null;
    state.pendingPhoto = null;
    return renderAdmin();
  }
  if (ds.orderfilter) {
    state.orderFilter = ds.orderfilter;
    return adminOrders($('#adminContent'), false);
  }
  if (ds.deletebook) return deleteBook(Number(ds.deletebook));
  if (ds.deleteuser) {
    const u = state.adminUsers.find((x) => x.id === Number(ds.deleteuser));
    if (!u) return;
    if (!(await confirmAction(`¿Borrar la cuenta de ${u.name}? Sus pedidos quedan registrados.`))) return;
    try {
      await api('DELETE', `/api/admin/users/${u.id}`);
      toast('Usuario borrado.');
      adminUsers($('#adminContent'));
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }
  if (ds.additem) {
    const d = drafts[ds.additem];
    d.get().push(d.blank());
    d.render($('#adminContent'));
    const items = $$('.repeat__item');
    items[items.length - 1]?.querySelector('input, textarea')?.focus();
    return;
  }
  if (ds.move) {
    const list = drafts[ds.move].get();
    const i = Number(ds.idx);
    const j = i + Number(ds.dir);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    return drafts[ds.move].render($('#adminContent'));
  }
  if (ds.remove) {
    drafts[ds.remove].get().splice(Number(ds.idx), 1);
    return drafts[ds.remove].render($('#adminContent'));
  }
  if (ds.saverepeat) return saveRepeat(ds.saverepeat, el);
  if (ds.preset) {
    const p = SiteTheme.PRESETS.find((x) => x.id === ds.preset);
    const a = state.draftAppearance;
    if (!p || !a) return;
    if (p.custom) Object.assign(a, { custom: true, textColor: p.textColor, bgColor: p.bgColor, accentColor: p.accentColor });
    else Object.assign(a, { custom: false, textColor: SiteTheme.DEFAULTS.textColor, bgColor: SiteTheme.DEFAULTS.bgColor, accentColor: SiteTheme.DEFAULTS.accentColor });
    return adminAppearance($('#adminContent'));
  }
  if (ds.resend) {
    setBusy(el, true, 'Enviando…');
    try {
      const { emailStatus } = await api('POST', `/api/admin/orders/${ds.resend}/resend`, {});
      const o = state.adminOrders.find((x) => x.id === Number(ds.resend));
      if (o) o.emailStatus = emailStatus;
      toast(emailStatus.error ? 'No se pudieron enviar todos los mails.' : 'Mails enviados.', Boolean(emailStatus.error));
      adminOrders($('#adminContent'), false);
    } catch (err) {
      setBusy(el, false);
      toast(err.message, true);
    }
    return;
  }

  switch (ds.action) {
    case 'logout':
      return logout();
    case 'checkout':
      return openCheckout();
    case 'myorders':
      closeDialog('checkoutDialog');
      return openAccount('pedidos');
    case 'newbook':
      state.editingBook = 'new';
      state.pendingCover = null;
      return renderAdmin();
    case 'backbooks':
      state.editingBook = null;
      state.pendingCover = null;
      return renderAdmin();
    case 'removecover':
      state.pendingCover = '';
      return renderBookPreview();
    case 'removephoto':
      state.pendingPhoto = '';
      return adminAuthor($('#adminContent'));
    case 'resetappearance':
      state.draftAppearance = { ...SiteTheme.DEFAULTS };
      return adminAppearance($('#adminContent'));
    case 'discardappearance':
      discardAppearance();
      return adminAppearance($('#adminContent'));
    case 'testemail': {
      const out = $('#testEmailResult');
      const to = $('#stNotify')?.value.trim() || undefined;
      setBusy(el, true, 'Enviando…');
      out.textContent = '';
      try {
        const r = await api('POST', '/api/admin/test-email', { to });
        out.textContent = `Enviado a ${r.to}. Revisá la bandeja (y spam).`;
      } catch (err) {
        out.textContent = err.message;
      }
      setBusy(el, false);
      return;
    }
    case 'changepass':
      closeDialog('adminDialog');
      return openAccount('clave');
  }
});

$('#accountBtn').addEventListener('click', () => (state.me ? openAccount() : openAuth('login')));
$('#cartBtn').addEventListener('click', openCart);

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.draft) {
    const list = drafts[t.dataset.draft].get();
    list[Number(t.dataset.idx)][t.dataset.key] = t.value;
    return;
  }
  if (t.form && t.form.id === 'bookForm' && ['title', 'publisher', 'genre', 'coverColor'].includes(t.name)) renderBookPreview();
  if (t.form && t.form.id === 'appearanceForm') readAppearanceForm(t.form, t);
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.form && t.form.id === 'checkoutForm' && t.name === 'method') return renderCheckoutTotals();
  if (t.form && t.form.id === 'appearanceForm' && t.name === 'custom') return readAppearanceForm(t.form, t);
  if (t.dataset.orderstatus) return changeOrderStatus(t);
  if (t.dataset.userrole) {
    try {
      await api('PUT', `/api/admin/users/${t.dataset.userrole}`, { role: t.value });
      toast('Rol actualizado.');
    } catch (err) {
      toast(err.message, true);
      adminUsers($('#adminContent'));
    }
    return;
  }
  if (t.dataset.upload) {
    const file = t.files && t.files[0];
    if (!file) return;
    try {
      if (t.dataset.upload === 'cover') {
        state.pendingCover = await fileToDataUrl(file, 700, 1050);
        renderBookPreview();
      } else {
        state.pendingPhoto = await fileToDataUrl(file, 1000, 1250);
        // conserva lo que ya se escribió en el formulario
        const form = $('#authorForm');
        const values = formData(form);
        adminAuthor($('#adminContent'));
        const nf = $('#authorForm');
        Object.entries(values).forEach(([k, v]) => {
          if (nf.elements[k]) nf.elements[k].value = v;
        });
      }
    } catch (err) {
      toast(err.message, true);
    }
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target;
  e.preventDefault();
  const err = $('.form__error', form);
  if (err) err.textContent = '';
  const btn = $('button[type=submit]', form);

  try {
    switch (form.id) {
      case 'loginForm': {
        setBusy(btn, true, 'Ingresando…');
        const res = await api('POST', '/api/auth/login', formData(form));
        form.reset();
        setBusy(btn, false);
        return afterLogin(res.me);
      }
      case 'registerForm': {
        setBusy(btn, true, 'Creando cuenta…');
        const res = await api('POST', '/api/auth/register', formData(form));
        form.reset();
        setBusy(btn, false);
        return afterLogin(res.me);
      }
      case 'adminLoginForm': {
        $('#adminLoginError').textContent = '';
        setBusy(btn, true, 'Entrando…');
        const res = await api('POST', '/api/auth/login', { ...formData(form), adminOnly: true });
        form.reset();
        setBusy(btn, false);
        state.me = res.me;
        await loadSite();
        await loadAdminOrders().catch(() => {});
        toast('Entraste como administrador.');
        return openAdmin('autor');
      }
      case 'profileForm': {
        setBusy(btn, true);
        const d = formData(form);
        const res = await api('PUT', '/api/me', {
          name: d.name,
          phone: d.phone,
          address: { fullName: d.fullName, street: d.street, city: d.city, province: d.province, zip: d.zip },
        });
        state.me = { ...state.me, ...res.me };
        renderHeader();
        setBusy(btn, false);
        return toast('Datos guardados.');
      }
      case 'passwordForm': {
        setBusy(btn, true);
        await api('PUT', '/api/me/password', formData(form));
        form.reset();
        setBusy(btn, false);
        if (state.me) state.me.usingDefaultPassword = false;
        renderAccount();
        return toast('Contraseña actualizada.');
      }
      case 'checkoutForm':
        return submitCheckout(form);
      case 'authorForm':
        return saveAuthor(form);
      case 'bookForm':
        return saveBook(form);
      case 'appearanceForm': {
        const a = { ...state.draftAppearance };
        const ok = await adminSave(form, () => api('PUT', '/api/admin/content/appearance', a), 'Apariencia guardada.', false);
        if (ok) {
          state.draftAppearance = null;
          applyAppearance(state.site.appearance);
          adminAppearance($('#adminContent'));
        }
        return;
      }
      case 'settingsForm':
        return adminSave(form, () => api('PUT', '/api/admin/content/settings', formData(form)), 'Ajustes guardados.');
      case 'newUserForm': {
        setBusy(btn, true, 'Creando…');
        await api('POST', '/api/admin/users', formData(form));
        toast('Usuario creado.');
        return adminUsers($('#adminContent'));
      }
    }
  } catch (ex) {
    setBusy(btn, false);
    const target = form.id === 'adminLoginForm' ? $('#adminLoginError') : err;
    if (target) target.textContent = ex.message;
    else toast(ex.message, true);
  }
});

// Cerrar el panel sin guardar deshace la vista previa de apariencia.
$('#adminDialog').addEventListener('close', discardAppearance);

// Escape en el diálogo de confirmación equivale a "Cancelar".
$('#confirmDialog').addEventListener('close', () => {
  confirmResolve?.(false);
  confirmResolve = null;
});

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------

loadCart();
loadSite()
  .then(() => (isAdmin() ? loadAdminOrders().catch(() => {}) : null))
  .catch((e) => {
    $('#main').innerHTML = `<div class="wrap" style="padding-block:6rem"><p class="empty">${esc(e.message)}</p></div>`;
  });
