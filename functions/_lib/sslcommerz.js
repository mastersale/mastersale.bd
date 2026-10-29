// SSLCommerz (Bangladesh payment gateway) helpers.
// Docs: https://developer.sslcommerz.com/doc/v4/
// Env vars: SSLC_STORE_ID, SSLC_STORE_PASSWD, SSLC_LIVE ("true" for real payments; anything else = sandbox)

const hosts = (env) =>
  env.SSLC_LIVE === 'true'
    ? { init: 'https://securepay.sslcommerz.com/gwprocess/v4/api.php', validate: 'https://securepay.sslcommerz.com/validator/api/validationserverAPI.php' }
    : { init: 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php', validate: 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php' };

export const sslcConfigured = (env) => !!(env.SSLC_STORE_ID && env.SSLC_STORE_PASSWD);

export async function initPayment(env, { order, items, origin }) {
  const h = hosts(env);
  const body = new URLSearchParams({
    store_id: env.SSLC_STORE_ID,
    store_passwd: env.SSLC_STORE_PASSWD,
    total_amount: String(order.total),
    currency: 'BDT',
    tran_id: order.tran_id,
    success_url: `${origin}/api/pay/success`,
    fail_url: `${origin}/api/pay/fail`,
    cancel_url: `${origin}/api/pay/cancel`,
    ipn_url: `${origin}/api/pay/ipn`,
    cus_name: order.name,
    cus_email: order.email || 'customer@example.com',
    cus_add1: order.address,
    cus_city: order.city || 'Dhaka',
    cus_postcode: '1000',
    cus_country: 'Bangladesh',
    cus_phone: order.phone,
    shipping_method: 'NO',
    num_of_item: String(items.reduce((n, i) => n + i.qty, 0)),
    product_name: items.map((i) => i.name).join(', ').slice(0, 250),
    product_category: 'general',
    product_profile: 'general',
    value_a: order.order_no,
  });
  const res = await fetch(h.init, { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (data.status !== 'SUCCESS' || !data.GatewayPageURL) {
    throw new Error(data.failedreason || 'Payment gateway did not return a payment page.');
  }
  return data.GatewayPageURL;
}

// Ask SSLCommerz directly whether a val_id is a real, paid transaction.
// Never trust the browser redirect alone.
export async function validatePayment(env, valId) {
  const h = hosts(env);
  const url = `${h.validate}?val_id=${encodeURIComponent(valId)}&store_id=${encodeURIComponent(env.SSLC_STORE_ID)}&store_passwd=${encodeURIComponent(env.SSLC_STORE_PASSWD)}&v=1&format=json`;
  const res = await fetch(url);
  return res.json();
}
