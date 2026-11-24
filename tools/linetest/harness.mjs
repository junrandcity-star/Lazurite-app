// Runs the LINE Edge Functions in Node with a fake database (PostgREST-like) and a fake LINE API.
import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const FN = new URL('../../supabase/functions/', import.meta.url).pathname;
const SB = 'https://sb.test';
const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'svc', SUPABASE_ANON_KEY: 'anon', LINE_CHANNEL_SECRET: 'sec', LINE_CHANNEL_ACCESS_TOKEN: 'tok' };
const handlers = [];
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => handlers.push(h) };

const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const plus = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const C1 = '11111111-1111-1111-1111-111111111111', C2 = '22222222-2222-2222-2222-222222222222';
export const DB = {
  reservations: [
    { id: 1, property_id: 1, check_out: plus(3), check_in: plus(1), status: 'confirmed', guests: 2 },
    { id: 2, property_id: 1, check_out: plus(6), check_in: plus(3), status: 'confirmed', guests: 4 },
    { id: 3, property_id: 2, check_out: today, check_in: plus(-2), status: 'confirmed', guests: 2 },
    { id: 4, property_id: 2, check_out: plus(2), check_in: today, status: 'confirmed', guests: 3 },
    { id: 5, property_id: 1, check_out: plus(9), check_in: plus(7), status: 'cancelled', guests: 2 },
  ],
  properties: [{ id: 1, name: 'Laughter' }, { id: 2, name: 'Pear Field' }],
  property_cleaning: [{ property_id: 1, out_time: '10:00', in_time: '16:00' }, { property_id: 2, out_time: '11:00', in_time: '15:00' }],
  cleaners: [
    { id: C1, name: 'Anan', lang: 'th', line_user_id: 'U_anan', line_code: null },
    { id: C2, name: '佐藤', lang: 'ja', line_user_id: null, line_code: '123456' },
  ],
  owner_line: [{ user_id: 'o1', line_user_id: 'U_owner1' }, { user_id: 'o2', line_user_id: 'U_owner2' }],
  cleaning_assignments: [
    { reservation_id: 1, cleaner_id: C1, job_date: plus(3), status: 'wait', plan_time: null, start_time: null },
    { reservation_id: 3, cleaner_id: C1, job_date: today, status: 'ok', plan_time: '11:00', start_time: null },
    { reservation_id: 2, cleaner_id: C2, job_date: plus(6), status: 'wait', plan_time: null, start_time: null },
  ],
  cleaning_messages: [],
  cleaning_dispatch: [{ id: 1, key: 'K', url: 'x' }],
};
export const LINE = [];
let msgId = 0;

function parse(qs) {
  const filters = [], opts = {};
  for (const [k, v] of new URLSearchParams(qs)) {
    if (k === 'select') continue;
    if (k === 'order') { const [f, dir] = v.split('.'); opts.order = [f, dir]; continue; }
    if (k === 'limit') { opts.limit = Number(v); continue; }
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    filters.push((r) => {
      const x = r[k] == null ? null : String(r[k]);
      if (op === 'eq') return x === val;
      if (op === 'neq') return x !== val;
      if (op === 'gte') return x != null && x >= val;
      if (op === 'not' && val === 'is.null') return x != null;
      throw new Error('op ' + op);
    });
  }
  return { filters, opts };
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  const ok = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.origin === 'https://api.line.me') { LINE.push({ path: u.pathname.split('/').pop(), body }); return ok({}); }
  if (u.origin !== SB) throw new Error('unexpected ' + url);
  if (u.pathname === '/rest/v1/rpc/cleaning_claim_messages') {
    const out = DB.cleaning_messages.filter((m) => !m.delivered_at).slice(0, body.lim);
    out.forEach((m) => { m.delivered_at = 'now'; m.send_status = 'sending'; });
    return ok(out.map((m) => ({ ...m })));
  }
  const table = u.pathname.replace('/rest/v1/', '');
  const { filters, opts } = parse(u.search.slice(1));
  let rows = DB[table].filter((r) => filters.every((f) => f(r)));
  if (method === 'GET') {
    if (opts.order) rows = rows.slice().sort((a, b) => (a[opts.order[0]] > b[opts.order[0]] ? 1 : -1) * (opts.order[1] === 'desc' ? -1 : 1));
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return ok(rows.map((r) => ({ ...r })));
  }
  if (method === 'PATCH') { rows.forEach((r) => Object.assign(r, body)); return ok(rows.map((r) => ({ ...r }))); }
  if (method === 'POST') {
    const row = { id: ++msgId, delivered_at: null, ...body }; DB[table].push(row);
    if (table === 'cleaning_messages') pendingDispatch = true; // the database trigger would call line-send
    return ok([row], 201);
  }
  throw new Error('method ' + method);
};
let pendingDispatch = false;

await import(pathToFileURL(FN + 'line-webhook/index.ts').href);
await import(pathToFileURL(FN + 'line-send/index.ts').href);
const [webhook, send] = handlers;

export async function dispatch() {
  pendingDispatch = false;
  const r = await send(new Request('https://x/line-send', { method: 'POST', headers: { 'x-dispatch-key': 'K' } }));
  return r.status + ' ' + (await r.text());
}
export async function hook(events, sig) {
  const raw = JSON.stringify({ events });
  const s = sig ?? createHmac('sha256', 'sec').update(raw).digest('base64');
  const r = await webhook(new Request('https://x/line-webhook', { method: 'POST', body: raw, headers: { 'x-line-signature': s } }));
  if (pendingDispatch) await dispatch();
  return r.status;
}
export const postback = (uid, data) => hook([{ type: 'postback', replyToken: 'rt', source: { type: 'user', userId: uid }, postback: { data } }]);
export const lastLine = () => LINE[LINE.length - 1];
export const textOf = (m) => m.type === 'text' ? m.text : m.type === 'flex' ? JSON.stringify(m.contents).match(/"text":"([^"]*)"/g).map((x) => x.slice(8, -1)).join(' | ') : JSON.stringify(m);
export { C1, C2, today, plus, send };
