/* Admin panel: product, photo/video, price, discount, specs, orders and store settings. */
(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '৳' + Number(n || 0).toLocaleString('en-IN');
const when = (d) => new Date(String(d).replace(' ', 'T') + 'Z').toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const X = '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>';
const L = '<svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>';
const R = '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>';
const STAR = '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>';

let toastT;
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('bad', !!bad); t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), bad ? 4200 : 2200);
}

async function api(path, opts = {}) {
  const res = await fetch('/api/' + path, {
    ...opts,
    headers: { 'X-Requested-With': 'admin', ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('admin/login')) { showLogin(); throw new Error('Please sign in again.'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
const send = (method, path, obj) => api(path, { method, body: JSON.stringify(obj || {}) });

/* ----------------------------------------------------------------- login */
function showLogin() { $('#shell').hidden = true; $('#login').hidden = false; $('#pw').focus(); }
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  const b = $('#loginBtn'), err = $('#loginErr'); err.hidden = true; b.disabled = true; b.textContent = 'Signing in…';
  try { await send('POST', 'admin/login', { password: $('#pw').value }); $('#pw').value = ''; await start(); }
  catch (ex) { err.textContent = ex.message; err.hidden = false; }
  b.disabled = false; b.textContent = 'Sign in';
};
$('#logout').onclick = async () => { try { await send('POST', 'admin/logout'); } catch {} showLogin(); };
$('#burger').onclick = () => $('#side').classList.toggle('on');
document.addEventListener('click', (e) => { if (!e.target.closest('#side') && !e.target.closest('#burger')) $('#side').classList.remove('on'); });

/* ---------------------------------------------------------------- router */
const pages = { '': dashboard, products: products, 'products/new': () => productForm(), orders: orders, categories: categories, settings: settings };
let CATS = [];
async function route() {
  const h = location.hash.replace(/^#\/?/, '');
  $('#side').classList.remove('on');
  $('#topAct').innerHTML = '';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', h === a.dataset.r || (a.dataset.r && h.startsWith(a.dataset.r + '/'))));
  view.innerHTML = '<p class="muted">Loading…</p>';
  try {
    let m;
    if ((m = h.match(/^products\/(\d+)$/))) await productForm(+m[1]);
    else if ((m = h.match(/^orders\/(\d+)$/))) await orderDetail(+m[1]);
    else await (pages[h] || dashboard)();
  } catch (e) { view.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
const title = (t) => { $('#pageTitle').textContent = t; document.title = t + ' · Admin'; };
const statusTag = { pending: 'warn', confirmed: 'blue', shipped: 'blue', delivered: 'ok', cancelled: 'bad' };

async function refreshBadge() {
  try {
    const s = await api('admin/stats'); const b = $('#pendBadge');
    b.hidden = !s.pending_orders; b.textContent = s.pending_orders; return s;
  } catch {}
}

/* ------------------------------------------------------------- dashboard */
async function dashboard() {
  title('Dashboard');
  const s = await refreshBadge();
  const st = await api('admin/settings').catch(() => null);
  const pay = st?._payments;
  view.innerHTML = `
    ${pay && !pay.sslcommerz_configured ? '<div class="note">Online payment is switched off because SSLCommerz keys are not added yet. Customers can still pay with cash on delivery. See README step 6.</div>' : ''}
    ${pay && pay.sslcommerz_configured && !pay.live_mode ? '<div class="note">Online payment is in test mode. No real money moves until you set SSLC_LIVE to true.</div>' : ''}
    <div class="cards"><div class="stat"><span>Orders today</span><b>${s.today_orders}</b></div><div class="stat"><span>Sales today</span><b>${money(s.today_sales)}</b></div>
      <div class="stat"><span>Waiting for you</span><b>${s.pending_orders}</b></div><div class="stat"><span>Low stock products</span><b>${s.low_stock}</b></div></div>
    <div class="panel"><h2>Recent orders</h2>${s.recent.length ? `<div class="tw"><table class="t"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Status</th><th>Placed</th></tr></thead><tbody>
      ${s.recent.map((o) => `<tr class="click" onclick="location.hash='#/orders/${o.id}'"><td><b>${esc(o.order_no)}</b></td><td>${esc(o.name)}</td><td>${money(o.total)}</td><td><span class="tag ${o.payment_status === 'paid' ? 'ok' : o.payment_status === 'failed' ? 'bad' : ''}">${o.payment_status}</span></td><td><span class="tag ${statusTag[o.status]}">${o.status}</span></td><td class="muted">${when(o.created_at)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No orders yet. They will show up here as soon as a customer checks out.</div>'}</div>
    <div class="panel"><h2>Quick actions</h2><div class="tools" style="margin:0"><a class="btn" href="#/products/new">Add a product</a><a class="btn ghost" href="#/categories">Manage categories</a><a class="btn ghost" href="#/settings">Edit store settings</a></div></div>`;
}

/* -------------------------------------------------------------- products */
async function products() {
  title('Products');
  $('#topAct').innerHTML = '<a class="btn" href="#/products/new">Add product</a>';
  view.innerHTML = `<div class="tools"><input id="q" type="search" placeholder="Search by name or SKU" aria-label="Search products"><select id="sf" aria-label="Filter"><option value="">All products</option><option value="low">Low stock (5 or fewer)</option></select></div><div class="panel" style="padding:8px 12px" id="plist"></div>`;
  let timer;
  const load = async () => {
    const r = await api(`admin/products?limit=200&q=${encodeURIComponent($('#q').value)}&stock=${$('#sf').value}`);
    $('#plist').innerHTML = r.items.length ? `<div class="tw"><table class="t"><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead><tbody>${r.items.map((p) => `
      <tr class="click" onclick="location.hash='#/products/${p.id}'"><td><div class="pname">${p.image ? `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy">` : '<div class="thumb"></div>'}<span>${esc(p.name)}<br><small class="muted">${esc(p.category_name || 'No category')}${p.sku ? ' · ' + esc(p.sku) : ''}</small></span></div></td>
      <td>${p.on_sale ? `<b>${money(p.sale_price)}</b> <s class="muted">${money(p.price)}</s>` : `<b>${money(p.price)}</b>`}</td>
      <td><span class="tag ${p.stock <= 0 ? 'bad' : p.stock <= 5 ? 'warn' : 'ok'}">${p.stock <= 0 ? 'Sold out' : p.stock + ' in stock'}</span></td>
      <td><span class="tag ${p.active ? 'ok' : ''}">${p.active ? 'Visible' : 'Hidden'}</span></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty"><p>${$('#q').value || $('#sf').value ? 'No products match.' : 'You have not added any products yet.'}</p><p style="margin-top:14px"><a class="btn" href="#/products/new">Add your first product</a></p></div>`;
  };
  $('#q').oninput = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  $('#sf').onchange = load;
  await load();
}

/* --- image: shrink big phone photos in the browser before upload (faster + cheaper) */
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const max = 1800, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.86));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}
function upload(blob, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/admin/upload');
    x.setRequestHeader('Content-Type', blob.type); x.setRequestHeader('X-Requested-With', 'admin');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {} x.status < 300 ? resolve(d) : reject(new Error(d.error || (x.status === 401 ? 'Please sign in again.' : 'Upload failed.'))); };
    x.onerror = () => reject(new Error('Upload failed. Check your internet connection.'));
    x.send(blob);
  });
}

async function productForm(id) {
  const isNew = !id;
  title(isNew ? 'Add product' : 'Edit product');
  const [cats, p] = await Promise.all([api('admin/categories'), isNew ? null : api('admin/products/' + id)]);
  CATS = cats;
  const d = p || { name: '', short_desc: '', description: '', category_id: '', price: '', discount_type: 'none', discount_value: 0, stock: 0, sku: '', active: true, featured: false, media: [], specs: [] };
  let media = [...d.media], specs = d.specs.length ? [...d.specs] : [{ key: '', value: '' }];
  $('#topAct').innerHTML = '<a class="btn ghost" href="#/products">Back to products</a>';
  view.innerHTML = `<form class="form" id="pf" novalidate>
    <div id="perr" class="err" hidden></div>
    <div class="panel"><h2>Basic details</h2><div class="form">
      <div class="fld"><label for="name">Product name</label><input id="name" required value="${esc(d.name)}"></div>
      <div class="fld"><label for="short">Short summary</label><input id="short" maxlength="300" value="${esc(d.short_desc)}"><div class="hint">One or two lines shown under the name.</div></div>
      <div class="fld"><label for="desc">Full description</label><textarea id="desc">${esc(d.description)}</textarea></div>
      <div class="g2"><div class="fld"><label for="cat">Category</label><select id="cat"><option value="">No category</option>${cats.map((c) => `<option value="${c.id}" ${c.id === d.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>${cats.length ? '' : '<div class="hint">Add categories first from the Categories page.</div>'}</div>
        <div class="fld"><label for="sku">SKU <small class="muted">(optional)</small></label><input id="sku" value="${esc(d.sku)}"></div></div></div></div>

    <div class="panel"><h2>Photos and videos</h2>
      <div class="drop" id="drop"><p><b>Drag files here</b> or choose from your device.</p><p class="muted" style="font-size:13.5px">Photos: JPG, PNG, WebP (large photos are shrunk automatically). Videos: MP4, WebM or MOV up to 90 MB.</p><button type="button" class="btn ghost sm" id="pick">Choose files</button><input id="file" type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple hidden></div>
      <div class="media" id="media"></div><div class="hint muted" style="margin-top:10px;font-size:12.5px">The first photo is the cover. Use the arrows to reorder.</div></div>

    <div class="panel"><h2>Price, discount and stock</h2><div class="g3">
      <div class="fld"><label for="price">Regular price (৳)</label><input id="price" type="number" min="0" inputmode="numeric" value="${esc(d.price)}"></div>
      <div class="fld"><label for="dt">Discount</label><select id="dt"><option value="none">No discount</option><option value="percent">Percent off</option><option value="fixed">Taka off</option></select></div>
      <div class="fld"><label for="dv" id="dvl">Discount amount</label><input id="dv" type="number" min="0" inputmode="numeric" value="${esc(d.discount_value)}"></div></div>
      <div class="pricebox" id="pb" style="margin-top:14px"></div>
      <div class="g2" style="margin-top:14px"><div class="fld"><label for="stock">Stock quantity</label><input id="stock" type="number" min="0" inputmode="numeric" value="${esc(d.stock)}"></div></div></div>

    <div class="panel"><h2>Specifications</h2><p class="muted" style="margin-bottom:12px">Shown as a table on the product page, such as Material, Size, Warranty.</p><div id="specs"></div><button type="button" class="btn ghost sm" id="addSpec">Add specification</button></div>

    <div class="panel"><h2>Visibility</h2><div class="form">
      <label class="chk"><input type="checkbox" id="active" ${d.active ? 'checked' : ''}> Show this product in the store</label>
      <label class="chk"><input type="checkbox" id="featured" ${d.featured ? 'checked' : ''}> Feature it first on the home and shop pages</label></div></div>

    <div class="savebar">${isNew ? '' : `<a class="btn ghost" href="/product/${esc(d.slug)}" target="_blank" rel="noopener" style="margin-right:auto">View in store</a><button type="button" class="btn danger" id="del">Delete</button>`}<button class="btn" id="save">${isNew ? 'Add product' : 'Save changes'}</button></div></form>`;

  $('#dt').value = d.discount_type;
  const calc = () => {
    const price = +$('#price').value || 0, t = $('#dt').value, v = +$('#dv').value || 0;
    $('#dvl').textContent = t === 'percent' ? 'Percent off (0 to 100)' : 'Discount amount (৳)'; $('#dv').disabled = t === 'none';
    const sale = t === 'percent' ? Math.round(price * (1 - Math.min(v, 100) / 100)) : t === 'fixed' ? Math.max(0, price - v) : price;
    $('#pb').innerHTML = sale < price ? `Customers pay <s>${money(price)}</s><b>${money(sale)}</b> (${Math.round((1 - sale / price) * 100)}% off)` : `Customers pay <b>${money(price)}</b>`;
  };
  ['price', 'dt', 'dv'].forEach((i) => $('#' + i).addEventListener('input', calc)); calc();

  const drawMedia = () => {
    $('#media').innerHTML = media.map((m, i) => `<div class="m">${m.type === 'video' ? `<video src="${esc(m.url)}" muted preload="metadata"></video><span class="vtag">Video</span>` : `<img src="${esc(m.url)}" alt="">${i === media.findIndex((x) => x.type === 'image') ? '<span class="cover">Cover</span>' : ''}`}
      <div class="acts"><span><button type="button" data-mv="${i}:-1" aria-label="Move earlier" ${i === 0 ? 'disabled' : ''}>${L}</button> <button type="button" data-mv="${i}:1" aria-label="Move later" ${i === media.length - 1 ? 'disabled' : ''}>${R}</button></span><button type="button" data-rm="${i}" aria-label="Remove">${X}</button></div></div>`).join('');
  };
  $('#media').onclick = (e) => {
    const rm = e.target.closest('[data-rm]'), mv = e.target.closest('[data-mv]');
    if (rm) media.splice(+rm.dataset.rm, 1);
    if (mv) { const [i, dir] = mv.dataset.mv.split(':').map(Number), j = i + dir; if (media[j]) [media[i], media[j]] = [media[j], media[i]]; }
    drawMedia();
  };
  drawMedia();

  let busy = 0;
  const addFiles = async (files) => {
    for (const f of [...files]) {
      const ok = /^(image\/(jpeg|png|webp|gif|avif)|video\/(mp4|webm|quicktime))$/.test(f.type);
      if (!ok) { toast(`“${f.name}” is not a supported photo or video.`, true); continue; }
      const tile = document.createElement('div'); tile.className = 'm up';
      tile.innerHTML = `<div>Uploading<i><b></b></i></div>`; $('#media').append(tile); busy++;
      try {
        const blob = f.type.startsWith('image/') ? await shrinkImage(f) : f;
        const r = await upload(blob, (p) => { tile.querySelector('b').style.width = Math.round(p * 100) + '%'; });
        media.push({ type: r.type, url: r.url });
      } catch (ex) { toast(`${f.name}: ${ex.message}`, true); }
      busy--; tile.remove(); drawMedia();
    }
  };
  $('#pick').onclick = () => $('#file').click();
  $('#file').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

  const drawSpecs = () => {
    $('#specs').innerHTML = specs.map((s, i) => `<div class="spec"><input data-k="${i}" placeholder="Name, e.g. Material" value="${esc(s.key)}" aria-label="Specification name"><input data-v="${i}" placeholder="Value, e.g. Cotton" value="${esc(s.value)}" aria-label="Specification value"><button type="button" data-rs="${i}" aria-label="Remove specification">${X}</button></div>`).join('');
  };
  $('#specs').oninput = (e) => { const k = e.target.dataset.k, v = e.target.dataset.v; if (k !== undefined) specs[k].key = e.target.value; if (v !== undefined) specs[v].value = e.target.value; };
  $('#specs').onclick = (e) => { const b = e.target.closest('[data-rs]'); if (b) { specs.splice(+b.dataset.rs, 1); if (!specs.length) specs.push({ key: '', value: '' }); drawSpecs(); } };
  $('#addSpec').onclick = () => { specs.push({ key: '', value: '' }); drawSpecs(); $('#specs').querySelector('.spec:last-child input').focus(); };
  drawSpecs();

  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#perr'), btn = $('#save'); err.hidden = true;
    const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    if (busy) return fail('Wait for the uploads to finish.');
    if (!$('#name').value.trim()) return fail('Enter the product name.');
    if ($('#price').value === '') return fail('Enter the regular price.');
    const body = { name: $('#name').value, short_desc: $('#short').value, description: $('#desc').value, category_id: $('#cat').value || null, sku: $('#sku').value,
      price: $('#price').value, discount_type: $('#dt').value, discount_value: $('#dv').value || 0, stock: $('#stock').value || 0,
      active: $('#active').checked, featured: $('#featured').checked, media, specs };
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (isNew) { const r = await send('POST', 'admin/products', body); toast('Product added'); location.hash = '#/products/' + r.id; }
      else { await send('PUT', 'admin/products/' + id, body); toast('Changes saved'); btn.textContent = 'Save changes'; btn.disabled = false; }
    } catch (ex) { fail(ex.message); btn.disabled = false; btn.textContent = isNew ? 'Add product' : 'Save changes'; }
  };
  if (!isNew) $('#del').onclick = async () => {
    if (!confirm(`Delete “${d.name}”? This also removes its photos and videos and cannot be undone.`)) return;
    try { await send('DELETE', 'admin/products/' + id); toast('Product deleted'); location.hash = '#/products'; } catch (ex) { toast(ex.message, true); }
  };
}

/* ------------------------------------------------------------ categories */
async function categories() {
  title('Categories');
  const draw = async () => {
    const list = await api('admin/categories');
    view.innerHTML = `<div class="panel"><h2>Add a category</h2><form id="cf" class="tools" style="margin:0"><input id="cn" placeholder="Category name" required aria-label="Category name"><button class="btn">Add category</button></form></div>
      <div class="panel" style="padding:8px 12px">${list.length ? `<div class="tw"><table class="t"><thead><tr><th>Name</th><th>Order</th><th>Products</th><th></th></tr></thead><tbody>${list.map((c) => `<tr><td><input class="cin" data-n="${c.id}" value="${esc(c.name)}" aria-label="Category name" style="border:1.5px solid var(--line);border-radius:8px;padding:8px 10px;width:100%;min-width:140px"></td>
        <td><input class="cin" data-s="${c.id}" type="number" value="${c.sort}" aria-label="Sort order" style="border:1.5px solid var(--line);border-radius:8px;padding:8px 10px;width:80px"></td><td class="muted">${c.count}</td>
        <td style="white-space:nowrap;text-align:right"><button class="btn ghost sm" data-save="${c.id}">Save</button> <button class="btn danger sm" data-del="${c.id}">Delete</button></td></tr>`).join('')}</tbody></table></div><p class="muted" style="padding:6px 12px 12px;font-size:13px">Lower order numbers appear first.</p>` : '<div class="empty">No categories yet. Add one above, such as “Shoes” or “Electronics”.</div>'}</div>`;
    $('#cf').onsubmit = async (e) => { e.preventDefault(); try { await send('POST', 'admin/categories', { name: $('#cn').value }); toast('Category added'); draw(); } catch (ex) { toast(ex.message, true); } };
    view.onclick = async (e) => {
      const s = e.target.closest('[data-save]'), d = e.target.closest('[data-del]');
      try {
        if (s) { const id = s.dataset.save; await send('PUT', 'admin/categories/' + id, { name: $(`[data-n="${id}"]`).value, sort: $(`[data-s="${id}"]`).value }); toast('Saved'); }
        if (d && confirm('Delete this category? Its products will stay, but without a category.')) { await send('DELETE', 'admin/categories/' + d.dataset.del); toast('Category deleted'); draw(); }
      } catch (ex) { toast(ex.message, true); }
    };
  };
  await draw();
}

/* ---------------------------------------------------------------- orders */
async function orders() {
  title('Orders');
  view.innerHTML = `<div class="tools"><input id="q" type="search" placeholder="Search by order number, name or phone" aria-label="Search orders"><select id="sf" aria-label="Filter by status"><option value="">All orders</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select></div><div class="panel" style="padding:8px 12px" id="ol"></div>`;
  let timer;
  const load = async () => {
    const r = await api(`admin/orders?limit=100&q=${encodeURIComponent($('#q').value)}&status=${$('#sf').value}`);
    $('#ol').innerHTML = r.items.length ? `<div class="tw"><table class="t"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Placed</th></tr></thead><tbody>${r.items.map((o) => `<tr class="click" onclick="location.hash='#/orders/${o.id}'"><td><b>${esc(o.order_no)}</b></td><td>${esc(o.name)}<br><small class="muted">${esc(o.phone)}</small></td><td>${o.items}</td><td>${money(o.total)}</td>
      <td><span class="tag ${o.payment_status === 'paid' ? 'ok' : o.payment_status === 'failed' ? 'bad' : ''}">${o.payment_method === 'cod' ? 'COD · ' : ''}${o.payment_status}</span></td><td><span class="tag ${statusTag[o.status]}">${o.status}</span></td><td class="muted">${when(o.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No orders found.</div>';
  };
  $('#q').oninput = () => { clearTimeout(timer); timer = setTimeout(load, 250); }; $('#sf').onchange = load;
  await load();
}
async function orderDetail(id) {
  const o = await api('admin/orders/' + id);
  title('Order ' + o.order_no);
  $('#topAct').innerHTML = '<a class="btn ghost" href="#/orders">Back to orders</a>';
  view.innerHTML = `<div class="g2"><div class="panel"><h2>Customer</h2><dl class="kv"><dt>Name</dt><dd>${esc(o.name)}</dd><dt>Phone</dt><dd><a href="tel:${esc(o.phone)}" style="color:var(--brand);font-weight:600">${esc(o.phone)}</a></dd>${o.email ? `<dt>Email</dt><dd>${esc(o.email)}</dd>` : ''}<dt>Address</dt><dd>${esc(o.address)}${o.city ? ', ' + esc(o.city) : ''}</dd>${o.note ? `<dt>Note</dt><dd>${esc(o.note)}</dd>` : ''}<dt>Placed</dt><dd>${when(o.created_at)}</dd></dl></div>
    <div class="panel"><h2>Update order</h2><div class="form"><div class="fld"><label for="os">Order status</label><select id="os">${['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'].map((s) => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="fld"><label for="ps">Payment status (${o.payment_method === 'cod' ? 'cash on delivery' : 'online'})</label><select id="ps">${['unpaid', 'paid', 'failed'].map((s) => `<option ${s === o.payment_status ? 'selected' : ''}>${s}</option>`).join('')}</select>${o.val_id ? `<div class="hint">Verified with SSLCommerz. Transaction ${esc(o.tran_id)}</div>` : ''}</div>
      <button class="btn" id="ou">Save order</button><p class="muted" style="font-size:13px">Cancelling an order puts its items back in stock.</p></div></div></div>
    <div class="panel"><h2>Items</h2><div class="tw"><table class="t"><tbody>${o.items.map((i) => `<tr><td><div class="pname">${i.image ? `<img class="thumb" src="${esc(i.image)}" alt="">` : '<div class="thumb"></div>'}<span>${esc(i.name)}</span></div></td><td>${money(i.price)} × ${i.qty}</td><td style="text-align:right"><b>${money(i.price * i.qty)}</b></td></tr>`).join('')}
      <tr><td></td><td class="muted">Subtotal</td><td style="text-align:right">${money(o.subtotal)}</td></tr><tr><td></td><td class="muted">Delivery</td><td style="text-align:right">${o.shipping ? money(o.shipping) : 'Free'}</td></tr><tr><td></td><td><b>Total</b></td><td style="text-align:right"><b style="font-size:18px">${money(o.total)}</b></td></tr></tbody></table></div></div>`;
  $('#ou').onclick = async () => {
    try { await send('PUT', 'admin/orders/' + id, { status: $('#os').value, payment_status: $('#ps').value }); toast('Order updated'); refreshBadge(); } catch (ex) { toast(ex.message, true); }
  };
}

/* -------------------------------------------------------------- settings */
async function settings() {
  title('Store settings');
  const s = await api('admin/settings');
  const f = (id, label, type = 'text', hint = '') => `<div class="fld"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(s[id])}">${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  view.innerHTML = `<form class="form" id="sf"><div id="serr" class="err" hidden></div>
    <div class="panel"><h2>Store</h2><div class="form"><div class="g2">${f('store_name', 'Store name')}${f('tagline', 'Tagline')}</div>${f('announcement', 'Top banner message', 'text', 'Leave empty to hide the banner.')}</div></div>
    <div class="panel"><h2>Home page hero</h2><div class="form">${f('hero_title', 'Headline')}${f('hero_subtitle', 'Sub headline')}${f('hero_cta', 'Button text')}
      <div class="fld"><label>Hero photo <small class="muted">(optional)</small></label><div id="hero" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"></div><div class="hint">Without a photo, the hero shows your newest products.</div></div></div></div>
    <div class="panel"><h2>Delivery</h2><div class="g2">${f('shipping_fee', 'Delivery charge (৳)', 'number')}${f('free_shipping_over', 'Free delivery over (৳)', 'number', 'Set to 0 to always charge delivery.')}</div></div>
    <div class="panel"><h2>Payment</h2>${s._payments.sslcommerz_configured ? `<div class="note ok">SSLCommerz is connected (${s._payments.live_mode ? 'live mode' : 'test mode'}).</div>` : '<div class="note">SSLCommerz is not connected yet, so online payment is hidden at checkout. Add your keys following README step 6.</div>'}
      <div class="form"><label class="chk"><input type="checkbox" id="cod_enabled" ${s.cod_enabled === '1' ? 'checked' : ''}> Allow cash on delivery</label><label class="chk"><input type="checkbox" id="online_enabled" ${s.online_enabled === '1' ? 'checked' : ''}> Allow online payment</label></div></div>
    <div class="panel"><h2>Contact and social</h2><div class="g2">${f('contact_phone', 'Phone')}${f('contact_email', 'Email', 'email')}${f('contact_address', 'Address')}${f('whatsapp', 'WhatsApp number', 'text', 'With country code, e.g. 8801712345678')}${f('facebook_url', 'Facebook page link', 'url')}${f('instagram_url', 'Instagram link', 'url')}</div></div>
    <div class="savebar"><button class="btn">Save settings</button></div></form>`;
  let hero = s.hero_image;
  const drawHero = () => {
    $('#hero').innerHTML = `${hero ? `<img src="${esc(hero)}" alt="" style="width:160px;height:90px;object-fit:cover;border-radius:10px">` : ''}<button type="button" class="btn ghost sm" id="hp">${hero ? 'Replace photo' : 'Upload photo'}</button>${hero ? '<button type="button" class="btn danger sm" id="hr">Remove</button>' : ''}<input type="file" id="hf" accept="image/*" hidden><span id="hs" class="muted"></span>`;
    $('#hp').onclick = () => $('#hf').click();
    $('#hf').onchange = async (e) => { const file = e.target.files[0]; if (!file) return; $('#hs').textContent = 'Uploading…'; try { const r = await upload(await shrinkImage(file), () => {}); hero = r.url; drawHero(); } catch (ex) { toast(ex.message, true); $('#hs').textContent = ''; } };
    if ($('#hr')) $('#hr').onclick = () => { hero = ''; drawHero(); };
  };
  drawHero();
  $('#sf').onsubmit = async (e) => {
    e.preventDefault();
    const body = { hero_image: hero };
    ['store_name', 'tagline', 'announcement', 'hero_title', 'hero_subtitle', 'hero_cta', 'shipping_fee', 'free_shipping_over', 'contact_phone', 'contact_email', 'contact_address', 'whatsapp', 'facebook_url', 'instagram_url'].forEach((k) => (body[k] = $('#' + k).value));
    body.cod_enabled = $('#cod_enabled').checked ? '1' : '0'; body.online_enabled = $('#online_enabled').checked ? '1' : '0';
    if (body.cod_enabled === '0' && body.online_enabled === '0') { const er = $('#serr'); er.textContent = 'Keep at least one payment method on, or customers cannot check out.'; er.hidden = false; return; }
    try { await send('PUT', 'admin/settings', body); toast('Settings saved'); $('#logo').textContent = body.store_name || 'Admin'; } catch (ex) { toast(ex.message, true); }
  };
}

/* ------------------------------------------------------------------ boot */
async function start() {
  await api('admin/me');
  $('#login').hidden = true; $('#shell').hidden = false;
  try { const s = await fetch('/api/settings').then((r) => r.json()); $('#logo').textContent = s.store_name || 'Admin'; } catch {}
  route();
}
start().catch(showLogin);
})();
