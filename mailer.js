// Envío de emails.
// - Brevo (API HTTP): funciona en el plan gratis de Render, que bloquea SMTP.
//   Variables: BREVO_API_KEY, MAIL_FROM (remitente verificado en Brevo), MAIL_FROM_NAME (opcional).
// - SMTP (por ejemplo Gmail con contraseña de aplicación): para correr en tu PC
//   o en un plan pago de Render. Variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM.
// - MAIL_LOG=1: no envía nada, imprime los mails en la consola (para probar).

const PROVIDER = process.env.MAIL_LOG === '1'
  ? 'consola'
  : process.env.BREVO_API_KEY
    ? 'brevo'
    : process.env.SMTP_HOST
      ? 'smtp'
      : null;

const FROM = process.env.MAIL_FROM || process.env.SMTP_USER || '';

function mailStatus() {
  if (!PROVIDER) return { configured: false, provider: null, from: '' };
  if (PROVIDER !== 'consola' && !FROM) return { configured: false, provider: PROVIDER, from: '', problem: 'Falta la variable MAIL_FROM.' };
  return { configured: true, provider: PROVIDER, from: FROM };
}

let smtpTransport = null;

// Registro de cada intento de envío (lo usa el panel para mostrar errores).
let logger = null;
function setLogger(fn) {
  logger = fn;
}

async function sendMail(opts) {
  try {
    await deliver(opts);
    if (logger) await Promise.resolve(logger({ to: opts.to, subject: opts.subject, ok: true, error: '' })).catch(() => {});
  } catch (err) {
    if (logger) await Promise.resolve(logger({ to: opts.to, subject: opts.subject, ok: false, error: err.message })).catch(() => {});
    throw err;
  }
}

async function deliver({ to, toName, subject, html, replyTo, fromName }) {
  const st = mailStatus();
  if (!st.configured) throw new Error(st.problem || 'El envío de mails no está configurado.');
  const senderName = process.env.MAIL_FROM_NAME || fromName || 'Tienda';

  if (PROVIDER === 'consola') {
    const links = [...new Set([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')))];
    console.log(`\n--- MAIL (simulado) ---\nPara: ${to}\nAsunto: ${subject}\nResponder a: ${replyTo || '-'}\n${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600)}${links.length ? `\nEnlaces: ${links.join('  ')}` : ''}\n-----------------------\n`);
    return;
  }

  if (PROVIDER === 'brevo') {
    const body = {
      sender: { email: FROM, name: senderName },
      to: [{ email: to, ...(toName ? { name: toName } : {}) }],
      subject,
      htmlContent: html,
    };
    if (replyTo) body.replyTo = { email: replyTo };
    let res;
    try {
      res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error('No se pudo conectar con Brevo. Probá de nuevo en unos minutos.');
    }
    if (!res.ok) {
      let msg = `Brevo respondió ${res.status}`;
      try {
        const j = await res.json();
        if (j.message) msg += `: ${j.message}`;
      } catch {
        /* sin detalle */
      }
      throw new Error(msg);
    }
    return;
  }

  // SMTP
  if (!smtpTransport) {
    const nodemailer = require('nodemailer');
    const port = Number(process.env.SMTP_PORT) || 587;
    smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      connectionTimeout: 15000,
    });
  }
  await smtpTransport.sendMail({
    from: `"${senderName.replace(/"/g, '')}" <${FROM}>`,
    to: toName ? `"${toName.replace(/"/g, '')}" <${to}>` : to,
    subject,
    html,
    replyTo: replyTo || undefined,
  });
}

// ---------- plantillas ----------

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(Number(n) || 0);
const orderNo = (id) => '#' + String(id).padStart(4, '0');

function layout({ siteName, accent, preheader, body, footer }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(siteName)}</title></head>
<body style="margin:0;padding:0;background:#eef0ec;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0ec;">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-top:4px solid ${accent};">
    <tr><td style="padding:28px 32px 8px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:22px;color:#14181f;">${esc(siteName)}</td></tr>
    <tr><td style="padding:8px 32px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#14181f;">${body}</td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="padding:16px 32px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6b727c;">${footer}</td></tr>
  </table>
</td></tr></table></body></html>`;
}

function itemsTable(order) {
  const rows = order.items
    .map(
      (i) => `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #e3e6e0;">${i.qty} × ${esc(i.title)}</td>
      <td align="right" style="padding:8px 0;border-bottom:1px solid #e3e6e0;white-space:nowrap;">${money(i.price * i.qty)}</td></tr>`
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#14181f;margin:16px 0;">
    ${rows}
    <tr><td style="padding:8px 0;color:#5b626c;">Envío</td><td align="right" style="padding:8px 0;color:#5b626c;">${order.shippingCost ? money(order.shippingCost) : 'Sin cargo'}</td></tr>
    <tr><td style="padding:10px 0;border-top:2px solid #14181f;font-weight:bold;">Total</td><td align="right" style="padding:10px 0;border-top:2px solid #14181f;font-weight:bold;">${money(order.total)}</td></tr>
  </table>`;
}

