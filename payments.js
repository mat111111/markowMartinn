// Mercado Pago (Checkout Pro) por API REST, sin dependencias.
// Variable: MP_ACCESS_TOKEN (Access Token de tu aplicación en Mercado Pago Developers).
// MP_MOCK=1 simula Mercado Pago en tu PC (para probar sin cuenta).

const API = 'https://api.mercadopago.com';
const TOKEN = process.env.MP_ACCESS_TOKEN || '';
const MOCK = process.env.MP_MOCK === '1';

const mockPayments = new Map(); // solo en modo simulado

function mpEnabled() {
  return MOCK || Boolean(TOKEN);
}

function mpMode() {
  if (MOCK) return 'simulado';
  if (!TOKEN) return null;
  return TOKEN.startsWith('TEST-') ? 'prueba' : 'produccion';
}

async function mpFetch(path, options = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      ...options,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('No se pudo conectar con Mercado Pago. Probá de nuevo en unos minutos.');
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* sin cuerpo */
  }
  if (!res.ok) {
    const detail = data.message || data.error || `código ${res.status}`;
    if (res.status === 401) throw new Error(`Mercado Pago rechazó el Access Token (${detail}). Revisá MP_ACCESS_TOKEN.`);
    throw new Error(`Mercado Pago respondió: ${detail}`);
  }
  return data;
}

// Crea la preferencia de pago y devuelve el link al que se manda al comprador.
async function createPreference({ order, customer, siteName, siteUrl }) {
  const items = order.items.map((i) => ({
    id: String(i.bookId),
    title: i.title,
    quantity: i.qty,
    unit_price: i.price,
    currency_id: 'ARS',
  }));
  if (order.shippingCost) {
    items.push({ id: 'envio', title: 'Envío', quantity: 1, unit_price: order.shippingCost, currency_id: 'ARS' });
  }

  if (MOCK) {
    return { url: `${siteUrl}/pago-simulado?pedido=${order.id}`, preferenceId: `mock-${order.id}` };
  }

  const publicHttps = /^https:\/\//.test(siteUrl) && !/localhost|127\.0\.0\.1/.test(siteUrl);
  const body = {
    items,
    payer: { email: customer.email, name: customer.name },
    external_reference: String(order.id),
    statement_descriptor: String(siteName || 'Libros').slice(0, 22),
    back_urls: { success: `${siteUrl}/pago`, pending: `${siteUrl}/pago`, failure: `${siteUrl}/pago` },
    metadata: { order_id: order.id },
  };
  // Mercado Pago no acepta localhost para volver ni para avisar pagos.
  if (publicHttps) {
    body.auto_return = 'approved';
    body.notification_url = `${siteUrl}/api/mp/webhook`;
  }
  const pref = await mpFetch('/checkout/preferences', { method: 'POST', body: JSON.stringify(body) });
  const url = TOKEN.startsWith('TEST-') ? pref.sandbox_init_point || pref.init_point : pref.init_point;
  if (!url) throw new Error('Mercado Pago no devolvió el link de pago.');
  return { url, preferenceId: pref.id };
}

// Consulta el pago directamente a Mercado Pago (nunca se confía en lo que llega por la URL).
async function getPayment(paymentId) {
  const id = String(paymentId || '');
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error('Identificador de pago inválido.');
  if (MOCK) {
    const p = mockPayments.get(id);
    if (!p) throw new Error('Pago simulado inexistente.');
    return p;
  }
  return mpFetch(`/v1/payments/${encodeURIComponent(id)}`);
}

// Solo modo simulado: registra un pago falso como si viniera de Mercado Pago.
function mockPay(order, status) {
  const id = `sim${Date.now()}`;
  mockPayments.set(id, {
    id,
    status,
    status_detail: status === 'approved' ? 'accredited' : 'cc_rejected_other_reason',
    external_reference: String(order.id),
    transaction_amount: order.total,
    currency_id: 'ARS',
  });
  return id;
}

module.exports = { mpEnabled, mpMode, createPreference, getPayment, mockPay, MOCK };
