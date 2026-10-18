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
  // Toda escritura va como JSON (también los DELETE sin datos).
  if (body !== undefined || method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body === undefined ? {} : body);
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
  comments: { enabled: true, moderation: false, rules: '', comments: [] },
  commentsShown: 10,
  commentFilter: 'todos',
  editingComment: null,
  draftLayout: null,
  editingSection: null,
  pendingSectionImage: null,
  draftFaq: null,
  inquiries: [],
  inquiryFilter: 'nueva',
  stats: null,
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
  loadComments();
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

function ratingHTML(r, big = false) {
  if (!r || !r.count) return '';
  const avg = String(r.avg).replace('.', ',');
  return `<span class="rating${big ? ' rating--big' : ''}" aria-label="${avg} de 5 estrellas, ${r.count} ${r.count === 1 ? 'opinión' : 'opiniones'}">
    <span class="rating__stars" style="--r:${Number(r.avg)}" aria-hidden="true">★★★★★</span>${avg}<span class="rating__n">(${r.count})</span></span>`;
}

// ---------------------------------------------------------------------------
// Orden de secciones y secciones propias
// ---------------------------------------------------------------------------

const BUILTIN = {
  obra: { title: 'Obra', nav: 'Obra', heading: '#obraTitle', type: 'Libros a la venta' },
  biografia: { title: 'Biografía', nav: 'Biografía', heading: '#bioTitle', type: 'Foto, biografía y datos del autor' },
  lecturas: { title: 'Lecturas recomendadas', nav: 'Lecturas', heading: '#recTitle', type: 'Libros que recomienda' },
  comentarios: { title: 'Comentarios', nav: 'Comentarios', heading: '#comTitle', type: 'Comentarios y puntuaciones' },
  consultas: { title: 'Dudas y consultas', nav: 'Consultas', heading: '#faqTitle', type: 'Preguntas frecuentes y formulario' },
  redes: { title: 'Redes y contacto', nav: 'Redes', heading: '#socialTitle', type: 'Redes sociales y email' },
};

function customSectionHTML(sec) {
  const hasImg = Boolean(sec.imageUrl);
  return `<div class="wrap">
    <div class="section__head">
      <h2 class="section__title">${esc(sec.title)}</h2>
      ${sec.eyebrow ? `<p class="section__note">${esc(sec.eyebrow)}</p>` : ''}
      <button class="editbtn" data-editsection="${esc(sec.id)}" ${isAdmin() ? '' : 'hidden'}>Editar sección</button>
    </div>
    <div class="custom${hasImg ? '' : ' custom--noimg'}${sec.imageSide === 'izquierda' ? ' custom--left' : ''}">
      <div class="custom__body">
        <div class="custom__text">${paragraphs(sec.body)}</div>
        ${sec.buttonText && sec.buttonUrl ? `<a class="btn" href="${esc(sec.buttonUrl)}" target="_blank" rel="noopener">${esc(sec.buttonText)}</a>` : ''}
      </div>
      ${hasImg ? `<div class="custom__media"><img src="${esc(sec.imageUrl)}" alt="" loading="lazy"></div>` : ''}
    </div>
  </div>`;
}

function applyLayout() {
  const layout = state.site.layout || [];
  const sections = state.site.sections || [];
  const main = $('#main');
  // Secciones propias: se crean o actualizan.
  $$('section[data-custom]', main).forEach((el) => {
    if (!sections.some((s) => s.id === el.id)) el.remove();
  });
  for (const sec of sections) {
    let el = document.getElementById(sec.id);
    if (!el) {
      el = document.createElement('section');
      el.className = 'section';
      el.id = sec.id;
      el.dataset.custom = '1';
    }
    el.innerHTML = customSectionHTML(sec);
    main.appendChild(el);
  }
  // Orden, visibilidad, títulos y franjas alternadas.
  let i = 0;
  const nav = [];
  for (const entry of layout) {
    const el = document.getElementById(entry.key);
    if (!el) continue;
    main.appendChild(el);
    const b = BUILTIN[entry.key];
    const sec = sections.find((x) => x.id === entry.key);
    if (b) {
      const h = $(b.heading);
      if (h) h.textContent = entry.title || b.title;
    }
    const visible = entry.visible !== false && !el.dataset.empty;
    el.hidden = !visible;
    if (!visible) continue;
    el.classList.toggle('section--band', i % 2 === 1);
    i++;
    nav.push({ id: entry.key, label: b ? entry.title && entry.title.length <= 18 ? entry.title : b.nav : sec ? sec.title : entry.key });
  }
  $('.mainnav').innerHTML = nav.map((n) => `<a href="#${esc(n.id)}">${esc(n.label)}</a>`).join('');
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
  renderFaq();
  applyLayout();
  if ($('#adminDialog').open) renderAdmin();
}

