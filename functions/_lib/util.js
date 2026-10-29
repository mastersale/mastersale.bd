// Shared helpers for the API (Cloudflare Pages Functions)

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ঀ-৿]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';

export const int = (v, d = 0) => {
  if (v === null || v === undefined || v === '') return d;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : d;
};

export function salePrice(p) {
  const price = int(p.price);
  const v = int(p.discount_value);
  if (p.discount_type === 'percent' && v > 0) return Math.max(0, Math.round(price * (1 - Math.min(v, 100) / 100)));
  if (p.discount_type === 'fixed' && v > 0) return Math.max(0, price - v);
  return price;
}

export function parseJSON(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

// Turn a DB row into the public product shape
export function shapeProduct(row, { full = false } = {}) {
  const media = parseJSON(row.media, []);
  const sale = salePrice(row);
  const out = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    short_desc: row.short_desc || '',
    category_id: row.category_id,
    category_name: row.category_name || null,
    category_slug: row.category_slug || null,
    price: row.price,
    sale_price: sale,
    on_sale: sale < row.price,
    discount_percent: row.price > 0 && sale < row.price ? Math.round((1 - sale / row.price) * 100) : 0,
    stock: row.stock,
    in_stock: row.stock > 0,
    featured: !!row.featured,
    image: (media.find((m) => m.type === 'image') || {}).url || '',
    image2: (media.filter((m) => m.type === 'image')[1] || {}).url || '',
    has_video: media.some((m) => m.type === 'video'),
  };
  if (full) {
    out.description = row.description || '';
    out.sku = row.sku || '';
    out.media = media;
    out.specs = parseJSON(row.specs, []);
  }
  return out;
}

export function randomToken(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function orderNo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const rnd = Math.floor(Math.random() * 9000 + 1000);
  return `ORD${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${rnd}`;
}

export async function getSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of results) s[r.key] = r.value;
  return s;
}

export const DEFAULT_SETTINGS = {
  store_name: 'My Store',
  tagline: 'Thoughtfully chosen. Delivered fast.',
  announcement: 'Free delivery on orders over ৳3,000',
  currency: '৳',
  hero_title: 'Everything you love, beautifully chosen.',
  hero_subtitle: 'Fresh arrivals and everyday essentials, delivered across Bangladesh.',
  hero_image: '',
  hero_cta: 'Shop the collection',
  shipping_fee: '100',
  free_shipping_over: '3000',
  contact_phone: '',
  contact_email: '',
  contact_address: '',
  facebook_url: '',
  instagram_url: '',
  whatsapp: '',
  cod_enabled: '1',
  online_enabled: '1',
};

// Public settings only (never leak anything secret; secrets live in env vars)
export const PUBLIC_SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
