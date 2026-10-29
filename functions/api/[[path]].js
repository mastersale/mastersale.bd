// One catch-all API for the whole shop.  Route table is at the bottom of this file.
// Storefront, admin panel and your future Android/iOS apps all use this same API.

import {
  CORS, json, HttpError, slugify, int, salePrice, parseJSON, shapeProduct, randomToken, orderNo,
  getSettings, DEFAULT_SETTINGS, PUBLIC_SETTING_KEYS,
} from '../_lib/util.js';
import {
  isAdmin, signToken, checkPassword, sessionCookie, tooManyAttempts, recordFailure, clearFailures,
} from '../_lib/auth.js';
import { sslcConfigured, initPayment, validatePayment } from '../_lib/sslcommerz.js';

const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const PAY_STATUSES = ['unpaid', 'paid', 'failed'];
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 90 * 1024 * 1024; // Cloudflare request body limit is 100 MB on Free/Pro

const PRODUCT_SELECT = `SELECT p.*, c.name AS category_name, c.slug AS category_slug
  FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

async function body(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

const like = (q) => `%${String(q).replace(/[%_\\]/g, (m) => '\\' + m)}%`;

/* ---------------------------------------------------------------- public */

async function getPublicSettings({ env }) {
  const stored = await getSettings(env.DB);
  const s = {};
  for (const k of PUBLIC_SETTING_KEYS) s[k] = stored[k] ?? DEFAULT_SETTINGS[k];
  s.online_available = s.online_enabled === '1' && sslcConfigured(env);
  s.cod_available = s.cod_enabled === '1';
  return json(s, 200, { 'Cache-Control': 'public, max-age=20, s-maxage=20' });
}

async function listCategories({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.name, c.slug, c.image,
       (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS count
     FROM categories c ORDER BY c.sort, c.name`
  ).all();
  return json(results, 200, { 'Cache-Control': 'public, max-age=20, s-maxage=20' });
}