function applyAppearance(a) {
  const tag = $('#appearanceStyle');
  if (!tag || !window.SiteTheme) return;
  tag.textContent = SiteTheme.css(a);
  const link = $('#fontsLink');
  const href = SiteTheme.fontsHref(a);
  if (link && link.getAttribute('href') !== href) link.setAttribute('href', href);
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
          ${ratingHTML(b.rating)}
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
  if (!recs.length && !isAdmin()) $('#lecturas').dataset.empty = '1';
  else delete $('#lecturas').dataset.empty;
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

function renderFaq() {
  const faq = state.site.faq || [];
  $('#faqList').innerHTML = faq.length
    ? faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')
    : '<p class="muted">Todavía no hay preguntas cargadas.</p>';
  $('.ask__faq').hidden = !faq.length && !isAdmin();
  const form = $('#inquiryForm');
  if (form && state.me) {
    if (!form.elements.name.value) form.elements.name.value = state.me.name;
    if (!form.elements.email.value) form.elements.email.value = state.me.email;
  }
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
// Comentarios
// ---------------------------------------------------------------------------

async function loadComments() {
  try {
    state.comments = await api('GET', '/api/comments');
  } catch {
    state.comments = { enabled: true, moderation: false, rules: '', comments: [], error: true };
  }
  renderComments();
  if ($('#adminDialog').open && state.adminTab === 'comentarios') adminComments($('#adminContent'));
}

function commentHTML(c, { admin = isAdmin(), ctx = 'p' } = {}) {
  const editing = state.editingComment === c.id;
  const badges = [];
  if (c.status === 'oculto') badges.push('<span class="chip chip--hidden">Oculto</span>');
  if (c.status === 'pendiente') badges.push(`<span class="chip chip--low">${admin ? 'Pendiente de aprobación' : 'Esperando aprobación'}</span>`);
  if (admin && c.reports) badges.push(`<span class="chip chip--out">${c.reports} ${c.reports === 1 ? 'denuncia' : 'denuncias'}</span>`);
  const actions = [];
  if (admin) {
    actions.push(`<button class="linkbtn" data-editcomment="${c.id}">Editar</button>`);
    if (c.status === 'pendiente') actions.push(`<button class="linkbtn" data-commentstatus="${c.id}" data-to="visible">Aprobar</button>`);
    if (c.status === 'visible') actions.push(`<button class="linkbtn" data-commentstatus="${c.id}" data-to="oculto">Ocultar</button>`);
    if (c.status === 'oculto') actions.push(`<button class="linkbtn" data-commentstatus="${c.id}" data-to="visible">Mostrar</button>`);
    if (c.reports) actions.push(`<button class="linkbtn" data-clearreports="${c.id}">Quitar denuncias</button>`);
    actions.push(`<button class="linkbtn linkbtn--danger" data-deletecomment="${c.id}">Borrar</button>`);
  } else if (c.mine) {
    actions.push(`<button class="linkbtn linkbtn--danger" data-deletecomment="${c.id}">Borrar mi comentario</button>`);
  } else if (state.me && c.status === 'visible') {
    actions.push(c.reportedByMe
      ? '<span>Denunciado</span>'
      : `<button class="linkbtn" data-reportcomment="${c.id}">Denunciar</button>`);
  }
  return `<li class="comment${c.status === 'oculto' ? ' is-hidden' : ''}${c.status === 'pendiente' ? ' is-pending' : ''}" data-comment="${c.id}">
    <span class="comment__avatar" aria-hidden="true">${esc(c.authorInitials)}</span>
    <div class="comment__main">
      <div class="comment__head">
        <span class="comment__name">${esc(c.author)}</span>
        ${c.rating ? `<span class="rating" aria-label="${c.rating} de 5 estrellas"><span class="rating__stars" style="--r:${c.rating}" aria-hidden="true">★★★★★</span></span>` : ''}
        <span class="comment__meta">${fmtDate(c.createdAt).split(',')[0]}${c.bookTitle ? ` · sobre <em>${esc(c.bookTitle)}</em>` : ''}${admin && c.authorEmail ? ` · ${esc(c.authorEmail)}` : ''}</span>
        ${c.verified ? '<span class="chip chip--verified">Compró el libro</span>' : ''}
        ${badges.join(' ')}
      </div>
      ${editing
        ? `<form class="comment__edit" data-commentform="${c.id}">
            <label class="sr" for="ce-${ctx}-${c.id}">Editar comentario</label>
            <textarea id="ce-${ctx}-${c.id}" name="body" maxlength="1000">${esc(c.body)}</textarea>
            <div class="form__actions form__actions--start">
              <button class="btn btn--small" type="submit">Guardar</button>
              <button class="btn btn--small btn--ghost" type="button" data-canceledit>Cancelar</button>
            </div>
          </form>`
        : `<p class="comment__body">${esc(c.body)}</p>`}
      <div class="comment__foot">
        ${c.editedByAdmin ? '<span class="comment__edited">Editado por moderación</span>' : ''}
        ${actions.join('')}
      </div>
    </div>
  </li>`;
}

function composeKey() {
  const C = state.comments;
  return [state.me && state.me.id, C.me && C.me.hasPurchase, ((C.me && C.me.purchasedBookIds) || []).join('.'), state.site.books.length].join('|');
}

function updateRateField() {
  const sel = $('#cmBook');
  if (!sel) return;
  const bought = new Set((state.comments.me && state.comments.me.purchasedBookIds) || []);
  const can = bought.has(Number(sel.value));
  $('#cmRateField').hidden = !can;
  $('#cmRateHint').hidden = can;
  if (!can) $$('#cmRateField input').forEach((i) => (i.checked = false));
}

function renderComments() {
  const C = state.comments;
  const section = $('#comentarios');
  if (!C.enabled && !isAdmin()) section.dataset.empty = '1';
  else delete section.dataset.empty;
  const visible = C.comments.filter((c) => c.status === 'visible');
  $('#comNote').textContent = visible.length
    ? `${visible.length} ${visible.length === 1 ? 'comentario' : 'comentarios'} de lectores`
    : 'Contá qué te pareció un libro o dejale un mensaje a la autora.';

  // Formulario
  const compose = $('#comCompose');
  const rules = C.rules ? `<p class="comments__rules">${esc(C.rules)}</p>` : '';
  if (!C.enabled) {
    compose.innerHTML = `<div class="comments__cta"><p>Los comentarios están cerrados por ahora.</p>${isAdmin() ? '<small class="muted">Podés abrirlos en Panel → Ajustes.</small>' : ''}</div>`;
  } else if (!state.me) {
    compose.innerHTML = `<div class="comments__cta">
        <p>Para comentar necesitás una cuenta. Es la misma que se usa para comprar.</p>
        <button class="btn btn--small" data-action="logincomment">Ingresar o crear cuenta</button>
      </div>${rules}`;
  } else if (C.buyersOnly && !isAdmin() && !(C.me && C.me.hasPurchase)) {
    compose.innerHTML = `<div class="comments__cta">
        <p>Podés comentar y puntuar los libros cuando se aprueba tu primera compra.</p>
        <a class="btn btn--small" href="#obra">Ver los libros</a>
      </div>${rules}`;
  } else if (!$('#commentForm') || $('#commentForm').dataset.key !== composeKey()) {
    const books = state.site.books.filter((b) => b.published);
    const bought = new Set((C.me && C.me.purchasedBookIds) || []);
    compose.innerHTML = `
      <form class="comments__form" id="commentForm" novalidate data-key="${composeKey()}">
        <div class="field"><label for="cmBody">Tu comentario</label>
          <textarea id="cmBody" name="body" maxlength="1000" placeholder="Escribí lo que quieras compartir…" required></textarea></div>
        <span class="comments__count" id="cmCount">0 / 1000</span>
        <div class="field"><label for="cmBook">Sobre</label>
          <select id="cmBook" name="bookId"><option value="">Comentario general</option>${books.map((b) => `<option value="${b.id}">${esc(b.title)}${bought.has(b.id) ? ' · lo compraste' : ''}</option>`).join('')}</select></div>
        <div class="field" id="cmRateField" hidden>
          <span class="fieldlabel">Tu puntuación (opcional)</span>
          <div class="stars-input" role="radiogroup" aria-label="Puntuación de 1 a 5 estrellas">
            ${[5, 4, 3, 2, 1].map((n) => `<input type="radio" id="cmR${n}" name="rating" value="${n}"><label for="cmR${n}" title="${n} ${n === 1 ? 'estrella' : 'estrellas'}">★</label>`).join('')}
          </div>
        </div>
        <p class="hint" id="cmRateHint">${bought.size ? 'Elegí un libro que compraste para puntuarlo.' : 'Podés puntuar los libros que compres.'}</p>
        <p class="form__error" role="alert"></p>
        <div class="form__actions form__actions--start">
          <button class="btn" type="submit">Publicar</button>
          <span class="muted" style="font-size:.85rem">Publicás como ${esc(state.me.name)}</span>
        </div>
        ${C.moderation && !isAdmin() ? '<p class="hint">Los comentarios se publican después de que los revisemos.</p>' : ''}
      </form>${rules}`;
  }

  // Lista
  const list = $('#comList');
  const shown = C.comments.filter((c) => isAdmin() || c.status === 'visible' || c.mine);
  if (C.error) {
    list.innerHTML = '<li class="comments__empty">No se pudieron cargar los comentarios. Probá recargar la página.</li>';
  } else if (!shown.length) {
    list.innerHTML = `<li class="comments__empty">${C.enabled ? 'Todavía no hay comentarios. Podés ser la primera persona en escribir.' : 'No hay comentarios.'}</li>`;
  } else {
    list.innerHTML = shown.slice(0, state.commentsShown).map((c) => commentHTML(c)).join('');
  }
  const rest = shown.length - state.commentsShown;
  $('#comMore').innerHTML = rest > 0 ? `<button class="btn btn--ghost btn--small" data-action="morecomments">Ver ${Math.min(rest, 10)} comentarios más</button>` : '';
  updateRateField();
  applyLayout();
}

function adminComments(el) {
  const all = state.comments.comments;
  const count = (f) => all.filter(f).length;
  const filters = {
    todos: ['Todos', () => true],
    denunciados: ['Denunciados', (c) => c.reports > 0],
    pendiente: ['Pendientes', (c) => c.status === 'pendiente'],
    oculto: ['Ocultos', (c) => c.status === 'oculto'],
    visible: ['Visibles', (c) => c.status === 'visible'],
  };
  const [, fn] = filters[state.commentFilter] || filters.todos;
  const shown = all.filter(fn);
  el.innerHTML = `
    <p class="panel__intro">Podés editar, ocultar o borrar los comentarios que no cumplan las normas. Un comentario editado muestra “Editado por moderación”. Las normas y la aprobación previa se configuran en Ajustes.</p>
    <dl class="stats">
      <div class="stat"><dt>Visibles</dt><dd>${count((c) => c.status === 'visible')}</dd></div>
      <div class="stat"><dt>Pendientes</dt><dd>${count((c) => c.status === 'pendiente')}</dd></div>
      <div class="stat"><dt>Con denuncias</dt><dd>${count((c) => c.reports > 0)}</dd></div>
      <div class="stat"><dt>Ocultos</dt><dd>${count((c) => c.status === 'oculto')}</dd></div>
    </dl>
    <div class="filterbar" role="group" aria-label="Filtrar comentarios">
      ${Object.entries(filters)
        .map(([k, [label, f]]) => `<button class="filter" data-commentfilter="${k}" aria-pressed="${state.commentFilter === k}">${label}${k !== 'todos' && count(f) ? ` · ${count(f)}` : ''}</button>`)
        .join('')}
    </div>
    ${shown.length ? `<ol class="comments__list">${shown.map((c) => commentHTML(c, { admin: true, ctx: 'a' })).join('')}</ol>` : '<div class="empty">No hay comentarios en esta vista.</div>'}`;
}

async function commentAction(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
  } catch (err) {
    toast(err.message, true);
  }
  state.editingComment = null;
  await loadComments();
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
        ${b.rating ? `<div>${ratingHTML(b.rating, true)} <a class="linkbtn" href="#comentarios" data-close-book>Ver opiniones</a></div>` : ''}
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
  openDialog('authDialog');
  if (tab === 'login' || tab === 'register') setTimeout(() => (tab === 'login' ? $('#loginEmail') : $('#regName')).focus(), 50);
}

function setAuthTab(tab) {
  const recovering = tab === 'forgot' || tab === 'sent';
  $('#loginForm').hidden = tab !== 'login';
  $('#registerForm').hidden = tab !== 'register';
  $('#forgotForm').hidden = tab !== 'forgot';
  $('#forgotSent').hidden = tab !== 'sent';
  $('#authDialog .tabs').hidden = recovering;
  $('#tabLogin').setAttribute('aria-selected', String(tab === 'login'));
  $('#tabRegister').setAttribute('aria-selected', String(tab === 'register'));
  $('#authTitle').textContent = recovering ? 'Recuperar tu cuenta' : 'Tu cuenta';
  $('#authLead').hidden = recovering;
  $$('#authDialog .form__error').forEach((e) => (e.textContent = ''));
  if (tab === 'forgot') {
    const mail = state.site?.settings?.contactEmail;
    $('#forgotContact').textContent = mail ? ` a ${mail}` : '';
    const typed = $('#loginEmail').value || $('#adminEmail').value;
    if (typed && !$('#forgotEmail').value) $('#forgotEmail').value = typed;
    setTimeout(() => $('#forgotEmail').focus(), 30);
  }
}

async function openReset(token) {
  const body = $('#resetBody');
  body.innerHTML = '<p class="loading">Revisando el link…</p>';
  openDialog('resetDialog');
  let info = { valid: false };
  try {
    info = await api('GET', `/api/auth/reset?t=${encodeURIComponent(token)}`);
  } catch {
    /* se muestra como link inválido */
  }
  if (!info.valid) {
    body.innerHTML = `
      <p class="modal__lead">Este link venció o ya se usó. Los links sirven una sola vez y duran una hora.</p>
      <button class="btn btn--block" data-action="forgot">Pedir un link nuevo</button>`;
    return;
  }
  body.innerHTML = `
    <form class="form" id="resetForm" novalidate>
      <input type="hidden" name="token" value="${esc(token)}">
      <div class="field"><label>Tu usuario</label><input value="${esc(info.email)}" autocomplete="username" readonly></div>
      <div class="field"><label for="rsPass">Contraseña nueva</label><input id="rsPass" name="password" type="password" autocomplete="new-password" minlength="8" required><small>Mínimo 8 caracteres.</small></div>
      <div class="field"><label for="rsPass2">Repetila</label><input id="rsPass2" name="password2" type="password" autocomplete="new-password" required></div>
      <p class="form__error" role="alert"></p>
      <button class="btn btn--block" type="submit">Guardar y entrar</button>
    </form>`;
  setTimeout(() => $('#rsPass')?.focus(), 30);
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

const MP_STATUS = {
  approved: 'aprobado',
  pending: 'pendiente',
  in_process: 'en revisión',
  rejected: 'rechazado',
  cancelled: 'cancelado',
  refunded: 'devuelto',
  charged_back: 'contracargo',
};

function paymentLine(o, admin) {
  if (o.paymentMethod !== 'mercadopago') return 'Pago: transferencia';
  let txt = 'Pago: Mercado Pago';
  if (o.mpStatus) txt += ` · ${MP_STATUS[o.mpStatus] || esc(o.mpStatus)}`;
  else if (o.status === 'pendiente') txt += ' · sin pagar todavía';
  if (admin && o.mpPaymentId) txt += ` · operación ${esc(o.mpPaymentId)}`;
  return txt;
}

async function payOrder(id, btn) {
  setBusy(btn, true, 'Abriendo Mercado Pago…');
  try {
    const { payUrl } = await api('POST', `/api/orders/${id}/pay`, {});
    window.location.href = payUrl;
  } catch (err) {
    setBusy(btn, false);
    toast(err.message, true);
  }
}

// Vuelta desde Mercado Pago: se confirma el pago consultando al servidor.
async function handlePaymentReturn() {
  const q = new URLSearchParams(location.search);
  const paymentId = q.get('payment_id') || q.get('collection_id');
  const orderId = Number(q.get('external_reference')) || null;
  try {
    history.replaceState(null, '', '/');
  } catch {
    /* sin historial */
  }
  const body = $('#checkoutBody');
  body.innerHTML = '<p class="loading">Confirmando el pago con Mercado Pago…</p>';
  openDialog('checkoutDialog');
  let r = { status: q.get('status') || 'null', orderId };
  if (paymentId && paymentId !== 'null') {
    try {
      r = await api('POST', '/api/mp/confirm', { paymentId });
    } catch (err) {
      body.innerHTML = `<h2 class="modal__title">No pudimos confirmar el pago</h2><p class="modal__lead">${esc(err.message)}</p>
        <div class="form__actions form__actions--start"><button class="btn" data-action="myorders">Ver mis pedidos</button></div>`;
      return;
    }
  }
  const num = r.orderId ? orderNo(r.orderId) : '';
  const views = {
    approved: ['Pago aprobado', `¡Listo! Mercado Pago acreditó el pago del pedido ${num}. Te mandamos la confirmación por mail.`, false],
    pending: ['Pago pendiente', `Mercado Pago está procesando el pago del pedido ${num}. Cuando se acredite, el pedido pasa a “pagado” solo y te avisamos por mail.`, false],
    in_process: ['Pago en revisión', `Mercado Pago está revisando el pago del pedido ${num}. Suele resolverse en unos minutos; te avisamos por mail.`, false],
  };
  const [title, text, retry] = views[r.status] || [
    'El pago no se completó',
    `No se cobró nada. Tu pedido ${num} sigue guardado: podés intentar de nuevo con otra tarjeta o medio de pago.`,
    true,
  ];
  body.innerHTML = `
    <div class="success">
      <p class="eyebrow">Mercado Pago</p>
      <h2 class="modal__title">${title}</h2>
      <p class="modal__lead" style="margin:0">${text}</p>
      <div class="form__actions form__actions--start">
        ${retry && r.orderId ? `<button class="btn" data-pay="${r.orderId}">Intentar pagar de nuevo</button>` : ''}
        <button class="btn ${retry ? 'btn--ghost' : ''}" data-action="myorders">Ver mis pedidos</button>
      </div>
    </div>`;
  loadSite().catch(() => {});
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
    <div class="order__pay">${paymentLine(o, admin)}</div>
    ${admin ? emailLine(o) : ''}
    <div class="order__foot">
      <span class="order__total">Total ${money(o.total)}</span>
      ${!admin && o.status === 'pendiente' && state.site.payments?.mercadopago
        ? `<button class="btn btn--small" data-pay="${o.id}">Pagar con Mercado Pago</button>`
        : ''}
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
    <p class="modal__lead">Revisá tus datos y elegí cómo pagar.</p>
    <form class="form" id="checkoutForm" novalidate>
      <span class="fieldlabel">Entrega</span>
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
      <span class="fieldlabel">Pago</span>
      <div class="segmented" role="radiogroup" aria-label="Forma de pago">
        ${state.site.payments?.mercadopago
          ? '<label><input type="radio" name="payment" value="mercadopago" checked><span>Mercado Pago</span><small>Tarjeta, débito o dinero en cuenta</small></label>'
          : ''}
        <label><input type="radio" name="payment" value="transferencia" ${state.site.payments?.mercadopago ? '' : 'checked'}><span>Transferencia</span><small>Te mandamos los datos por mail</small></label>
      </div>
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
  const btn = $('#checkoutForm button[type=submit]');
  if (btn) btn.textContent = form.elements.payment?.value === 'mercadopago' ? 'Confirmar e ir a pagar' : 'Confirmar pedido';
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
      payment: d.payment,
      address: { fullName: d.fullName, street: d.street, city: d.city, province: d.province, zip: d.zip },
    });
    state.cart = [];
    saveCart();
    if (res.payUrl) {
      $('#checkoutBody').innerHTML = `
        <div class="success">
          <p class="eyebrow">Pedido ${orderNo(res.order.id)} guardado</p>
          <h2 class="modal__title">Te llevamos a Mercado Pago…</h2>
          <p class="modal__lead" style="margin:0">Si no pasa nada en unos segundos, <a href="${esc(res.payUrl)}">tocá acá para pagar</a>.</p>
        </div>`;
      window.location.href = res.payUrl;
      return;
    }
    await loadSite();
    $('#checkoutBody').innerHTML = `
      <div class="success">
        <p class="eyebrow">Pedido recibido</p>
        <span class="success__num">${orderNo(res.order.id)}</span>
        <p class="modal__lead" style="margin:0">Total ${money(res.order.total)}. ${res.emailSent
          ? `Te mandamos la confirmación a <strong>${esc(state.me.email)}</strong>. Si no la ves en unos minutos, revisá la carpeta de spam.`
          : 'Guardá este número de pedido. También lo vas a encontrar en Mi cuenta.'}</p>
        ${res.payError
          ? `<div class="notice" style="margin:0">${esc(res.payError)}</div>`
          : res.paymentInstructions ? `<div class="success__box">${esc(res.paymentInstructions)}</div>` : ''}
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
    comentarios: adminComments,
    estadisticas: adminStats,
    secciones: adminSections,
    consultas: adminInquiries,
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
  recs: { get: () => state.draftRecs, blank: () => ({ id: '', title: '', author: '', note: '', link: '' }), key: 'recommendations', render: () => adminRecs($('#adminContent')) },
  socials: { get: () => state.draftSocials, blank: () => ({ id: '', network: '', handle: '', url: '' }), key: 'socials', render: () => adminSocials($('#adminContent')) },
  faq: { get: () => state.draftFaq, blank: () => ({ id: '', q: '', a: '' }), key: 'faq', render: () => renderFaqEditor() },
};

async function saveRepeat(kind, btn) {
  const d = drafts[kind];
  const list = d.get().filter((x) => Object.entries(x).some(([k, v]) => k !== 'id' && String(v).trim()));
  setBusy(btn, true);
  try {
    await api('PUT', `/api/admin/content/${d.key}`, list);
    if (kind === 'recs') state.draftRecs = null;
    else if (kind === 'faq') state.draftFaq = null;
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
          <td><div class="adminrow__actions">
            <button class="linkbtn" style="font-size:.82rem;white-space:nowrap" data-sendreset="${u.id}" ${state.site.mail?.configured ? '' : 'disabled title="Configurá los mails para usar esta opción"'}>Enviar link de contraseña</button>
            ${u.id === state.me.id ? '' : `<button class="iconbtn iconbtn--danger" data-deleteuser="${u.id}" aria-label="Borrar ${esc(u.name)}" title="Borrar">✕</button>`}
          </div></td>
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
      <fieldset class="fieldset"><legend>Visitas</legend>
        <label class="check"><input type="checkbox" name="showCounter" ${s.showCounter !== false ? 'checked' : ''}> Mostrar en el pie el total de visitas y las personas en línea</label>
      </fieldset>
      <fieldset class="fieldset"><legend>Comentarios</legend>
        <label class="check"><input type="checkbox" name="commentsEnabled" ${s.commentsEnabled !== false ? 'checked' : ''}> Permitir comentarios</label>
        <label class="check"><input type="checkbox" name="commentsBuyersOnly" ${s.commentsBuyersOnly !== false ? 'checked' : ''}> Solo pueden comentar quienes tienen una compra aprobada</label>
        <label class="check"><input type="checkbox" name="commentsModeration" ${s.commentsModeration ? 'checked' : ''}> Revisar cada comentario antes de publicarlo</label>
        <div class="field"><label for="stRules">Normas que se muestran junto al formulario</label><textarea id="stRules" name="commentRules" rows="3" style="min-height:84px">${esc(s.commentRules || '')}</textarea></div>
      </fieldset>
      <fieldset class="fieldset"><legend>Mails de pedidos</legend>
        ${mailStatusHTML()}
        <div class="field"><label for="stNotify">Email del vendedor (avisos de pedidos)</label><input id="stNotify" name="notifyEmail" type="email" value="${esc(s.notifyEmail)}" placeholder="${esc(s.contactEmail || 'tu@email.com')}"><small>Acá te llega un mail por cada compra. Si lo dejás vacío se usa el email de contacto.</small></div>
        <div class="form__actions form__actions--start">
          <button type="button" class="btn btn--small btn--ghost" data-action="testemail" ${state.site.mail?.configured ? '' : 'disabled'}>Enviar mail de prueba</button>
          <span class="muted" id="testEmailResult" style="font-size:.85rem"></span>
        </div>
        <div class="maillog">
          <div class="panel__bar" style="margin:0"><span class="fieldlabel">Últimos envíos</span><button type="button" class="linkbtn" data-action="refreshlog" style="font-size:.82rem">Actualizar</button></div>
          <div id="mailLog"><p class="loading">Cargando…</p></div>
        </div>
      </fieldset>
      <p class="form__error" role="alert"></p>
      <div class="form__actions"><button class="btn" type="submit">Guardar ajustes</button></div>
    </form>`;
  loadMailLog();
}

