// MASTERSALE™ pre-launch password gate for Cloudflare Pages.
// Runs on Cloudflare's servers BEFORE any page is sent, so visitors without the password get nothing but the launch screen.
// The password is NOT in this file: set it in Cloudflare as a secret named SITE_PASSWORD.

const PUBLIC = new Set(["/assets/logo-white.png", "/assets/mark-white.png", "/assets/favicon-32.png", "/assets/apple-touch-icon.png"]);
const DAYS = 30, enc = new TextEncoder();

async function sign(msg, secret) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return [...new Uint8Array(s)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const same = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
async function hasAccess(req, pw) {
  const m = (req.headers.get("Cookie") || "").match(/(?:^|;\s*)ms_gate=(\d+)\.([a-f0-9]+)/);
  return !!m && Number(m[1]) > Date.now() && same(m[2], await sign(m[1], pw));   // changing the password logs everyone out
}

const page = (msg, form = true) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#0a0a0a">
<title>MASTERSALE™ | Grand Launch Soon</title><link rel="icon" href="/assets/favicon-32.png">
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;800;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#0a0a0a;color:#fff;font-family:Nunito,system-ui,sans-serif;text-align:center;overflow:hidden}
.mark{position:fixed;right:-60px;bottom:-60px;width:min(70vw,440px);opacity:.07;pointer-events:none}
main{position:relative;width:100%;max-width:380px}
.logo{width:min(100%,300px);height:auto;margin:0 auto 22px;display:block}
.tag{font-size:12px;letter-spacing:.3em;font-weight:900;color:#d4d4d4;margin:0 0 14px}
.slogan{font-size:20px;font-weight:800;margin:0 0 8px}.sub{font-size:14px;color:#9ca3af;margin:0 0 22px;line-height:1.5}
input{width:100%;padding:15px;border-radius:14px;border:1px solid #262626;background:#121212;color:#fff;font:inherit;font-size:16px;text-align:center;outline:none}
input:focus{border-color:#fff}button{width:100%;margin-top:12px;padding:15px;border:0;border-radius:14px;background:#fff;color:#000;font:inherit;font-weight:900;font-size:16px;cursor:pointer}
button:active{transform:scale(.98)}.err{color:#f87171;font-size:13px;min-height:18px;margin:10px 0 0}.mail{margin-top:26px;font-size:12px;color:#525252}
</style></head><body><img class="mark" src="/assets/mark-white.png" alt="">
<main><img class="logo" src="/assets/logo-white.png" alt="MASTERSALE™" width="300" height="69">
<p class="tag">GRAND LAUNCH SOON</p><p class="slogan">Shop Smart, Save More</p>
<p class="sub">Something premium is coming to Bangladesh.${form ? " Have an early-access password?" : ""}</p>
${form ? `<form method="POST" action="/__gate"><input type="password" name="password" placeholder="Enter access password" autocomplete="off" required autofocus><p class="err">${msg}</p><button>Enter Store</button></form>` : ""}
<p class="mail">info@mastersale.bd</p></main></body></html>`,
  { status: 401, headers: { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url), pw = env.SITE_PASSWORD;
    if (PUBLIC.has(url.pathname)) return env.ASSETS.fetch(req);          // logos for the launch screen only
    if (!pw) return page("", false);                                      // no password set = stay closed (never open by accident)

    if (url.pathname === "/__gate" && req.method === "POST") {
      const given = String((await req.formData()).get("password") || "");
      if (same(await sign("x", given), await sign("x", pw))) {
        const exp = Date.now() + DAYS * 864e5;
        return new Response(null, { status: 303, headers: { Location: "/", "Cache-Control": "no-store",
          "Set-Cookie": `ms_gate=${exp}.${await sign(String(exp), pw)}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax` } });
      }
      await new Promise(r => setTimeout(r, 1000));                        // slows down guessing
      return page("Wrong password. Please try again.");
    }
    if (!(await hasAccess(req, pw))) return page("");

    const r = await env.ASSETS.fetch(req), h = new Headers(r.headers);
    h.set("X-Robots-Tag", "noindex, nofollow");
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
  }
};
