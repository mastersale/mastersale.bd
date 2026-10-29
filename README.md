# Shop: storefront + admin panel + API (Cloudflare)

A fast, mobile-first online store. You manage everything from `/admin`: product photos and videos, price, discount, stock, specifications, categories, orders and store settings. Changes show on the website straight away.

```
public/            the website (storefront at /, admin panel at /admin)
functions/api/     the API (also used by your future Android and iOS apps)
functions/media/   serves uploaded photos and videos
migrations/        database tables
```

It runs entirely on Cloudflare: **Pages** (site), **D1** (database), **R2** (photos and videos). All three have free tiers that are enough to launch.

> GitHub Pages cannot run an admin panel or database. GitHub only stores the code. Cloudflare Pages serves the site from your GitHub repo.

## Set up (about 20 minutes)

### 1. Put the code on GitHub
Replace the contents of your existing repository with this folder (or create a new repository). Keep the folder structure exactly as is.

### 2. Create the database
Cloudflare dashboard → **Storage & databases → D1 → Create database**, name it `shop-db`.
Open it → **Console** tab → paste the whole contents of `migrations/0001_init.sql` → **Execute**.
Copy the **Database ID** shown on the database page.

### 3. Create the media bucket
**Storage & databases → R2 → Create bucket**, name it `shop-media` (keep it private; the site serves files through `/media`).

### 4. Connect both in `wrangler.toml`
Open `wrangler.toml`, replace `00000000-0000-0000-0000-000000000000` with your Database ID, save and commit to GitHub.

### 5. Create the Pages project
**Workers & Pages → Create → Pages → Connect to Git** → choose your repository.
- Build command: leave empty
- Build output directory: `public`

After the first deploy, open **Settings → Variables and Secrets** and add these as **Secrets**:

| Name | Value |
|---|---|
| `ADMIN_PASSWORD` | the password only you will use to sign in |
| `SESSION_SECRET` | any random text of 40+ characters |

Redeploy once (Deployments → latest → Retry) so the secrets take effect.

### 6. Online payments (SSLCommerz)
Cash on delivery works without this. For online payment (bKash, Nagad, Rocket, cards):
1. Open a merchant account at sslcommerz.com. Their sandbox gives you a test Store ID and password immediately.
2. Add two more Secrets: `SSLC_STORE_ID` and `SSLC_STORE_PASSWD`. Redeploy.
3. Place a test order with Pay online. It uses SSLCommerz's test mode while `SSLC_LIVE = "false"` in `wrangler.toml`.
4. In your SSLCommerz merchant panel, set the IPN URL to `https://YOUR-DOMAIN/api/pay/ipn`.
5. When SSLCommerz approves your live account, put the live Store ID and password in the Secrets, change `SSLC_LIVE` to `"true"` in `wrangler.toml`, and commit.

Every payment is verified server-to-server with SSLCommerz, and the amount is checked against the order, so a customer cannot fake a paid order. Online payment is hidden at checkout until the keys are added.

### 7. Your domain
In the Pages project → **Custom domains → Set up a custom domain**. Since your domain is already on Cloudflare, this takes one click. Remove the old GitHub Pages hosting for that domain if it is still attached.

### 8. Sign in
Go to `https://YOUR-DOMAIN/admin`, sign in, then:
1. **Store settings**: name, banner, delivery charge, contact details.
2. **Categories**: add a few.
3. **Products → Add product**: upload photos or videos, set price, discount, stock and specifications.

## Daily use
- **Add or edit a product:** Products → Add product (or click an existing one). Drag in photos and videos, reorder them (the first photo is the cover), set price and discount, add specifications, Save.
- **Discount:** choose Percent off or Taka off. The preview shows exactly what customers will pay.
- **Orders:** Orders → open one → change status (confirmed, shipped, delivered) and payment status. Cancelling returns the items to stock.
- **Hide a product** without deleting it: untick "Show this product in the store".

## Limits to know
- Photos up to 10 MB (large photos are shrunk automatically in your browser). Videos up to 90 MB: compress long videos first.
- Free Cloudflare plan: 100,000 requests a day for the site's API, 5 GB of D1 storage, 10 GB of R2 storage.
- Sign-in locks for 15 minutes after 8 wrong passwords from the same address.

## For the Android and iOS apps
The apps use the same API, so the admin panel controls them too. Prices and stock are always checked on the server.

Public (no sign-in):
- `GET /api/settings`, `GET /api/categories`
- `GET /api/products?category=&q=&sort=new|price_asc|price_desc|discount&on_sale=1&limit=&offset=`
- `GET /api/products/{slug}`
- `POST /api/orders` with `{customer:{name,phone,address,city,email,note}, items:[{id,qty}], payment_method:"cod"|"online"}`. For online, open the returned `payment_url` in a web view.
- `GET /api/orders/{order_no}?k={token}` or `?phone={phone}`

Admin (header `Authorization: Bearer <token>` from `POST /api/admin/login` with `{password}`): everything under `/api/admin/...`.

Media URLs are paths like `/media/202610/abc.webp`; prefix them with your domain.

## Local testing (optional)
```
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 create shop-db        # paste the id into wrangler.toml
npx wrangler r2 bucket create shop-media
npm run db:init:local
npm run db:seed:local                 # optional demo products
npm run dev                           # http://localhost:8788
```

## Security notes
- Admin pages and APIs require your password. The sign-in cookie is HttpOnly, Secure and SameSite=Strict.
- Secrets live only in Cloudflare, never in the code. Do not commit `.dev.vars`.
- Customer phone numbers and addresses are stored in D1. Only you can read them, through the admin panel.
