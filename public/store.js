/* Storefront: tiny dependency-free single-page app. All data comes from /api. */
(() => {
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = {
  truck: '<svg viewBox="0 0 24 24"><path d="M2 6h11v10H2zM13 9h4l3 3v4h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  cash: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  tick: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};

let S = { store_name: 'Store', currency: '৳' };      // settings
let CATS = [];
const fmt = (n) => `${S.currency || '৳'}${Number(n || 0).toLocaleString('en-IN')}`;

async function api(path, opts) {
  const res = await fetch('/api/' + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

/* ------------------------------------------------------------------ cart */
const Cart = {
  items: [],
  load() { try { this.items = JSON.parse(localStorage.getItem('cart') || '[]'); } catch { this.items = []; } },
  save() { try { localStorage.setItem('cart', JSON.stringify(this.items)); } catch {} render.cartBadge(); },
  count() { return this.items.reduce((n, i) => n + i.qty, 0); },
  subtotal() { return this.items.reduce((n, i) => n + i.price * i.qty, 0); },
  add(p, qty = 1) {
    const ex = this.items.find((i) => i.id === p.id);
    const max = Math.max(1, p.stock || 1);
    if (ex) ex.qty = Math.min(ex.qty + qty, max);
    else this.items.push({ id: p.id, slug: p.slug, name: p.name, price: p.sale_price, image: p.image, stock: p.stock, qty: Math.min(qty, max) });
    this.save();
  },
  set(id, qty) {
    const it = this.items.find((i) => i.id === id);
    if (!it) return;
    if (qty <= 0) this.items = this.items.filter((i) => i.id !== id);
    else it.qty = Math.min(qty, it.stock || 99);
    this.save();
  },
  clear() { this.items = []; this.save(); },
  shipping() {
    const sub = this.subtotal();
    if (!sub) return 0;
    const free = +S.free_shipping_over || 0;
    return free > 0 && sub >= free ? 0 : +S.shipping_fee || 0;
  },
  total() { return this.subtotal() + this.shipping(); },
};

/* ----------------------------------------------------------------- utils */
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400);
}
function setTitle(t) { document.title = t ? `${t} · ${S.store_name}` : S.store_name; }
const img = (src, alt = '', eager) => src ? `<img src="${esc(src)}" alt="${esc(alt)}" ${eager ? '' : 'loading="lazy" decoding="async"'}>` : '';
const skelGrid = (n = 8) => `<div class="grid">${Array.from({ length: n }, () => '<div><div class="skel card-s"></div><div class="skel" style="height:16px;margin:12px 0 6px;width:80%"></div><div class="skel" style="height:16px;width:40%"></div></div>').join('')}</div>`;

function card(p) {
  const out = !p.in_stock;
  return `<a class="card" href="/product/${esc(p.slug)}" data-link>
    <div class="ph">
      ${p.image ? img(p.image, p.name) : '<div class="noimg">No photo</div>'}
      ${p.image2 ? `<img class="alt" src="${esc(p.image2)}" alt="" loading="lazy" decoding="async">` : ''}
      ${out ? '<span class="pill out">Sold out</span>' : p.on_sale ? `<span class="pill">−${p.discount_percent}%</span>` : ''}
      ${p.has_video ? `<span class="vid" title="Has video">${ICON.play}</span>` : ''}
      ${out ? '' : `<button class="quick" data-quick="${p.id}" aria-label="Add ${esc(p.name)} to cart">${ICON.plus}</button>`}
    </div>
    <h3>${esc(p.name)}</h3>
    <div class="price"><b>${fmt(p.sale_price)}</b>${p.on_sale ? `<s>${fmt(p.price)}</s>` : ''}</div>
  </a>`;
}
let CARD_CACHE = new Map();
const remember = (list) => list.forEach((p) => CARD_CACHE.set(p.id, p));

/* --------------------------------------------------------------- chrome */
const render = {
  cartBadge() {
    const n = Cart.count(), b = $('#cartCount');
    b.hidden = !n; b.textContent = n;
    b.classList.remove('bump'); void b.offsetWidth; if (n) b.classList.add('bump');
  },
  chrome() {
    $('#brand').textContent = S.store_name;
    const a = $('#announce');
    a.hidden = !S.announcement; a.textContent = S.announcement || '';
    const nav = [['/', 'Home'], ['/shop', 'All products'], ['/shop?sale=1', 'Offers']]
      .concat(CATS.slice(0, 4).map((c) => [`/shop?category=${c.slug}`, c.name]));
    $('#nav').innerHTML = nav.map(([h, t]) => `<a href="${h}" data-link>${esc(t)}</a>`).join('');
    $('#menuLinks').innerHTML = [['/', 'Home'], ['/shop', 'All products'], ['/shop?sale=1', 'Offers']]
      .concat(CATS.map((c) => [`/shop?category=${c.slug}`, c.name]), [['/track', 'Track your order']])
      .map(([h, t]) => `<a class="mlink" href="${h}" data-link>${esc(t)}</a>`).join('');
    const social = [['facebook_url', 'Facebook'], ['instagram_url', 'Instagram']].filter(([k]) => S[k])
      .map(([k, n]) => `<a href="${esc(S[k])}" target="_blank" rel="noopener">${n}</a>`).join('');
    const wa = S.whatsapp ? `<a href="https://wa.me/${esc(String(S.whatsapp).replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp</a>` : '';
    $('#foot').innerHTML = `<div class="wrap"><div class="foot-in">
      <div><div class="fb">${esc(S.store_name)}</div><p>${esc(S.tagline)}</p></div>
      <div><b>Shop</b><a href="/shop" data-link>All products</a><a href="/shop?sale=1" data-link>Offers</a><a href="/track" data-link>Track your order</a></div>
      <div><b>Contact</b>${S.contact_phone ? `<a href="tel:${esc(S.contact_phone)}">${esc(S.contact_phone)}</a>` : ''}${S.contact_email ? `<a href="mailto:${esc(S.contact_email)}">${esc(S.contact_email)}</a>` : ''}${S.contact_address ? `<span>${esc(S.contact_address)}</span>` : ''}${social}${wa}</div>
    </div><div class="copy">© ${new Date().getFullYear()} ${esc(S.store_name)}. All rights reserved.</div></div>`;
  },
  cart() {
    const body = $('#cartBody'), foot = $('#cartFoot');
    if (!Cart.items.length) {
      body.innerHTML = '<div class="empty"><h3>Your cart is empty</h3><p>Add something you like and it will show up here.</p><p style="margin-top:18px"><a class="btn sm" href="/shop" data-link data-close>Start shopping</a></p></div>';
      foot.innerHTML = ''; return;
    }
    body.innerHTML = Cart.items.map((i) => `<div class="li">
      <a href="/product/${esc(i.slug)}" data-link data-close>${i.image ? img(i.image, i.name) : '<div class="noimg"></div>'}</a>
      <div><h4>${esc(i.name)}</h4><div class="price"><b>${fmt(i.price)}</b></div>
        <div class="row"><div class="qty sm"><button data-dec="${i.id}" aria-label="Decrease quantity">−</button><span>${i.qty}</span><button data-inc="${i.id}" aria-label="Increase quantity">+</button></div>
        <button class="rm" data-rm="${i.id}">Remove</button></div></div></div>`).join('');
    const free = +S.free_shipping_over || 0, sub = Cart.subtotal(), ship = Cart.shipping();
    const note = free > 0 ? (sub >= free
      ? `<div class="ship-note">You get free delivery on this order.<div class="bar"><i style="width:100%"></i></div></div>`
      : `<div class="ship-note">Add ${fmt(free - sub)} more for free delivery.<div class="bar"><i style="width:${Math.min(100, sub / free * 100)}%"></i></div></div>`) : '';
    foot.innerHTML = `${note}<div class="sum-row"><span>Subtotal</span><span>${fmt(sub)}</span></div>
      <div class="sum-row"><span>Delivery</span><span>${ship ? fmt(ship) : 'Free'}</span></div>
      <div class="sum-row t"><span>Total</span><span>${fmt(Cart.total())}</span></div>
      <a class="btn block" style="margin-top:14px" href="/checkout" data-link data-close>Checkout</a>`;
  },
};

/* --------------------------------------------------------------- drawers */
let openDrawer = null, lastFocus = null;
function open(id) {
  close();
  lastFocus = document.activeElement;
  const d = $(id), s = $('#scrim');
  if (id === '#cartDrawer') render.cart();
  d.setAttribute('aria-hidden', 'false'); s.hidden = false;
  requestAnimationFrame(() => { d.classList.add('on'); s.classList.add('on'); });
  openDrawer = d; document.body.style.overflow = 'hidden';
  setTimeout(() => d.querySelector('[data-close]')?.focus(), 50);
}
function close() {
  if (!openDrawer) return;
  const d = openDrawer, s = $('#scrim');
  d.classList.remove('on'); s.classList.remove('on'); d.setAttribute('aria-hidden', 'true');
  setTimeout(() => { s.hidden = true; }, 260);
  openDrawer = null; document.body.style.overflow = '';
  lastFocus?.focus?.();
}

/* ---------------------------------------------------------------- router */
const routes = [
  [/^\/$/, home],
  [/^\/shop\/?$/, shop],
  [/^\/product\/([^/]+)\/?$/, product],
  [/^\/checkout\/?$/, checkout],
  [/^\/order\/([^/]+)\/?$/, order],
  [/^\/track\/?$/, track],
];
let navToken = 0;
async function route(push) {
  const url = new URL(location.href);
  const tok = ++navToken;
  document.body.classList.remove('has-sticky');
  const hit = routes.map(([re, fn]) => [url.pathname.match(re), fn]).find(([m]) => m);
  app.innerHTML = '';
  try {
    if (hit) await hit[1](hit[0].slice(1).map(decodeURIComponent), url, () => tok === navToken);
    else app.innerHTML = '<div class="wrap empty"><h3>Page not found</h3><p><a class="link" href="/" data-link>Go to the home page</a></p></div>';
  } catch (e) {
    if (tok === navToken) app.innerHTML = `<div class="wrap empty"><h3>We couldn’t load this page</h3><p>${esc(e.message)}</p><p style="margin-top:16px"><button class="btn sm" onclick="location.reload()">Try again</button></p></div>`;
  }
  document.querySelectorAll('#nav a').forEach((a) => {
    const same = a.getAttribute('href') === location.pathname + location.search;
    same ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
}
function go(href) {
  history.pushState({}, '', href);
  window.scrollTo(0, 0);
  route();
}

/* ------------------------------------------------------------------ home */
async function home(_, __, alive) {
  setTitle('');
  const hasImg = !!S.hero_image;
  app.innerHTML = `<section class="hero ${hasImg ? 'has-img' : ''}">
    ${hasImg ? `<img class="hero-bg" src="${esc(S.hero_image)}" alt="" fetchpriority="high">` : ''}
    <div class="wrap hero-in"><div><h1>${esc(S.hero_title)}</h1><p>${esc(S.hero_subtitle)}</p>
      <div class="hero-actions"><a class="btn" href="/shop" data-link>${esc(S.hero_cta || 'Shop now')}</a><a class="btn ghost" href="/shop?sale=1" data-link>See offers</a></div></div>
      ${hasImg ? '' : '<div class="mosaic" id="mosaic"></div>'}</div></section>
    <div class="wrap">
      <section class="sec" id="catSec" hidden><div class="sec-head"><h2>Browse by category</h2></div><div class="cats" id="homeCats"></div></section>
      <section class="sec"><div class="sec-head"><h2>New and popular</h2><a class="link" href="/shop" data-link>View all</a></div><div id="feat">${skelGrid(4)}</div></section>
      <section class="sec" id="saleSec" hidden><div class="sec-head"><h2>On offer now</h2><a class="link" href="/shop?sale=1" data-link>View all</a></div><div id="sale"></div></section>
      <div class="perks">
        <div>${ICON.truck}<p><b>Fast delivery</b><span>Dhaka and all over Bangladesh.</span></p></div>
        <div>${ICON.cash}<p><b>Pay your way</b><span>Cash on delivery or online payment.</span></p></div>
        <div>${ICON.shield}<p><b>Safe checkout</b><span>Your payment details stay with the bank.</span></p></div>
      </div></div>`;
  if (CATS.length) {
    $('#catSec').hidden = false;
    $('#homeCats').innerHTML = CATS.map((c) => `<a class="chip" href="/shop?category=${esc(c.slug)}" data-link>${esc(c.name)}<small>${c.count}</small></a>`).join('');
  }
  const [feat, sale] = await Promise.all([api('products?limit=8&sort=new'), api('products?on_sale=1&limit=4&sort=discount')]);
  if (!alive()) return;
  remember(feat.items); remember(sale.items);
  $('#feat').innerHTML = feat.items.length ? `<div class="grid">${feat.items.map(card).join('')}</div>`
    : '<div class="empty"><h3>No products yet</h3><p>Products you add in the admin panel will appear here.</p></div>';
  if (sale.items.length) { $('#saleSec').hidden = false; $('#sale').innerHTML = `<div class="grid">${sale.items.map(card).join('')}</div>`; }
  const m = $('#mosaic');
  if (m) {
    const pics = feat.items.filter((p) => p.image).slice(0, 4);
    m.innerHTML = pics.map((p) => `<a href="/product/${esc(p.slug)}" data-link>${img(p.image, p.name, true)}<span class="tag">${esc(p.name)}</span></a>`).join('');
    if (!pics.length) m.remove();
  }
}

/* ------------------------------------------------------------------ shop */
async function shop(_, url, alive) {
  const q = url.searchParams, cat = q.get('category') || '', search = q.get('q') || '', sale = q.get('sale') === '1', sort = q.get('sort') || '';
  const catName = CATS.find((c) => c.slug === cat)?.name;
  const title = search ? `Results for “${search}”` : sale ? 'Offers' : catName || 'All products';
  setTitle(title);
  const link = (o) => { const n = new URLSearchParams({ category: cat, q: search, sale: sale ? 1 : '', sort, ...o }); [...n].forEach(([k, v]) => !v && n.delete(k)); return '/shop' + (n.toString() ? '?' + n : ''); };
  app.innerHTML = `<div class="wrap"><div class="crumbs"><a href="/" data-link>Home</a> / ${esc(title)}</div>
    <div class="shop-top"><h1>${esc(title)}</h1>
      <select class="sel" id="sort" aria-label="Sort products"><option value="">Featured</option><option value="new">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="discount">Biggest discount</option></select></div>
    <div class="cats" style="margin-bottom:18px"><a class="chip ${!cat ? 'on' : ''}" href="${link({ category: '' })}" data-link>All</a>${CATS.map((c) => `<a class="chip ${c.slug === cat ? 'on' : ''}" href="${link({ category: c.slug })}" data-link>${esc(c.name)}<small>${c.count}</small></a>`).join('')}</div>
    <div id="list">${skelGrid(8)}</div><div class="more" id="more" hidden><button class="btn ghost" id="moreBtn">Show more</button></div></div>`;
  $('#sort').value = sort;
  $('#sort').onchange = (e) => go(link({ sort: e.target.value }));
  const PAGE = 24; let offset = 0, shown = 0;
  const params = () => `products?limit=${PAGE}&offset=${offset}${cat ? '&category=' + encodeURIComponent(cat) : ''}${search ? '&q=' + encodeURIComponent(search) : ''}${sale ? '&on_sale=1' : ''}${sort ? '&sort=' + sort : ''}`;
  const load = async (first) => {
    const r = await api(params());
    if (!alive()) return;
    remember(r.items); shown += r.items.length; offset += PAGE;
    if (first) $('#list').innerHTML = r.items.length ? '<div class="grid" id="g"></div>' : `<div class="empty"><h3>Nothing found</h3><p>Try another search or <a class="link" href="/shop" data-link>browse all products</a>.</p></div>`;
    $('#g')?.insertAdjacentHTML('beforeend', r.items.map(card).join(''));
    $('#more').hidden = shown >= r.total;
  };
  $('#moreBtn').onclick = () => load(false).catch((e) => toast(e.message));
  await load(true);
}

/* --------------------------------------------------------------- product */
async function product([slug], _, alive) {
  app.innerHTML = '<div class="wrap"><div class="pdp"><div class="skel" style="aspect-ratio:1"></div><div><div class="skel" style="height:40px;width:80%"></div><div class="skel" style="height:30px;width:40%;margin-top:18px"></div></div></div></div>';
  const p = await api('products/' + encodeURIComponent(slug));
  if (!alive()) return;
  remember([p]); setTitle(p.name);
  let media = p.media.length ? p.media : [];
  const left = p.stock;
  const stock = left <= 0 ? '<p class="stock out">Sold out</p>' : left <= 5 ? `<p class="stock low">Only ${left} left</p>` : '<p class="stock in">In stock</p>';
  const specs = p.specs.length ? `<div class="tabs"><h2>Specifications</h2><table class="specs">${p.specs.map((s) => `<tr><th>${esc(s.key)}</th><td>${esc(s.value)}</td></tr>`).join('')}</table></div>` : '';
  const desc = p.description ? `<div class="tabs"><h2>About this product</h2><p class="desc">${esc(p.description)}</p></div>` : '';
  app.innerHTML = `<div class="wrap"><div class="crumbs"><a href="/" data-link>Home</a> / ${p.category_slug ? `<a href="/shop?category=${esc(p.category_slug)}" data-link>${esc(p.category_name)}</a> / ` : ''}${esc(p.name)}</div>
    <div class="pdp"><div><div class="gal-main" id="gm"></div><div class="thumbs" id="th"></div></div>
    <div class="buy">${p.category_name ? `<div class="cat">${esc(p.category_name)}</div>` : ''}<h1>${esc(p.name)}</h1>
      <div class="big price"><b>${fmt(p.sale_price)}</b>${p.on_sale ? `<s>${fmt(p.price)}</s><span class="save">Save ${p.discount_percent}%</span>` : ''}</div>
      ${p.short_desc ? `<p class="short">${esc(p.short_desc)}</p>` : ''}${stock}
      <div class="buyrow" ${left <= 0 ? 'hidden' : ''}><div class="qty"><button id="qd" aria-label="Decrease quantity">−</button><span id="qv">1</span><button id="qi" aria-label="Increase quantity">+</button></div>
        <button class="btn" id="add">Add to cart</button></div>
      ${left <= 0 ? '<button class="btn block" disabled>Sold out</button>' : '<button class="btn ghost block" id="buyNow" style="margin-top:12px">Buy now</button>'}
      <div class="trust"><div>${ICON.truck}Delivery across Bangladesh</div><div>${ICON.cash}Cash on delivery available</div><div>${ICON.shield}Secure online payment</div></div>
    </div></div>${desc}${specs}
    ${p.related.length ? `<section class="sec"><div class="sec-head"><h2>You may also like</h2></div><div class="grid">${p.related.map(card).join('')}</div></section>` : ''}</div>
    ${left > 0 ? `<div class="sticky-buy"><div class="price"><b>${fmt(p.sale_price)}</b>${p.on_sale ? `<s>${fmt(p.price)}</s>` : ''}</div><button class="btn" id="add2">Add to cart</button></div>` : ''}`;
  remember(p.related);
  if (left > 0) document.body.classList.add('has-sticky');

  const show = (i) => {
    const m = media[i], gm = $('#gm');
    gm.innerHTML = !m ? '<div class="noimg" style="height:100%;display:grid;place-items:center;color:#7b8290">No photo yet</div>'
      : m.type === 'video' ? `<video src="${esc(m.url)}" controls playsinline preload="metadata" ${media.find((x) => x.type === 'image') ? `poster="${esc(media.find((x) => x.type === 'image').url)}"` : ''}></video>`
      : img(m.url, p.name, true);
    document.querySelectorAll('#th button').forEach((b, j) => b.classList.toggle('on', i === j));
  };
  $('#th').innerHTML = media.length > 1 ? media.map((m, i) => `<button data-i="${i}" aria-label="Show ${m.type} ${i + 1}">${m.type === 'video' ? `<div class="play">${ICON.play}</div>` : img(m.url, '')}</button>`).join('') : '';
  $('#th').onclick = (e) => { const b = e.target.closest('button'); if (b) show(+b.dataset.i); };
  show(0);

  let qty = 1;
  const setQ = (n) => { qty = Math.min(Math.max(1, n), Math.max(1, left)); $('#qv').textContent = qty; };
  if (left > 0) {
    $('#qd').onclick = () => setQ(qty - 1); $('#qi').onclick = () => setQ(qty + 1);
    const add = () => { Cart.add(p, qty); toast('Added to cart'); };
    $('#add').onclick = add; $('#add2').onclick = () => { Cart.add(p, 1); toast('Added to cart'); };
    $('#buyNow').onclick = () => { Cart.add(p, qty); go('/checkout'); };
  }
}

/* -------------------------------------------------------------- checkout */
async function checkout(_, __, alive) {
  setTitle('Checkout');
  if (!Cart.items.length) { app.innerHTML = '<div class="wrap empty"><h3>Your cart is empty</h3><p><a class="link" href="/shop" data-link>Find something you like</a></p></div>'; return; }
  const online = S.online_available, cod = S.cod_available;
  if (!online && !cod) { app.innerHTML = '<div class="wrap empty"><h3>Checkout is paused</h3><p>Ordering is not available right now. Please come back soon.</p></div>'; return; }
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('cust') || '{}'); } catch {}
  const v = (k) => esc(saved[k] || '');
  const items = () => Cart.items.map((i) => `<div class="mini">${i.image ? img(i.image, '') : '<div class="noimg"></div>'}<span>${esc(i.name)}<small>Qty ${i.qty}</small></span><b>${fmt(i.price * i.qty)}</b></div>`).join('');
  app.innerHTML = `<div class="wrap"><form class="co" id="cf" novalidate><div>
    <h1>Checkout</h1><div id="err" class="err" hidden></div>
    <h2 style="margin-top:0">Delivery details</h2><div class="f two">
      <div class="field"><label for="name">Full name</label><input id="name" autocomplete="name" required value="${v('name')}"></div>
      <div class="field"><label for="phone">Mobile number</label><input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="01712345678" required value="${v('phone')}"></div></div>
    <div class="f" style="margin-top:14px">
      <div class="field"><label for="address">Full address</label><textarea id="address" autocomplete="street-address" placeholder="House, road, area" required>${v('address')}</textarea></div></div>
    <div class="f two" style="margin-top:14px">
      <div class="field"><label for="city">City or district</label><input id="city" autocomplete="address-level2" value="${v('city')}"></div>
      <div class="field"><label for="email">Email <i>(optional)</i></label><input id="email" type="email" autocomplete="email" value="${v('email')}"></div></div>
    <div class="f" style="margin-top:14px"><div class="field"><label for="note">Note for delivery <i>(optional)</i></label><input id="note"></div></div>
    <h2>Payment</h2><div class="pay">
      ${online ? `<label><input type="radio" name="pm" value="online" ${online ? 'checked' : ''}><div><b>Pay online</b><span>bKash, Nagad, Rocket, cards and internet banking.</span></div></label>` : ''}
      ${cod ? `<label><input type="radio" name="pm" value="cod" ${!online ? 'checked' : ''}><div><b>Cash on delivery</b><span>Pay when your order arrives.</span></div></label>` : ''}</div>
    </div><aside><div class="box"><h2 style="margin:0 0 8px">Order summary</h2><div id="mini">${items()}</div>
      <div class="sum-row"><span>Subtotal</span><span>${fmt(Cart.subtotal())}</span></div>
      <div class="sum-row"><span>Delivery</span><span>${Cart.shipping() ? fmt(Cart.shipping()) : 'Free'}</span></div>
      <div class="sum-row t"><span>Total</span><span>${fmt(Cart.total())}</span></div>
      <button class="btn block" id="place" style="margin-top:16px">Place order</button></div></aside></form></div>`;
  $('#cf').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#err'), btn = $('#place'), g = (id) => $('#' + id).value.trim();
    const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    err.hidden = true;
    if (!g('name')) return fail('Enter your full name.');
    if (!/^(?:\+?88)?01[3-9]\d{8}$/.test(g('phone').replace(/[\s-]/g, ''))) return fail('Enter a valid mobile number, like 01712345678.');
    if (g('address').length < 8) return fail('Enter your full delivery address.');
    const customer = { name: g('name'), phone: g('phone'), address: g('address'), city: g('city'), email: g('email'), note: g('note') };
    try { localStorage.setItem('cust', JSON.stringify(customer)); } catch {}
    btn.disabled = true; btn.textContent = 'Placing order…';
    try {
      const r = await api('orders', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer, payment_method: document.querySelector('input[name=pm]:checked').value, items: Cart.items.map((i) => ({ id: i.id, qty: i.qty })) }) });
      Cart.clear();
      if (r.payment_url) location.href = r.payment_url; else go(`/order/${r.order_no}?k=${r.token}`);
    } catch (ex) { btn.disabled = false; btn.textContent = 'Place order'; fail(ex.message); }
  };
}