async function loadMailLog() {
  const box = $('#mailLog');
  if (!box) return;
  try {
    const { log } = await api('GET', '/api/admin/mail-log');
    box.innerHTML = log.length
      ? `<ul class="maillog__list">${log
          .slice(0, 15)
          .map(
            (e) => `<li class="${e.ok ? '' : 'is-err'}">
          <span class="maillog__mark" aria-label="${e.ok ? 'Enviado' : 'Falló'}">${e.ok ? '✓' : '✕'}</span>
          <span class="maillog__main"><strong>${esc(e.subject || 'Mail')}</strong> · ${esc(e.to)}${e.error ? `<br><span class="maillog__err">${esc(e.error)}</span>` : ''}</span>
          <span class="maillog__time">${fmtDate(e.at)}</span></li>`
          )
          .join('')}</ul>`
      : '<p class="muted" style="margin:.4rem 0 0;font-size:.85rem">Todavía no se intentó enviar ningún mail.</p>';
  } catch (err) {
    box.innerHTML = `<p class="form__error">${esc(err.message)}</p>`;
  }
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

function fontCardsHTML(a) {
  return SiteTheme.FONTS.map((f) => `<button type="button" class="fontcard" data-font="${f.id}" aria-pressed="${a.font === f.id}">
      <span class="fontcard__aa" style="font-family:${esc(f.display)}">Aa Bb</span>
      <span class="fontcard__text" style="font-family:${esc(f.text)}">El tiempo en una casa vacía</span>
      <span class="fontcard__name" style="font-family:${esc(f.ui)}">${esc(f.name)}</span>
    </button>`).join('');
}

function loadAllFonts() {
  if ($('#allFontsLink')) return;
  const l = document.createElement('link');
  l.id = 'allFontsLink';
  l.rel = 'stylesheet';
  l.href = SiteTheme.allFontsHref();
  document.head.appendChild(l);
}

function adminAppearance(el) {
  loadAllFonts();
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
      <fieldset class="fieldset"><legend>Tipografía</legend>
        <div class="fontgrid" id="apFonts">${fontCardsHTML(a)}</div>
        <small class="muted">Cada opción combina una letra para títulos, otra para textos largos y otra para botones y menús.</small>
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

// --- Estadísticas ---
async function adminStats(el) {
  el.innerHTML = '<p class="loading">Cargando estadísticas…</p>';
  try {
    state.stats = await api('GET', '/api/admin/stats');
  } catch (err) {
    el.innerHTML = `<p class="form__error">${esc(err.message)}</p>`;
    return;
  }
  const st = state.stats;
  const max = Math.max(3, ...st.days.map((d) => d.views));
  const step = Math.ceil(max / 3);
  const top = step * 3;
  const ddmm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const last30 = st.days.reduce((n, d) => n + d.views, 0);
  el.innerHTML = `
    <p class="panel__intro">Una visita es una sesión: si la misma persona recarga la página en menos de 30 minutos, no se cuenta de nuevo. Tus propias visitas como administrador no se cuentan.</p>
    <dl class="stats">
      <div class="stat"><dt>En línea ahora</dt><dd><span class="livedot" aria-hidden="true"></span> ${numFmt.format(st.online)}</dd></div>
      <div class="stat"><dt>Visitas hoy</dt><dd>${numFmt.format(st.today.views)}</dd></div>
      <div class="stat"><dt>Visitantes hoy</dt><dd>${numFmt.format(st.today.uniques)}</dd></div>
      <div class="stat"><dt>Visitas totales</dt><dd>${numFmt.format(st.total)}</dd></div>
    </dl>
    <div class="panel__bar"><h3 class="panel__h">Visitas por día · últimos 30 días</h3><span class="muted" style="font-size:.85rem">${numFmt.format(last30)} en total</span></div>
    <div class="vchart" id="vchart">
      <div class="vchart__y" aria-hidden="true"><span>${top}</span><span>${step * 2}</span><span>${step}</span><span>0</span></div>
      <div class="vchart__plot" role="list" aria-label="Visitas por día">
        <div class="vchart__grid" aria-hidden="true"></div>
        ${st.days
          .map(
            (d, i) => `<div class="vchart__bar" role="listitem" tabindex="0" data-i="${i}" aria-label="${ddmm(d.day)}: ${d.views} visitas, ${d.uniques} visitantes">
            <i style="height:${(d.views / top) * 100}%"></i></div>`
          )
          .join('')}
      </div>
      <div class="vchart__x" aria-hidden="true">${st.days.map((d, i) => `<span>${i % 5 === 4 || i === 0 ? ddmm(d.day) : ''}</span>`).join('')}</div>
    </div>
    <details style="margin-top:var(--s-5)"><summary class="linkbtn">Ver los números en una tabla</summary>
      <div class="tablewrap" style="margin-top:var(--s-3)"><table class="table" style="min-width:0">
        <thead><tr><th>Día</th><th class="num">Visitas</th><th class="num">Visitantes</th></tr></thead>
        <tbody>${[...st.days].reverse().map((d) => `<tr><td>${ddmm(d.day)}</td><td class="num">${d.views}</td><td class="num">${d.uniques}</td></tr>`).join('')}</tbody>
      </table></div>
    </details>
    <div class="form__actions form__actions--start" style="margin-top:var(--s-5)"><button class="btn btn--small btn--ghost" data-admintab="estadisticas">Actualizar</button></div>`;
}

function showChartTip(bar) {
  const st = state.stats;
  const chart = $('#vchart');
  if (!st || !chart || !bar) return;
  const d = st.days[Number(bar.dataset.i)];
  let tip = $('.vchart__tip', chart);
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'vchart__tip';
    chart.appendChild(tip);
  }
  tip.innerHTML = `<strong>${d.day.slice(8, 10)}/${d.day.slice(5, 7)}</strong><br>${d.views} ${d.views === 1 ? 'visita' : 'visitas'} · ${d.uniques} ${d.uniques === 1 ? 'visitante' : 'visitantes'}`;
  const cr = chart.getBoundingClientRect();
  const br = bar.getBoundingClientRect();
  const fill = bar.querySelector('i').getBoundingClientRect();
  const x = Math.min(Math.max(br.left + br.width / 2 - cr.left, 70), cr.width - 70);
  tip.style.left = `${x}px`;
  tip.style.top = `${Math.min(fill.top, br.bottom - 4) - cr.top}px`;
  tip.hidden = false;
}

// --- Secciones ---
function adminSections(el) {
  if (state.editingSection) return adminSectionForm(el);
  if (!state.draftLayout) state.draftLayout = structuredClone(state.site.layout || []);
  const L = state.draftLayout;
  const sections = state.site.sections || [];
  el.innerHTML = `
    <p class="panel__intro">Ordená las secciones de arriba hacia abajo, ocultá las que no uses y cambiales el nombre. La portada siempre va primero. El menú se arma solo con las secciones visibles.</p>
    <ol class="layoutlist">
      ${L.map((e, i) => {
        const b = BUILTIN[e.key];
        const sec = sections.find((x) => x.id === e.key);
        return `<li class="layoutrow${e.visible === false ? ' is-off' : ''}">
          <div class="iconbtns">
            <button type="button" class="iconbtn" data-lmove="${i}" data-dir="-1" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="iconbtn" data-lmove="${i}" data-dir="1" aria-label="Bajar" ${i === L.length - 1 ? 'disabled' : ''}>↓</button>
          </div>
          <div class="layoutrow__main">
            ${b
              ? `<input value="${esc(e.title)}" placeholder="${esc(b.title)}" data-ltitle="${i}" aria-label="Título de la sección ${esc(b.title)}">`
              : `<span class="layoutrow__fixed">${esc(sec ? sec.title : e.key)}</span>`}
            <span class="layoutrow__type">${b ? esc(b.type) : 'Sección propia'}</span>
          </div>
          <div class="layoutrow__side">
            <label class="check"><input type="checkbox" data-lvisible="${i}" ${e.visible !== false ? 'checked' : ''}> Visible</label>
            ${sec ? `<button type="button" class="btn btn--small btn--ghost" data-editsection="${esc(sec.id)}">Editar</button>` : ''}
          </div>
        </li>`;
      }).join('')}
    </ol>
    <p class="form__error" role="alert" id="layoutError"></p>
    <div class="form__actions" style="justify-content:space-between">
      <button type="button" class="btn btn--small btn--ghost" data-action="newsection" ${sections.length >= 12 ? 'disabled' : ''}>Agregar sección</button>
      <button type="button" class="btn" data-action="savelayout">Guardar orden</button>
    </div>`;
}

function adminSectionForm(el) {
  const isNew = state.editingSection === 'new';
  const sec = isNew
    ? { id: '', title: '', eyebrow: '', body: '', imageSide: 'derecha', buttonText: '', buttonUrl: '', imageUrl: '' }
    : (state.site.sections || []).find((x) => x.id === state.editingSection);
  if (!sec) {
    state.editingSection = null;
    return adminSections(el);
  }
  const img = state.pendingSectionImage !== null ? state.pendingSectionImage : sec.imageUrl;
  el.innerHTML = `
    <div class="panel__bar">
      <button class="linkbtn" data-action="backsections">← Volver a las secciones</button>
      ${!isNew ? `<button class="linkbtn linkbtn--danger" data-deletesection="${esc(sec.id)}">Borrar sección</button>` : ''}
    </div>
    <form class="form" id="sectionForm" novalidate>
      <div class="form__grid">
        <div class="field"><label for="scTitle">Título</label><input id="scTitle" name="title" value="${esc(sec.title)}" maxlength="80" required></div>
        <div class="field"><label for="scEyebrow">Bajada (opcional)</label><input id="scEyebrow" name="eyebrow" value="${esc(sec.eyebrow)}" maxlength="60" placeholder="Una línea junto al título"></div>
        <div class="field form__full"><label for="scBody">Texto</label><textarea id="scBody" name="body" rows="9">${esc(sec.body)}</textarea><small>Dejá una línea en blanco entre párrafos.</small></div>
        <div class="field"><label for="scBtnText">Texto del botón (opcional)</label><input id="scBtnText" name="buttonText" value="${esc(sec.buttonText)}" maxlength="40" placeholder="Ej.: Inscribirme al taller"></div>
        <div class="field"><label for="scBtnUrl">Enlace del botón</label><input id="scBtnUrl" name="buttonUrl" value="${esc(sec.buttonUrl)}" placeholder="https://"></div>
      </div>
      <div class="field"><span class="fieldlabel">Imagen (opcional)</span>
        <div class="imgpick">
          <div class="imgpick__thumb">${img ? `<img src="${esc(img)}" alt="">` : 'Sin imagen'}</div>
          <div class="form__actions form__actions--start">
            <span class="btn btn--small btn--ghost filebtn">Subir imagen<input type="file" accept="image/png,image/jpeg,image/webp" data-upload="section" aria-label="Subir imagen"></span>
            ${img ? '<button type="button" class="linkbtn linkbtn--danger" data-action="removesectionimg">Quitar</button>' : ''}
          </div>
        </div>
      </div>
      <div class="field"><label for="scSide">Posición de la imagen</label>
        <select id="scSide" name="imageSide"><option value="derecha" ${sec.imageSide !== 'izquierda' ? 'selected' : ''}>A la derecha del texto</option><option value="izquierda" ${sec.imageSide === 'izquierda' ? 'selected' : ''}>A la izquierda del texto</option></select></div>
      <p class="form__error" role="alert"></p>
      <div class="form__actions">
        <button type="button" class="btn btn--ghost" data-action="backsections">Cancelar</button>
        <button class="btn" type="submit">${isNew ? 'Crear sección' : 'Guardar sección'}</button>
      </div>
    </form>`;
}

async function saveSection(form) {
  const d = formData(form);
  const list = (state.site.sections || []).map((x) => ({ ...x, image: undefined }));
  const item = {
    id: state.editingSection === 'new' ? '' : state.editingSection,
    title: d.title,
    eyebrow: d.eyebrow,
    body: d.body,
    imageSide: d.imageSide,
    buttonText: d.buttonText,
    buttonUrl: d.buttonUrl,
  };
  if (state.pendingSectionImage !== null) item.image = state.pendingSectionImage;
  if (state.editingSection === 'new') list.push(item);
  else list[list.findIndex((x) => x.id === state.editingSection)] = item;
  // Las que no se tocan conservan su imagen (el servidor la mantiene si no viene una nueva).
  const ok = await adminSave(form, () => api('PUT', '/api/admin/content/sections', list), 'Sección guardada.', false);
  if (ok) {
    state.editingSection = null;
    state.pendingSectionImage = null;
    state.draftLayout = null;
    renderAdmin();
  }
}

// --- Consultas ---
async function loadInquiries() {
  const { inquiries } = await api('GET', '/api/admin/inquiries');
  state.inquiries = inquiries;
  const n = inquiries.filter((q) => q.status === 'nueva').length;
  const c = $('#inquiryCount');
  c.textContent = n;
  c.hidden = !n;
}

function inquiryHTML(q) {
  const mailOk = state.site.mail?.configured;
  return `<article class="inquiry">
    <div class="order__head">
      <div><strong>${esc(q.name)}</strong> <span class="order__date">· ${esc(q.email)} · ${fmtDate(q.createdAt)}</span></div>
      <span class="chip ${q.status === 'nueva' ? 'chip--low' : q.status === 'respondida' ? 'chip--ok' : 'chip--hidden'}">${esc(q.status)}</span>
    </div>
    <p class="inquiry__msg">${esc(q.message)}</p>
    ${q.reply ? `<p class="inquiry__reply"><strong>Tu respuesta (${fmtDate(q.repliedAt).split(',')[0]}):</strong><br>${esc(q.reply)}</p>` : ''}
    ${q.status !== 'archivada'
      ? `<form class="form" data-replyform="${q.id}" novalidate>
          <label class="sr" for="rp-${q.id}">Respuesta</label>
          <textarea id="rp-${q.id}" name="reply" placeholder="${mailOk ? 'Escribí la respuesta. Se envía por mail a ' + esc(q.email) : 'Activá los mails para responder desde acá, o escribile a ' + esc(q.email)}" ${mailOk ? '' : 'disabled'}></textarea>
          <p class="form__error" role="alert"></p>
          <div class="form__actions" style="justify-content:space-between">
            <div class="form__actions form__actions--start" style="padding:0">
              <button type="button" class="linkbtn" data-inqstatus="${q.id}" data-to="archivada">Archivar</button>
              ${q.status === 'nueva' ? `<button type="button" class="linkbtn" data-inqstatus="${q.id}" data-to="respondida">Marcar como respondida</button>` : ''}
              <button type="button" class="linkbtn" data-copy="${esc(q.email)}">Copiar email</button>
              <button type="button" class="linkbtn linkbtn--danger" data-deleteinq="${q.id}">Borrar</button>
            </div>
            <button class="btn btn--small" type="submit" ${mailOk ? '' : 'disabled'}>${q.reply ? 'Enviar otra respuesta' : 'Responder por mail'}</button>
          </div>
        </form>`
      : `<div class="form__actions form__actions--start"><button type="button" class="linkbtn" data-inqstatus="${q.id}" data-to="nueva">Volver a la bandeja</button><button type="button" class="linkbtn linkbtn--danger" data-deleteinq="${q.id}">Borrar</button></div>`}
  </article>`;
}

function renderInquiryList() {
  const box = $('#inquiryList');
  if (!box) return;
  const all = state.inquiries;
  const count = (st) => all.filter((q) => q.status === st).length;
  const shown = state.inquiryFilter === 'todas' ? all : all.filter((q) => q.status === state.inquiryFilter);
  box.innerHTML = `
    <div class="filterbar" role="group" aria-label="Filtrar consultas">
      ${[['nueva', 'Nuevas'], ['respondida', 'Respondidas'], ['archivada', 'Archivadas'], ['todas', 'Todas']]
        .map(([k, label]) => `<button class="filter" data-inqfilter="${k}" aria-pressed="${state.inquiryFilter === k}">${label}${k !== 'todas' && count(k) ? ` · ${count(k)}` : ''}</button>`)
        .join('')}
    </div>
    ${shown.length ? `<div class="orders">${shown.map(inquiryHTML).join('')}</div>` : '<div class="empty">No hay consultas en esta bandeja.</div>'}`;
}

function renderFaqEditor() {
  const box = $('#faqEditor');
  if (!box) return;
  if (!state.draftFaq) state.draftFaq = structuredClone(state.site.faq || []);
  repeatEditor(box, {
    list: state.draftFaq,
    kind: 'faq',
    title: 'Pregunta',
    addLabel: 'Agregar pregunta',
    intro: 'Se muestran en la sección “Dudas y consultas”, en este orden.',
    fields: [
      { key: 'q', label: 'Pregunta', full: true },
      { key: 'a', label: 'Respuesta', textarea: true, full: true },
    ],
  });
}

async function adminInquiries(el) {
  el.innerHTML = `
    <p class="panel__intro">Las consultas llegan desde el formulario de la sección “Dudas y consultas”. También te llega un mail por cada una, que podés responder desde tu correo.</p>
    <div id="inquiryList"><p class="loading">Cargando consultas…</p></div>
    <h3 class="panel__h" style="margin:var(--s-7) 0 var(--s-3)">Preguntas frecuentes</h3>
    <div id="faqEditor"></div>`;
  renderFaqEditor();
  try {
    await loadInquiries();
    renderInquiryList();
  } catch (err) {
    $('#inquiryList').innerHTML = `<p class="form__error">${esc(err.message)}</p>`;
  }
}

async function inquiryAction(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    await loadInquiries();
    renderInquiryList();
  } catch (err) {
    toast(err.message, true);
  }
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
    state.editingSection = null;
    state.draftLayout = null;
    state.draftFaq = null;
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
  if (ds.pay) return payOrder(Number(ds.pay), el);
  if (ds.editcomment) {
    state.editingComment = Number(ds.editcomment);
    renderComments();
    if ($('#adminDialog').open && state.adminTab === 'comentarios') adminComments($('#adminContent'));
    const ta = $('#adminDialog').open ? $(`#ce-a-${ds.editcomment}`) : $(`#ce-p-${ds.editcomment}`);
    ta?.focus();
    return;
  }
  if ('canceledit' in ds) {
    state.editingComment = null;
    renderComments();
    if ($('#adminDialog').open && state.adminTab === 'comentarios') adminComments($('#adminContent'));
    return;
  }
  if (ds.commentstatus) {
    const labels = { visible: 'Comentario visible.', oculto: 'Comentario oculto.' };
    return commentAction(() => api('PUT', `/api/admin/comments/${ds.commentstatus}`, { status: ds.to }), labels[ds.to]);
  }
  if (ds.clearreports) return commentAction(() => api('PUT', `/api/admin/comments/${ds.clearreports}`, { clearReports: true }), 'Denuncias quitadas.');
  if (ds.deletecomment) {
    if (!(await confirmAction('¿Borrar este comentario? No se puede deshacer.'))) return;
    return commentAction(() => api('DELETE', `/api/comments/${ds.deletecomment}`), 'Comentario borrado.');
  }
  if (ds.reportcomment) {
    if (!(await confirmAction('¿Denunciar este comentario? La moderación lo va a revisar.', 'Denunciar'))) return;
    return commentAction(() => api('POST', `/api/comments/${ds.reportcomment}/report`, {}), 'Gracias, lo vamos a revisar.');
  }
  if (ds.commentfilter) {
    state.commentFilter = ds.commentfilter;
    return adminComments($('#adminContent'));
  }
  if (ds.deletebook) return deleteBook(Number(ds.deletebook));
  if (ds.sendreset) {
    const u = state.adminUsers.find((x) => x.id === Number(ds.sendreset));
    if (!u) return;
    if (!(await confirmAction(`¿Enviar a ${u.email} un mail con su usuario y un link para crear una contraseña nueva?`, 'Enviar mail'))) return;
    setBusy(el, true, 'Enviando…');
    try {
      const r = await api('POST', `/api/admin/users/${u.id}/send-reset`, {});
      toast(`Link enviado a ${r.to}.`);
    } catch (err) {
      toast(err.message, true);
    }
    setBusy(el, false);
    return;
  }
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
    d.render();
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
    return drafts[ds.move].render();
  }
  if (ds.remove) {
    drafts[ds.remove].get().splice(Number(ds.idx), 1);
    return drafts[ds.remove].render();
  }
  if (ds.saverepeat) return saveRepeat(ds.saverepeat, el);
  if ('closeBook' in ds) return closeDialog('bookDialog');
  if (ds.editsection) {
    if (!$('#adminDialog').open) {
      openAdmin('secciones');
    }
    state.editingSection = ds.editsection;
    state.pendingSectionImage = null;
    return renderAdmin();
  }
  if (ds.deletesection) {
    const sec = (state.site.sections || []).find((x) => x.id === ds.deletesection);
    if (!sec || !(await confirmAction(`¿Borrar la sección “${sec.title}”? No se puede deshacer.`))) return;
    const list = state.site.sections.filter((x) => x.id !== sec.id).map((x) => ({ ...x, image: undefined }));
    try {
      await api('PUT', '/api/admin/content/sections', list);
      state.editingSection = null;
      state.draftLayout = null;
      await loadSite();
      renderAdmin();
      toast('Sección borrada.');
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }
  if (ds.lmove) {
    const L = state.draftLayout;
    const i = Number(ds.lmove);
    const j = i + Number(ds.dir);
    if (!L || j < 0 || j >= L.length) return;
    [L[i], L[j]] = [L[j], L[i]];
    return adminSections($('#adminContent'));
  }
  if (ds.inqfilter) {
    state.inquiryFilter = ds.inqfilter;
    return renderInquiryList();
  }
  if (ds.inqstatus) {
    const labels = { archivada: 'Consulta archivada.', respondida: 'Marcada como respondida.', nueva: 'Consulta de vuelta en la bandeja.' };
    return inquiryAction(() => api('PUT', `/api/admin/inquiries/${ds.inqstatus}`, { status: ds.to }), labels[ds.to]);
  }
  if (ds.deleteinq) {
    if (!(await confirmAction('¿Borrar esta consulta? No se puede deshacer.'))) return;
    return inquiryAction(() => api('DELETE', `/api/admin/inquiries/${ds.deleteinq}`), 'Consulta borrada.');
  }
  if (ds.font && state.draftAppearance) {
    state.draftAppearance.font = ds.font;
    applyAppearance(state.draftAppearance);
    $('#apFonts').innerHTML = fontCardsHTML(state.draftAppearance);
    return;
  }
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
    case 'forgot':
      closeDialog('resetDialog');
      if ($('#authDialog').open) return setAuthTab('forgot');
      return openAuth('forgot');
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
    case 'newsection':
      state.editingSection = 'new';
      state.pendingSectionImage = null;
      return renderAdmin();
    case 'backsections':
      state.editingSection = null;
      state.pendingSectionImage = null;
      return renderAdmin();
    case 'removesectionimg': {
      state.pendingSectionImage = '';
      const f = $('#sectionForm');
      const vals = formData(f);
      adminSectionForm($('#adminContent'));
      Object.entries(vals).forEach(([k, v]) => {
        if ($('#sectionForm').elements[k]) $('#sectionForm').elements[k].value = v;
      });
      return;
    }
    case 'savelayout': {
      setBusy(el, true);
      try {
        await api('PUT', '/api/admin/content/layout', state.draftLayout);
        state.draftLayout = null;
        await loadSite();
        toast('Orden guardado.');
      } catch (err) {
        $('#layoutError').textContent = err.message;
        setBusy(el, false);
      }
      return;
    }
    case 'logincomment':
      return openAuth('login', 'Ingresá o creá tu cuenta para comentar.');
    case 'morecomments':
      state.commentsShown += 10;
      return renderComments();
    case 'refreshlog':
      return loadMailLog();
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
      loadMailLog();
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
  if (t.id === 'cmBody') $('#cmCount').textContent = `${t.value.length} / 1000`;
  if (t.dataset.ltitle !== undefined && state.draftLayout) state.draftLayout[Number(t.dataset.ltitle)].title = t.value;
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.form && t.form.id === 'checkoutForm' && (t.name === 'method' || t.name === 'payment')) return renderCheckoutTotals();
  if (t.form && t.form.id === 'appearanceForm' && t.name === 'custom') return readAppearanceForm(t.form, t);
  if (t.dataset.orderstatus) return changeOrderStatus(t);
  if (t.id === 'cmBook') return updateRateField();
  if (t.dataset.lvisible !== undefined && state.draftLayout) {
    state.draftLayout[Number(t.dataset.lvisible)].visible = t.checked;
    t.closest('.layoutrow').classList.toggle('is-off', !t.checked);
    return;
  }
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
      if (t.dataset.upload === 'section') {
        state.pendingSectionImage = await fileToDataUrl(file, 1400, 1400);
        const vals = formData($('#sectionForm'));
        adminSectionForm($('#adminContent'));
        Object.entries(vals).forEach(([k, v]) => {
          if ($('#sectionForm').elements[k]) $('#sectionForm').elements[k].value = v;
        });
        return;
      }
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

  if (form.dataset.replyform) {
    const id = form.dataset.replyform;
    const reply = formData(form).reply.trim();
    if (!reply) {
      $('.form__error', form).textContent = 'Escribí la respuesta antes de enviarla.';
      return;
    }
    setBusy($('button[type=submit]', form), true, 'Enviando…');
    return inquiryAction(() => api('POST', `/api/admin/inquiries/${id}/reply`, { reply }), 'Respuesta enviada por mail.');
  }
  if (form.dataset.commentform) {
    const id = form.dataset.commentform;
    const body = formData(form).body;
    return commentAction(() => api('PUT', `/api/admin/comments/${id}`, { body }), 'Comentario editado.');
  }

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
      case 'forgotForm': {
        setBusy(btn, true, 'Enviando…');
        const email = formData(form).email.trim();
        const r = await api('POST', '/api/auth/forgot', { email });
        setBusy(btn, false);
        if (!r.mailConfigured) {
          const mail = state.site?.settings?.contactEmail;
          err.textContent = `Este sitio todavía no tiene el envío de mails activado.${mail ? ` Escribinos a ${mail} para recuperar tu cuenta.` : ''}`;
          return;
        }
        $('#forgotSentEmail').textContent = email;
        form.reset();
        return setAuthTab('sent');
      }
      case 'resetForm': {
        const d = formData(form);
        if (d.password !== d.password2) {
          err.textContent = 'Las dos contraseñas no coinciden.';
          return;
        }
        setBusy(btn, true, 'Guardando…');
        const res = await api('POST', '/api/auth/reset', { token: d.token, password: d.password });
        try {
          history.replaceState(null, '', '/');
        } catch {
          /* sin historial */
        }
        closeDialog('resetDialog');
        state.me = res.me;
        await loadSite();
        return toast('Listo, guardamos tu contraseña nueva y ya entraste.');
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
        loadInquiries().catch(() => {});
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
      case 'inquiryForm': {
        setBusy(btn, true, 'Enviando…');
        await api('POST', '/api/inquiries', formData(form));
        setBusy(btn, false);
        $('#inquiryBox').innerHTML = `<div class="sentbox"><p class="sentbox__title">¡Gracias!</p>
          <p>Recibimos tu consulta. Te respondemos a <strong>${esc(formData(form).email)}</strong> lo antes posible.</p></div>`;
        return;
      }
      case 'sectionForm':
        return saveSection(form);
      case 'commentForm': {
        setBusy(btn, true, 'Publicando…');
        const d = formData(form);
        const { comment } = await api('POST', '/api/comments', { body: d.body, bookId: d.bookId || null, rating: d.rating || null });
        form.reset();
        $('#cmCount').textContent = '0 / 1000';
        updateRateField();
        setBusy(btn, false);
        toast(comment.status === 'pendiente' ? 'Recibimos tu comentario. Se publica cuando lo revisemos.' : 'Comentario publicado.');
        return loadComments();
      }
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

// Tooltip del gráfico de visitas (mouse y teclado).
document.addEventListener('mouseover', (e) => {
  const bar = e.target.closest && e.target.closest('.vchart__bar');
  if (bar) showChartTip(bar);
  else if (!e.target.closest || !e.target.closest('.vchart')) $('.vchart__tip')?.setAttribute('hidden', '');
});
document.addEventListener('focusin', (e) => {
  const bar = e.target.closest && e.target.closest('.vchart__bar');
  if (bar) showChartTip(bar);
});

// Cerrar el panel sin guardar deshace la vista previa de apariencia.
$('#adminDialog').addEventListener('close', discardAppearance);

// Escape en el diálogo de confirmación equivale a "Cancelar".
$('#confirmDialog').addEventListener('close', () => {
  confirmResolve?.(false);
  confirmResolve = null;
});

// ---------------------------------------------------------------------------
// Visitas y personas en línea
// ---------------------------------------------------------------------------

function visitorId() {
  try {
    let id = localStorage.getItem('vid');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^A-Za-z0-9-]/g, '');
      localStorage.setItem('vid', id);
    }
    return id;
  } catch {
    window.__vid = window.__vid || Math.random().toString(36).slice(2) + Date.now().toString(36);
    return window.__vid;
  }
}