async function listProducts({ env, url }) {
  const q = url.searchParams;
  const where = ['p.active = 1'];
  const args = [];
  if (q.get('category')) { where.push('c.slug = ?'); args.push(q.get('category')); }
  if (q.get('featured') === '1') where.push('p.featured = 1');
  if (q.get('on_sale') === '1') where.push("p.discount_type != 'none' AND p.discount_value > 0");
  if (q.get('q')) {
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.short_desc LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')");
    const l = like(q.get('q'));
    args.push(l, l, l);
  }
  const saleExpr = `CASE p.discount_type
    WHEN 'percent' THEN p.price * (100 - MIN(p.discount_value,100)) / 100.0
    WHEN 'fixed' THEN MAX(0, p.price - p.discount_value)
    ELSE p.price END`;
  const sorts = {
    new: 'p.id DESC',
    price_asc: `${saleExpr} ASC`,
    price_desc: `${saleExpr} DESC`,
    discount: `(p.price - (${saleExpr})) * 1.0 / MAX(p.price,1) DESC`,
  };
  const order = sorts[q.get('sort')] || 'p.featured DESC, p.id DESC';
  const limit = Math.min(Math.max(int(q.get('limit'), 24), 1), 60);
  const offset = Math.max(int(q.get('offset'), 0), 0);
  const from = `FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${where.join(' AND ')}`;
  const [{ results }, total] = await Promise.all([
    env.DB.prepare(`SELECT p.*, c.name AS category_name, c.slug AS category_slug ${from} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(...args, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...args).first(),
  ]);
  return json({ items: results.map((r) => shapeProduct(r)), total: total?.n || 0 }, 200, {
    'Cache-Control': 'public, max-age=15, s-maxage=15',
  });
}

async function getProduct({ env, params }) {
  const row = await env.DB.prepare(`${PRODUCT_SELECT} WHERE p.slug = ? AND p.active = 1`).bind(params[0]).first();
  if (!row) throw new HttpError(404, 'Product not found.');
  const product = shapeProduct(row, { full: true });
  let related = [];
  if (row.category_id) {
    const r = await env.DB.prepare(`${PRODUCT_SELECT} WHERE p.category_id = ? AND p.id != ? AND p.active = 1 ORDER BY p.featured DESC, p.id DESC LIMIT 4`)
      .bind(row.category_id, row.id).all();
    related = r.results.map((x) => shapeProduct(x));
  }
  return json({ ...product, related }, 200, { 'Cache-Control': 'public, max-age=15, s-maxage=15' });
}

/* ---------------------------------------------------------------- orders */

const PHONE_RE = /^(?:\+?88)?(01[3-9]\d{8})$/;

async function restoreStock(db, orderId) {
  const { results } = await db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').bind(orderId).all();
  if (!results.length) return;
  await db.batch(results.filter((i) => i.product_id).map((i) =>
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').bind(i.qty, i.product_id)));
}

async function createOrder({ env, request, url }) {
  const b = await body(request);
  const c = b.customer || {};
  const name = String(c.name || '').trim().slice(0, 120);
  const address = String(c.address || '').trim().slice(0, 400);
  const phoneMatch = String(c.phone || '').replace(/[\s-]/g, '').match(PHONE_RE);
  if (!name) throw new HttpError(400, 'Enter your full name.');
  if (!phoneMatch) throw new HttpError(400, 'Enter a valid mobile number, like 01712345678.');
  if (address.length < 8) throw new HttpError(400, 'Enter your full delivery address.');
  const email = String(c.email || '').trim().slice(0, 160);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'That email address does not look right.');

  const wanted = new Map();
  for (const it of Array.isArray(b.items) ? b.items : []) {
    const id = int(it.id), qty = Math.min(Math.max(int(it.qty, 1), 1), 20);
    if (id > 0) wanted.set(id, (wanted.get(id) || 0) + qty);
  }
  if (!wanted.size) throw new HttpError(400, 'Your cart is empty.');

  const ids = [...wanted.keys()];
  const { results: prods } = await env.DB.prepare(
    `SELECT * FROM products WHERE active = 1 AND id IN (${ids.map(() => '?').join(',')})`
  ).bind(...ids).all();
  if (prods.length !== ids.length) throw new HttpError(409, 'Some items in your cart are no longer available. Remove them and try again.');

  const settings = { ...DEFAULT_SETTINGS, ...(await getSettings(env.DB)) };
  const method = b.payment_method === 'cod' ? 'cod' : 'online';
  if (method === 'cod' && settings.cod_enabled !== '1') throw new HttpError(400, 'Cash on delivery is not available right now.');
  if (method === 'online' && !(settings.online_enabled === '1' && sslcConfigured(env))) {
    throw new HttpError(400, 'Online payment is not available right now.');
  }

  const lines = prods.map((p) => {
    const qty = wanted.get(p.id);
    const media = parseJSON(p.media, []);
    return { id: p.id, name: p.name, qty, price: salePrice(p), image: (media.find((m) => m.type === 'image') || {}).url || '' };
  });
  for (const p of prods) {
    if (p.stock < wanted.get(p.id)) throw new HttpError(409, `Only ${p.stock} left of “${p.name}”.`);
  }
  const subtotal = lines.reduce((n, l) => n + l.price * l.qty, 0);
  const freeOver = int(settings.free_shipping_over);
  const shipping = freeOver > 0 && subtotal >= freeOver ? 0 : int(settings.shipping_fee);
  const total = subtotal + shipping;

  // Reserve stock (guarded so two buyers can't take the last unit)
  const taken = [];
  for (const l of lines) {
    const r = await env.DB.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').bind(l.qty, l.id, l.qty).run();
    if (!r.meta.changes) {
      for (const t of taken) await env.DB.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').bind(t.qty, t.id).run();
      throw new HttpError(409, `Sorry, “${l.name}” just sold out.`);
    }
    taken.push(l);
  }

  const order = {
    order_no: orderNo(), token: randomToken(16), name, phone: phoneMatch[1], email, address,
    city: String(c.city || '').trim().slice(0, 80), note: String(c.note || '').trim().slice(0, 400),
    subtotal, shipping, total, payment_method: method, tran_id: method === 'online' ? `T${Date.now()}${randomToken(3)}` : '',
  };
  const ins = await env.DB.prepare(
    `INSERT INTO orders (order_no, token, name, phone, email, address, city, note, subtotal, shipping, total, payment_method, tran_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(order.order_no, order.token, order.name, order.phone, order.email, order.address, order.city, order.note,
    order.subtotal, order.shipping, order.total, order.payment_method, order.tran_id).run();
  const orderId = ins.meta.last_row_id;
  await env.DB.batch(lines.map((l) =>
    env.DB.prepare('INSERT INTO order_items (order_id, product_id, name, price, qty, image) VALUES (?,?,?,?,?,?)')
      .bind(orderId, l.id, l.name, l.price, l.qty, l.image)));

  if (method === 'cod') return json({ order_no: order.order_no, token: order.token, payment_url: null }, 201);

  try {
    const payment_url = await initPayment(env, { order, items: lines, origin: url.origin });
    return json({ order_no: order.order_no, token: order.token, payment_url }, 201);
  } catch (e) {
    await restoreStock(env.DB, orderId);
    await env.DB.prepare("UPDATE orders SET status='cancelled', payment_status='failed' WHERE id = ?").bind(orderId).run();
    throw new HttpError(502, 'We could not start the payment. Please try again or choose cash on delivery.');
  }
}

async function getOrderPublic({ env, params, url }) {
  const o = await env.DB.prepare('SELECT * FROM orders WHERE order_no = ?').bind(params[0]).first();
  const k = url.searchParams.get('k') || '';
  const phone = String(url.searchParams.get('phone') || '').replace(/[\s-]/g, '').match(PHONE_RE)?.[1];
  if (!o || !((k && k === o.token) || (phone && phone === o.phone))) throw new HttpError(404, 'We could not find that order. Check the order number and phone number.');
  const { results: items } = await env.DB.prepare('SELECT name, price, qty, image FROM order_items WHERE order_id = ?').bind(o.id).all();
  return json({
    order_no: o.order_no, name: o.name, phone: o.phone, address: o.address, city: o.city,
    subtotal: o.subtotal, shipping: o.shipping, total: o.total, payment_method: o.payment_method,
    payment_status: o.payment_status, status: o.status, created_at: o.created_at, items,
  });
}

/* ------------------------------------------------------ payment callbacks */

async function readForm(request) {
  try {
    const f = await request.formData();
    return Object.fromEntries(f.entries());
  } catch {
    return {};
  }
}

async function settlePayment(env, data) {
  const order = data.tran_id ? await env.DB.prepare('SELECT * FROM orders WHERE tran_id = ?').bind(data.tran_id).first() : null;
  if (!order) return null;
  if (order.payment_status === 'paid' || !data.val_id) return order;
  try {
    const v = await validatePayment(env, data.val_id);
    const good = (v.status === 'VALID' || v.status === 'VALIDATED') && v.tran_id === order.tran_id &&
      Math.abs(parseFloat(v.currency_amount || v.amount) - order.total) < 1 && (v.currency_type || v.currency || 'BDT') === 'BDT';
    if (good) {
      await env.DB.prepare(
        "UPDATE orders SET payment_status='paid', val_id=?, status = CASE WHEN status='pending' THEN 'confirmed' ELSE status END WHERE id = ?"
      ).bind(String(data.val_id), order.id).run();
      return { ...order, payment_status: 'paid' };
    }
  } catch { /* fall through: stays unpaid; admin can verify in the SSLCommerz dashboard */ }
  return order;
}

async function failPayment(env, data) {
  const order = data.tran_id ? await env.DB.prepare('SELECT * FROM orders WHERE tran_id = ?').bind(data.tran_id).first() : null;
  if (order && order.payment_status === 'unpaid' && order.status !== 'cancelled') {
    await restoreStock(env.DB, order.id);
    await env.DB.prepare("UPDATE orders SET payment_status='failed', status='cancelled' WHERE id = ?").bind(order.id).run();
  }
  return order;
}

const backToShop = (url, order, extra = '') =>
  Response.redirect(order ? `${url.origin}/order/${order.order_no}?k=${order.token}${extra}` : `${url.origin}/`, 303);

async function paySuccess({ env, request, url }) {
  const data = request.method === 'POST' ? await readForm(request) : Object.fromEntries(url.searchParams);
  return backToShop(url, await settlePayment(env, data));
}
async function payFail({ env, request, url }) {
  const data = request.method === 'POST' ? await readForm(request) : Object.fromEntries(url.searchParams);
  return backToShop(url, await failPayment(env, data), '&pay=failed');
}
async function payCancel({ env, request, url }) {
  const data = request.method === 'POST' ? await readForm(request) : Object.fromEntries(url.searchParams);
  return backToShop(url, await failPayment(env, data), '&pay=cancelled');
}
async function payIpn({ env, request }) {
  await settlePayment(env, await readForm(request));
  return new Response('OK');
}

/* ------------------------------------------------------------ admin auth */

async function adminLogin({ env, request }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (await tooManyAttempts(env.DB, ip)) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.');
  const b = await body(request);
  if (!(await checkPassword(env, b.password))) {
    await recordFailure(env.DB, ip);
    throw new HttpError(401, 'Wrong password.');
  }
  await clearFailures(env.DB, ip);
  const token = await signToken(env);
  return json({ ok: true, token }, 200, { 'Set-Cookie': sessionCookie(token, 60 * 60 * 24 * 7) });
}
const adminLogout = () => json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
const adminMe = () => json({ ok: true });

/* ----------------------------------------------------------- admin: data */

function cleanMedia(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 30).map((m) => ({
    type: m.type === 'video' ? 'video' : 'image',
    url: String(m.url || ''),
  })).filter((m) => m.url.startsWith('/media/') || /^https:\/\//.test(m.url));
}
function cleanSpecs(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 60).map((s) => ({ key: String(s.key || '').trim().slice(0, 80), value: String(s.value || '').trim().slice(0, 300) }))
    .filter((s) => s.key && s.value);
}
const mediaKeys = (media) => media.filter((m) => m.url.startsWith('/media/')).map((m) => m.url.slice(7));

async function uniqueSlug(db, base, exceptId = 0) {
  let slug = base, n = 1;
  while (await db.prepare('SELECT id FROM products WHERE slug = ? AND id != ?').bind(slug, exceptId).first()) {
    slug = `${base}-${++n}`;
  }
  return slug;
}

function productFields(b) {
  const name = String(b.name || '').trim().slice(0, 200);
  if (!name) throw new HttpError(400, 'Product name is required.');
  const price = int(b.price);
  if (price < 0) throw new HttpError(400, 'Price cannot be negative.');
  const discount_type = ['none', 'percent', 'fixed'].includes(b.discount_type) ? b.discount_type : 'none';
  let discount_value = Math.max(0, int(b.discount_value));
  if (discount_type === 'percent' && discount_value > 100) throw new HttpError(400, 'A percentage discount cannot be more than 100.');
  if (discount_type === 'fixed' && discount_value > price) throw new HttpError(400, 'The discount cannot be more than the price.');
  if (discount_type === 'none') discount_value = 0;
  return {
    name, price, discount_type, discount_value,
    short_desc: String(b.short_desc || '').trim().slice(0, 300),
    description: String(b.description || '').trim().slice(0, 10000),
    category_id: b.category_id ? int(b.category_id) : null,
    stock: Math.max(0, int(b.stock)),
    sku: String(b.sku || '').trim().slice(0, 60),
    active: b.active ? 1 : 0,
    featured: b.featured ? 1 : 0,
    media: cleanMedia(b.media),
    specs: cleanSpecs(b.specs),
  };
}

async function adminListProducts({ env, url }) {
  const q = url.searchParams;
  const where = ['1=1'], args = [];
  if (q.get('q')) { where.push("(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')"); args.push(like(q.get('q')), like(q.get('q'))); }
  if (q.get('stock') === 'low') where.push('p.stock <= 5');
  const limit = Math.min(Math.max(int(q.get('limit'), 50), 1), 200), offset = Math.max(int(q.get('offset'), 0), 0);
  const { results } = await env.DB.prepare(
    `${PRODUCT_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT ? OFFSET ?`
  ).bind(...args, limit, offset).all();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM products p WHERE ${where.join(' AND ')}`).bind(...args).first();
  return json({
    items: results.map((r) => ({ ...shapeProduct(r), active: !!r.active, sku: r.sku, discount_type: r.discount_type, discount_value: r.discount_value })),
    total: total?.n || 0,
  });
}

async function adminGetProduct({ env, params }) {
  const row = await env.DB.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).bind(int(params[0])).first();
  if (!row) throw new HttpError(404, 'Product not found.');
  return json({
    ...shapeProduct(row, { full: true }), active: !!row.active, discount_type: row.discount_type, discount_value: row.discount_value,
  });
}

async function adminCreateProduct({ env, request }) {
  const f = productFields(await body(request));
  const slug = await uniqueSlug(env.DB, slugify(f.name));
  const r = await env.DB.prepare(
    `INSERT INTO products (slug, name, short_desc, description, category_id, price, discount_type, discount_value, stock, sku, active, featured, media, specs)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(slug, f.name, f.short_desc, f.description, f.category_id, f.price, f.discount_type, f.discount_value, f.stock, f.sku,
    f.active, f.featured, JSON.stringify(f.media), JSON.stringify(f.specs)).run();
  return json({ id: r.meta.last_row_id, slug }, 201);
}

async function adminUpdateProduct({ env, request, params }) {
  const id = int(params[0]);
  const old = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!old) throw new HttpError(404, 'Product not found.');
  const f = productFields(await body(request));
  await env.DB.prepare(
    `UPDATE products SET name=?, short_desc=?, description=?, category_id=?, price=?, discount_type=?, discount_value=?, stock=?, sku=?,
       active=?, featured=?, media=?, specs=?, updated_at=datetime('now') WHERE id=?`
  ).bind(f.name, f.short_desc, f.description, f.category_id, f.price, f.discount_type, f.discount_value, f.stock, f.sku,
    f.active, f.featured, JSON.stringify(f.media), JSON.stringify(f.specs), id).run();
  // Delete files that were removed from this product
  const keep = new Set(mediaKeys(f.media));
  const gone = mediaKeys(parseJSON(old.media, [])).filter((k) => !keep.has(k));
  if (gone.length) await env.MEDIA.delete(gone);
  return json({ ok: true, slug: old.slug });
}

async function adminDeleteProduct({ env, params }) {
  const id = int(params[0]);
  const old = await env.DB.prepare('SELECT media FROM products WHERE id = ?').bind(id).first();
  if (!old) throw new HttpError(404, 'Product not found.');
  await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
  const keys = mediaKeys(parseJSON(old.media, []));
  if (keys.length) await env.MEDIA.delete(keys);
  return json({ ok: true });
}

async function adminListCategories({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS count FROM categories c ORDER BY c.sort, c.name`
  ).all();
  return json(results);
}
async function adminSaveCategory({ env, request, params }) {
  const b = await body(request);
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) throw new HttpError(400, 'Category name is required.');
  const sort = int(b.sort), image = String(b.image || '').slice(0, 300);
  if (params[0]) {
    const id = int(params[0]);
    await env.DB.prepare('UPDATE categories SET name=?, sort=?, image=? WHERE id=?').bind(name, sort, image, id).run();
    return json({ ok: true, id });
  }
  let slug = slugify(name), n = 1;
  while (await env.DB.prepare('SELECT id FROM categories WHERE slug = ?').bind(slug).first()) slug = `${slugify(name)}-${++n}`;
  const r = await env.DB.prepare('INSERT INTO categories (name, slug, sort, image) VALUES (?,?,?,?)').bind(name, slug, sort, image).run();
  return json({ ok: true, id: r.meta.last_row_id, slug }, 201);
}
async function adminDeleteCategory({ env, params }) {
  const id = int(params[0]);
  await env.DB.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function adminListOrders({ env, url }) {
  const q = url.searchParams;
  const where = ['1=1'], args = [];
  if (ORDER_STATUSES.includes(q.get('status'))) { where.push('status = ?'); args.push(q.get('status')); }
  if (q.get('q')) { where.push("(order_no LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')"); const l = like(q.get('q')); args.push(l, l, l); }
  const limit = Math.min(Math.max(int(q.get('limit'), 50), 1), 200), offset = Math.max(int(q.get('offset'), 0), 0);
  const { results } = await env.DB.prepare(
    `SELECT id, order_no, name, phone, total, payment_method, payment_status, status, created_at,
       (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE order_id = orders.id) AS items
     FROM orders WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).bind(...args, limit, offset).all();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE ${where.join(' AND ')}`).bind(...args).first();
  return json({ items: results, total: total?.n || 0 });
}
async function adminGetOrder({ env, params }) {
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(int(params[0])).first();
  if (!o) throw new HttpError(404, 'Order not found.');
  const { results } = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(o.id).all();
  delete o.token;
  return json({ ...o, items: results });
}
async function adminUpdateOrder({ env, request, params }) {
  const id = int(params[0]);
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!o) throw new HttpError(404, 'Order not found.');
  const b = await body(request);
  const status = b.status ?? o.status, pay = b.payment_status ?? o.payment_status;
  if (!ORDER_STATUSES.includes(status) || !PAY_STATUSES.includes(pay)) throw new HttpError(400, 'Invalid status.');
  if (o.status === 'cancelled' && status !== 'cancelled') throw new HttpError(400, 'A cancelled order cannot be reopened. Ask the customer to place a new order.');
  if (status === 'cancelled' && o.status !== 'cancelled') await restoreStock(env.DB, id);
  await env.DB.prepare('UPDATE orders SET status=?, payment_status=? WHERE id=?').bind(status, pay, id).run();
  return json({ ok: true });
}

async function adminStats({ env }) {
  const db = env.DB;
  const [products, low, pending, today, revenue, recent] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').first(),
    db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND stock <= 5').first(),
    db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'").first(),
    db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS sum FROM orders WHERE date(created_at) = date('now') AND status != 'cancelled'").first(),
    db.prepare("SELECT COALESCE(SUM(total),0) AS sum FROM orders WHERE status != 'cancelled' AND (payment_status = 'paid' OR status = 'delivered')").first(),
    db.prepare("SELECT id, order_no, name, total, status, payment_status, created_at FROM orders ORDER BY id DESC LIMIT 8").all(),
  ]);
  return json({
    products: products.n, low_stock: low.n, pending_orders: pending.n,
    today_orders: today.n, today_sales: today.sum, revenue: revenue.sum, recent: recent.results,
  });
}

async function adminGetSettings({ env }) {
  const stored = await getSettings(env.DB);
  const s = {};
  for (const k of PUBLIC_SETTING_KEYS) s[k] = stored[k] ?? DEFAULT_SETTINGS[k];
  s._payments = { sslcommerz_configured: sslcConfigured(env), live_mode: env.SSLC_LIVE === 'true' };
  return json(s);
}
async function adminSaveSettings({ env, request }) {
  const b = await body(request);
  const stmts = [];
  for (const k of PUBLIC_SETTING_KEYS) {
    if (b[k] === undefined) continue;
    stmts.push(env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(k, String(b[k]).slice(0, 2000)));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true });
}

// Upload: the file is the raw request body (streamed straight into R2, so big videos are fine).
// POST /api/admin/upload   Content-Type: image/webp | video/mp4 ...   Content-Length: required
async function adminUpload({ env, request }) {
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const isImage = type in IMAGE_TYPES, isVideo = type in VIDEO_TYPES;
  if (!isImage && !isVideo) throw new HttpError(415, 'Upload a JPG, PNG, WebP, GIF or AVIF image, or an MP4, WebM or MOV video.');
  const size = int(request.headers.get('Content-Length'), 0);
  if (!size) throw new HttpError(411, 'The upload is missing its size. Try again.');
  if (size > (isImage ? MAX_IMAGE : MAX_VIDEO)) {
    throw new HttpError(413, isImage ? 'Images must be under 10 MB.' : 'Videos must be under 90 MB. Compress the video and try again.');
  }
  const d = new Date();
  const key = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}/${randomToken(10)}.${(IMAGE_TYPES[type] || VIDEO_TYPES[type])}`;
  await env.MEDIA.put(key, request.body, {
    httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' },
  });
  return json({ url: `/media/${key}`, type: isImage ? 'image' : 'video', size }, 201);
}

/* ---------------------------------------------------------------- router */

// [method, pattern, handler, adminOnly]
const ROUTES = [
  ['GET', 'settings', getPublicSettings],
  ['GET', 'categories', listCategories],
  ['GET', 'products', listProducts],
  ['GET', 'products/:slug', getProduct],
  ['POST', 'orders', createOrder],
  ['GET', 'orders/:no', getOrderPublic],
  ['POST', 'pay/success', paySuccess], ['GET', 'pay/success', paySuccess],
  ['POST', 'pay/fail', payFail], ['GET', 'pay/fail', payFail],
  ['POST', 'pay/cancel', payCancel], ['GET', 'pay/cancel', payCancel],
  ['POST', 'pay/ipn', payIpn],

  ['POST', 'admin/login', adminLogin],
  ['POST', 'admin/logout', adminLogout],
  ['GET', 'admin/me', adminMe, true],
  ['GET', 'admin/stats', adminStats, true],
  ['GET', 'admin/products', adminListProducts, true],
  ['POST', 'admin/products', adminCreateProduct, true],
  ['GET', 'admin/products/:id', adminGetProduct, true],
  ['PUT', 'admin/products/:id', adminUpdateProduct, true],
  ['DELETE', 'admin/products/:id', adminDeleteProduct, true],
  ['GET', 'admin/categories', adminListCategories, true],
  ['POST', 'admin/categories', adminSaveCategory, true],
  ['PUT', 'admin/categories/:id', adminSaveCategory, true],
  ['DELETE', 'admin/categories/:id', adminDeleteCategory, true],
  ['GET', 'admin/orders', adminListOrders, true],
  ['GET', 'admin/orders/:id', adminGetOrder, true],
  ['PUT', 'admin/orders/:id', adminUpdateOrder, true],
  ['GET', 'admin/settings', adminGetSettings, true],
  ['PUT', 'admin/settings', adminSaveSettings, true],
  ['POST', 'admin/upload', adminUpload, true],
].map(([method, pattern, handler, admin]) => {
  const names = [];
  const re = new RegExp('^' + pattern.replace(/:[a-z]+/g, () => { names.push(1); return '([^/]+)'; }) + '$');
  return { method, re, handler, admin: !!admin };
});

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');

  let res;
  try {
    if (!env.DB) throw new HttpError(500, 'Database is not connected. See README step 3.');
    const route = ROUTES.find((r) => r.method === request.method && r.re.test(path));
    if (!route) throw new HttpError(404, 'Not found.');
    if (route.admin) {
      if (!(await isAdmin(request, env))) throw new HttpError(401, 'Please sign in.');
      const viaCookie = !(request.headers.get('Authorization') || '').startsWith('Bearer ');
      if (viaCookie && request.method !== 'GET' && !request.headers.get('X-Requested-With')) throw new HttpError(403, 'Blocked request.');
    }
    const params = path.match(route.re).slice(1).map(decodeURIComponent);
    res = await route.handler({ ...context, url, params });
  } catch (e) {
    if (e instanceof HttpError) res = json({ error: e.message }, e.status);
    else { console.error(e); res = json({ error: 'Something went wrong on our side. Please try again.' }, 500); }
  }
  // Redirect responses are immutable; rebuild with CORS headers where needed
  if (res.status >= 300 && res.status < 400) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  if (!out.headers.has('Cache-Control')) out.headers.set('Cache-Control', 'no-store');
  return out;
}