/* ----------------------------------------------------------- order pages */
async function order([no], url, alive) {
  setTitle('Order ' + no);
  const qs = url.searchParams;
  const o = await api(`orders/${encodeURIComponent(no)}?k=${encodeURIComponent(qs.get('k') || '')}&phone=${encodeURIComponent(qs.get('phone') || '')}`).catch((e) => ({ error: e.message }));
  if (!alive()) return;
  if (o.error) { app.innerHTML = `<div class="wrap empty"><h3>Order not found</h3><p>${esc(o.error)}</p><p style="margin-top:16px"><a class="btn sm" href="/track" data-link>Track an order</a></p></div>`; return; }
  const flow = ['pending', 'confirmed', 'shipped', 'delivered'], at = flow.indexOf(o.status);
  const label = { pending: 'Received', confirmed: 'Confirmed', shipped: 'On the way', delivered: 'Delivered' };
  const cancelled = o.status === 'cancelled';
  const paid = o.payment_status === 'paid';
  const payMsg = qs.get('pay') === 'failed' ? 'Your payment did not go through, so the order was cancelled. You can place it again.'
    : qs.get('pay') === 'cancelled' ? 'You cancelled the payment, so the order was cancelled. You can place it again.' : '';
  const head = cancelled ? 'This order was cancelled' : o.payment_method === 'online' && !paid ? 'We’re confirming your payment' : 'Thank you, your order is placed';
  const lead = cancelled ? '' : o.payment_method === 'online' && !paid ? 'This page updates once the bank confirms. Refresh in a minute if it still shows unpaid.'
    : o.payment_method === 'cod' ? `We will call you to confirm. Keep ${fmt(o.total)} ready for the delivery person.` : 'Payment received. We will let you know when it ships.';
  app.innerHTML = `<div class="wrap"><div class="done"><div class="tick">${ICON.tick}</div>
    ${payMsg || cancelled ? `<div class="status-bad">${esc(payMsg || 'This order was cancelled.')}</div>` : ''}
    <h1>${esc(head)}</h1><p class="lead">${esc(lead)}</p>
    ${cancelled ? '' : `<div class="steps">${flow.map((s, i) => `<div class="${i <= at ? 'on' : ''}">${label[s]}</div>`).join('')}</div>`}
    <div class="box" style="margin-top:24px"><dl class="kv"><dt>Order number</dt><dd><b>${esc(o.order_no)}</b></dd><dt>Placed</dt><dd>${esc(new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</dd>
      <dt>Deliver to</dt><dd>${esc(o.name)}, ${esc(o.phone)}<br>${esc(o.address)}${o.city ? ', ' + esc(o.city) : ''}</dd>
      <dt>Payment</dt><dd>${o.payment_method === 'cod' ? 'Cash on delivery' : 'Online'} · ${paid ? 'Paid' : o.payment_status === 'failed' ? 'Failed' : 'Not paid yet'}</dd></dl></div>
    <div class="box" style="margin-top:16px">${o.items.map((i) => `<div class="mini">${i.image ? img(i.image, '') : '<div class="noimg"></div>'}<span>${esc(i.name)}<small>Qty ${i.qty}</small></span><b>${fmt(i.price * i.qty)}</b></div>`).join('')}
      <div class="sum-row"><span>Subtotal</span><span>${fmt(o.subtotal)}</span></div><div class="sum-row"><span>Delivery</span><span>${o.shipping ? fmt(o.shipping) : 'Free'}</span></div><div class="sum-row t"><span>Total</span><span>${fmt(o.total)}</span></div></div>
    <p style="margin-top:22px"><a class="btn ghost" href="/shop" data-link>Continue shopping</a></p></div></div>`;
  if (!cancelled && !payMsg) try { localStorage.removeItem('cart'); Cart.load(); render.cartBadge(); } catch {}
}