const numFmt = new Intl.NumberFormat('es-AR');
async function ping(view = false) {
  if (document.visibilityState !== 'visible') return;
  try {
    const r = await api('POST', '/api/ping', { vid: visitorId(), view });
    const el = $('#visitCounter');
    if (r.show && r.total !== undefined) {
      el.innerHTML = `<span>${numFmt.format(r.total)} ${r.total === 1 ? 'visita' : 'visitas'}</span><span aria-hidden="true">·</span><span class="livedot" aria-hidden="true"></span><span>${numFmt.format(Math.max(1, r.online))} ${Math.max(1, r.online) === 1 ? 'persona' : 'personas'} en línea ahora</span>`;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  } catch {
    /* las estadísticas nunca deben romper la página */
  }
}
setInterval(() => ping(false), 30000);
document.addEventListener('visibilitychange', () => ping(false));

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------

loadCart();
loadSite()
  .then(() => {
    ping(true);
    if (location.pathname === '/pago') handlePaymentReturn();
    if (location.pathname === '/restablecer') {
      const t = new URLSearchParams(location.search).get('t');
      if (t) openReset(t);
      try {
        history.replaceState(null, '', '/');
      } catch {
        /* sin historial */
      }
    }
    if (isAdmin()) loadInquiries().catch(() => {});
    return isAdmin() ? loadAdminOrders().catch(() => {}) : null;
  })
  .catch((e) => {
    $('#main').innerHTML = `<div class="wrap" style="padding-block:6rem"><p class="empty">${esc(e.message)}</p></div>`;
  });