function shippingBlock(order) {
  const s = order.shipping || {};
  if (s.method === 'retiro') return '<p style="margin:0 0 6px;"><strong>Entrega:</strong> retiro a coordinar.</p>';
  const lines = [s.fullName, s.street, [s.city, s.province].filter(Boolean).join(', '), s.zip ? `CP ${s.zip}` : '']
    .filter(Boolean)
    .map(esc)
    .join('<br>');
  return `<p style="margin:0 0 6px;"><strong>Envío a domicilio:</strong><br>${lines}</p>`;
}

function buyerEmail({ order, customer, settings, siteUrl, accent }) {
  const siteName = settings.siteName || 'Tienda';
  const first = String(customer.name || '').split(' ')[0];
  const body = `
    <h1 style="margin:0 0 6px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:28px;line-height:1.2;">Recibimos tu pedido ${orderNo(order.id)}</h1>
    <p style="margin:0 0 4px;">Hola${first ? ' ' + esc(first) : ''}, gracias por tu compra. Este es el detalle:</p>
    ${itemsTable(order)}
    ${shippingBlock(order)}
    ${order.notes ? `<p style="margin:0 0 6px;"><strong>Tus notas:</strong> ${esc(order.notes)}</p>` : ''}
    ${order.paymentMethod === 'mercadopago'
      ? `<div style="margin:20px 0 4px;padding:14px 16px;background:#f1f3fb;border-left:3px solid ${accent};"><strong>Pago con Mercado Pago</strong><br>Cuando Mercado Pago confirme el pago te mandamos otro mail. Si no llegaste a pagar, entrá a Mi cuenta y tocá “Pagar con Mercado Pago”.</div>`
      : settings.paymentInstructions
        ? `<div style="margin:20px 0 4px;padding:14px 16px;background:#f1f3fb;border-left:3px solid ${accent};white-space:pre-line;"><strong>Cómo pagar</strong><br>${esc(settings.paymentInstructions)}</div>`
        : ''}
    ${siteUrl ? `<p style="margin:22px 0 0;"><a href="${esc(siteUrl)}" style="color:${accent};">Ver el estado en Mi cuenta</a></p>` : ''}`;
  return {
    subject: `Pedido ${orderNo(order.id)} recibido · ${siteName}`,
    html: layout({
      siteName,
      accent,
      preheader: `Total ${money(order.total)}. Te contamos cómo pagar.`,
      body,
      footer: `Recibiste este mail porque hiciste un pedido en ${esc(siteName)}. Si tenés dudas, respondé este mail.`,
    }),
  };
}