function track() {
  setTitle('Track your order');
  app.innerHTML = `<div class="wrap"><div class="done"><h1>Track your order</h1><p class="lead">Enter the order number from your confirmation and the mobile number you used.</p>
    <form id="tf" class="f" style="max-width:420px"><div class="field"><label for="no">Order number</label><input id="no" placeholder="ORD2610281234" required></div>
    <div class="field"><label for="ph">Mobile number</label><input id="ph" type="tel" inputmode="tel" placeholder="01712345678" required></div>
    <button class="btn">Track order</button></form></div></div>`;
  $('#tf').onsubmit = (e) => { e.preventDefault(); go(`/order/${encodeURIComponent($('#no').value.trim().toUpperCase())}?phone=${encodeURIComponent($('#ph').value.trim())}`); };
}

/* ------------------------------------------------------------------ boot */
document.addEventListener('click', (e) => {
  const q = e.target.closest('[data-quick]');
  if (q) { e.preventDefault(); const p = CARD_CACHE.get(+q.dataset.quick); if (p) { Cart.add(p, 1); toast('Added to cart'); } return; }
  const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]'), rm = e.target.closest('[data-rm]');
  if (inc || dec || rm) {
    const id = +(inc || dec || rm).dataset[inc ? 'inc' : dec ? 'dec' : 'rm'], it = Cart.items.find((i) => i.id === id);
    if (it) Cart.set(id, rm ? 0 : it.qty + (inc ? 1 : -1));
    render.cart(); return;
  }
  if (e.target.closest('[data-close]') && !e.target.closest('a')) { close(); return; }
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && a.target !== '_blank') {
    e.preventDefault(); close(); go(a.getAttribute('href'));
  }
});
$('#scrim').onclick = close;
$('#cartBtn').onclick = () => open('#cartDrawer');
$('#menuBtn').onclick = () => open('#menuDrawer');
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
$('#searchForm').onsubmit = (e) => { e.preventDefault(); const v = $('#searchInput').value.trim(); if (v) go('/shop?q=' + encodeURIComponent(v)); };
window.addEventListener('popstate', () => route());
window.addEventListener('storage', (e) => { if (e.key === 'cart') { Cart.load(); render.cartBadge(); } });

(async function boot() {
  Cart.load(); render.cartBadge();
  try {
    const [s, c] = await Promise.all([api('settings'), api('categories')]);
    S = { ...S, ...s }; CATS = c;
  } catch (e) { /* the page still renders; route() will show the error */ }
  render.chrome(); setTitle('');
  route();
})();
})();
