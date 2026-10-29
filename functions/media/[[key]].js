// Serves product photos and videos from the R2 bucket, with Range support (needed for video seeking on iPhone).

export async function onRequest({ request, env, params }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const key = (params.key || []).join('/');
  if (!key || key.includes('..')) return new Response('Not found', { status: 404 });

  const obj = await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers });
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Access-Control-Allow-Origin', '*');
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  if (!('body' in obj)) return new Response(null, { status: 304, headers }); // conditional request matched

  let status = 200;
  if (obj.range) {
    const r = obj.range;
    const offset = r.offset ?? obj.size - r.suffix;
    const length = r.length ?? obj.size - offset;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('Content-Length', String(length));
    status = 206;
  } else {
    headers.set('Content-Length', String(obj.size));
  }
  return new Response(request.method === 'HEAD' ? null : obj.body, { status, headers });
}