function sellerEmail({ order, customer, settings, siteUrl, accent }) {
  const siteName = settings.siteName || 'Tienda';
  const s = order.shipping || {};
  const body = `
    <h1 style="margin:0 0 6px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:28px;line-height:1.2;">Nuevo pedido ${orderNo(order.id)}</h1>
    <p style="margin:0 0 4px;">Total <strong>${money(order.total)}</strong>. ${order.paymentMethod === 'mercadopago'
      ? 'El comprador eligió <strong>Mercado Pago</strong>: el pedido pasa a pagado solo cuando se acredite, y te llega otro mail.'
      : 'Eligió <strong>transferencia</strong>: queda pendiente hasta que lo marques como pagado en el panel.'}</p>
    <p style="margin:16px 0 4px;"><strong>Comprador</strong><br>${esc(customer.name)}<br>${esc(customer.email)}${s.phone ? `<br>Tel. ${esc(s.phone)}` : ''}</p>
    ${itemsTable(order)}
    ${shippingBlock(order)}
    ${order.notes ? `<p style="margin:0 0 6px;"><strong>Notas del comprador:</strong> ${esc(order.notes)}</p>` : ''}
    ${siteUrl ? `<p style="margin:22px 0 0;"><a href="${esc(siteUrl)}" style="color:${accent};">Abrir el sitio para gestionar el pedido</a></p>` : ''}`;
  return {
    subject: `Nuevo pedido ${orderNo(order.id)} · ${money(order.total)}`,
    html: layout({
      siteName,
      accent,
      preheader: `${customer.name} compró ${order.items.reduce((n, i) => n + i.qty, 0)} libro(s).`,
      body,
      footer: 'Respondé este mail para escribirle directamente al comprador.',
    }),
  };
}

function paidEmail({ order, customer, settings, siteUrl, accent, forSeller }) {
  const siteName = settings.siteName || 'Tienda';
  const body = forSeller
    ? `<h1 style="margin:0 0 6px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:28px;line-height:1.2;">Pago acreditado · ${orderNo(order.id)}</h1>
       <p style="margin:0 0 4px;">Mercado Pago confirmó el pago de <strong>${esc(customer.name)}</strong> (${esc(customer.email)}). El pedido ya figura como <strong>pagado</strong>: falta prepararlo y enviarlo.</p>
       ${itemsTable(order)}${shippingBlock(order)}
       ${order.notes ? `<p style="margin:0 0 6px;"><strong>Notas:</strong> ${esc(order.notes)}</p>` : ''}`
    : `<h1 style="margin:0 0 6px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:28px;line-height:1.2;">Recibimos tu pago</h1>
       <p style="margin:0 0 4px;">Mercado Pago confirmó el pago de tu pedido ${orderNo(order.id)}. Ahora lo preparamos y te avisamos cuando salga.</p>
       ${itemsTable(order)}${shippingBlock(order)}
       ${siteUrl ? `<p style="margin:22px 0 0;"><a href="${esc(siteUrl)}" style="color:${accent};">Ver el estado en Mi cuenta</a></p>` : ''}`;
  return {
    subject: forSeller ? `Pago acreditado · pedido ${orderNo(order.id)} · ${money(order.total)}` : `Pago recibido · pedido ${orderNo(order.id)} · ${siteName}`,
    html: layout({ siteName, accent, preheader: `Pago de ${money(order.total)} acreditado.`, body, footer: `Mail automático de ${esc(siteName)}.` }),
  };
}

function commentPendingEmail({ comment, settings, siteUrl, accent }) {
  const siteName = settings.siteName || 'Tienda';
  const body = `
    <h1 style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:26px;line-height:1.2;">Comentario para aprobar</h1>
    <p style="margin:0 0 10px;"><strong>${esc(comment.author_name || '')}</strong>${comment.book_title ? ` sobre <em>${esc(comment.book_title)}</em>` : ''} escribió:</p>
    <blockquote style="margin:0 0 14px;padding:12px 16px;background:#f3f4f1;border-left:3px solid ${accent};white-space:pre-line;">${esc(comment.body)}</blockquote>
    <p style="margin:0;">No se muestra hasta que lo apruebes en el panel → Comentarios.</p>
    ${siteUrl ? button(siteUrl, 'Abrir el sitio', accent) : ''}`;
  return {
    subject: `Nuevo comentario para aprobar · ${siteName}`,
    html: layout({ siteName, accent, preheader: String(comment.body).slice(0, 90), body, footer: `Mail automático de ${esc(siteName)}.` }),
  };
}

function testEmail({ settings, accent }) {
  const siteName = settings.siteName || 'Tienda';
  return {
    subject: `Prueba de mails · ${siteName}`,
    html: layout({
      siteName,
      accent,
      preheader: 'Si ves este mail, la configuración funciona.',
      body: '<h1 style="margin:0 0 8px;font-family:Georgia,serif;font-weight:normal;font-size:26px;">Los mails funcionan</h1><p style="margin:0;">Así van a llegar las confirmaciones de pedido a tus compradores y a vos.</p>',
      footer: `Enviado desde el panel de ${esc(siteName)}.`,
    }),
  };
}

function button(href, label, accent) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;"><tr>
    <td style="background:${accent};border-radius:3px;">
      <a href="${esc(href)}" style="display:inline-block;padding:13px 22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${esc(label)}</a>
    </td></tr></table>`;
}

function resetEmail({ user, link, minutes, settings, accent }) {
  const siteName = settings.siteName || 'Tienda';
  const first = String(user.name || '').split(' ')[0];
  const body = `
    <h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:28px;line-height:1.2;">Recuperá tu cuenta</h1>
    <p style="margin:0 0 14px;">Hola${first ? ' ' + esc(first) : ''}, pediste recuperar el acceso a ${esc(siteName)}.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f1;margin:0 0 6px;">
      <tr><td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#14181f;">
        <span style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#6b727c;">Tu usuario para ingresar</span><br>
        <strong style="font-size:16px;">${esc(user.email)}</strong>
      </td></tr>
    </table>
    <p style="margin:14px 0 0;">Por seguridad no guardamos tu contraseña en texto, así que no podemos enviártela. Con este botón creás una nueva:</p>
    ${button(link, 'Crear una contraseña nueva', accent)}
    <p style="margin:0 0 6px;font-size:13px;color:#5b626c;">El link sirve una sola vez y vence en ${minutes} minutos. Si el botón no funciona, copiá esta dirección en el navegador:<br><span style="word-break:break-all;">${esc(link)}</span></p>
    <p style="margin:16px 0 0;font-size:13px;color:#5b626c;">Si no lo pediste vos, ignorá este mail: tu contraseña sigue igual.</p>`;
  return {
    subject: `Recuperá tu cuenta · ${siteName}`,
    html: layout({ siteName, accent, preheader: `Tu usuario es ${user.email}. Creá una contraseña nueva.`, body, footer: `Mail automático de ${esc(siteName)}.` }),
  };
}

function passwordChangedEmail({ user, settings, siteUrl, accent }) {
  const siteName = settings.siteName || 'Tienda';
  const body = `
    <h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:26px;line-height:1.2;">Cambiaste tu contraseña</h1>
    <p style="margin:0 0 10px;">La contraseña de la cuenta <strong>${esc(user.email)}</strong> se cambió recién. Por seguridad cerramos las sesiones abiertas en otros dispositivos.</p>
    <p style="margin:0;">Si no fuiste vos, pedí un link nuevo desde “¿Olvidaste tu contraseña?”${settings.contactEmail ? ` o escribinos a ${esc(settings.contactEmail)}` : ''}.</p>
    ${siteUrl ? button(siteUrl, 'Ir al sitio', accent) : ''}`;
  return {
    subject: `Tu contraseña se cambió · ${siteName}`,
    html: layout({ siteName, accent, preheader: 'Aviso de seguridad de tu cuenta.', body, footer: `Mail automático de ${esc(siteName)}.` }),
  };
}

module.exports = { sendMail, setLogger, mailStatus, buyerEmail, sellerEmail, testEmail, paidEmail, commentPendingEmail, resetEmail, passwordChangedEmail };
