"""Run staff.html in a headless browser with a fake LIFF and a fake staff-api (the real server logic is tested separately)."""
import re, pathlib, json
from playwright.sync_api import sync_playwright
repo = '/home/claude/lazurite-app'; out = '/home/claude/shots'
html = pathlib.Path(repo + '/test/staff.html').read_text(encoding='utf-8')
css = pathlib.Path(repo + '/test/css/cleaning.css').read_text(encoding='utf-8')
js = pathlib.Path(repo + '/test/js/cleaning.js').read_text(encoding='utf-8')
FAKE = r"""
<script>
(function () {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const plus = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const lastMonth = (() => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(0); return d.toISOString().slice(0, 10); })();
  const ME = 'c1';
  window.__calls = [];
  window.__state = {
    me: { id: ME, name: 'Anan', lang: location.hash.includes('ja') ? 'ja' : 'th' },
    cleaners: [{ id: ME, name: 'Anan', lang: 'th' }, { id: 'c2', name: '佐藤', lang: 'ja' }],
    props: [{ id: 1, name: 'Laughter', out: '10:00', in: '16:00', rate: 6000, main: null, members: [ME] }, { id: 2, name: 'Pear Field', out: '11:00', in: '15:00', rate: 5000, main: null, members: [ME] }],
    jobs: [
      { id: 3, prop: 'Pear Field', date: today, nextIn: today, guests: 2, asg: [{ c: ME, st: 'ok', plan: '11:00', sent: plus(-3) }] },
      { id: 1, prop: 'Laughter', date: plus(3), nextIn: plus(3), guests: 4, asg: [{ c: ME, st: 'wait', sent: today }, { c: 'c2', st: 'other' }] },
      { id: 9, prop: 'Laughter', date: lastMonth, nextIn: null, guests: null, asg: [{ c: ME, st: 'done', plan: '10:00', start: '10:00', end: '13:00', fee: 8000, feeNote: '緊急対応' }] },
    ],
    guide: { 'Laughter': [{ id: 'g1', key: 'g1', name: { ja: 'ベッド', th: 'เตียง' }, notes: [{ ja: 'シーツ', th: 'ผ้าปู', warn: true }], photo: null }], 'Pear Field': [] },
    expenses: [], confirms: {}, today,
  };
  window.liff = { init: async () => {}, isLoggedIn: () => true, login: () => { window.__login = true; }, getIDToken: () => 'idtok' };
  const realFetch = window.fetch;
  window.fetch = async (url, init) => {
    if (String(url).includes('/functions/v1/staff-api')) {
      const b = JSON.parse(init.body); window.__calls.push(b);
      if (location.hash.includes('nolink')) return new Response(JSON.stringify({ error: 'not_linked' }), { status: 403 });
      const S = window.__state, a = (r) => S.jobs.find(j => j.id === r).asg[0];
      if (b.action === 'load') return new Response(JSON.stringify({ ok: true, data: JSON.parse(JSON.stringify(S)) }));
      if (b.action === 'ok') { a(b.r).st = 'ok'; a(b.r).plan = b.t; }
      if (b.action === 'start') { a(b.r).st = 'work'; a(b.r).start = '11:02'; }
      if (b.action === 'done') { a(b.r).st = 'done'; a(b.r).end = '13:30'; }
      if (b.action === 'confirm') S.confirms[ME + '|' + b.month] = '12/1 09:00';
      if (b.action === 'upload_url') return new Response(JSON.stringify({ ok: true, path: 'receipts/c1/x.jpg', url: 'https://up.test/put' }));
      if (b.action === 'expense') S.expenses.push({ id: 'e1', c: ME, date: b.date, amount: b.amount, item: b.item, prop: 'Laughter', status: 'pending', photo: '', photoPath: b.photo_path });
      return new Response(JSON.stringify({ ok: true }));
    }
    if (String(url).startsWith('https://up.test/')) { window.__put = init.method; return new Response('{}'); }
    return realFetch(url, init);
  };
  window.supabase = { createClient: () => ({}) };
  window.LZ_CONFIG = { supabaseUrl: 'https://sb.test', supabaseKey: 'x' };
})();
</script>"""
html = re.sub(r'<script src="https://static\.line-scdn[^>]*></script>\s*<script src="https://cdn[^>]*></script>\s*<script src="js/config[^>]*></script>', lambda m: FAKE, html)
html = re.sub(r'<script src="js/cleaning[^>]*></script>', lambda m: '<script>' + js + '</script>', html)
html = re.sub(r'<link rel="stylesheet" href="css/cleaning[^>]*>', lambda m: '<style>' + css + '</style>', html)
pathlib.Path(out + '/staff.html').write_text(html, encoding='utf-8')
pathlib.Path(out + '/receipt.png').write_bytes(__import__('base64').b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='))
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 390, 'height': 844})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.goto('file://' + out + '/staff.html#nolink'); pg.wait_for_timeout(400)
    print('not linked:', pg.locator('#gate').is_visible(), pg.locator('#gate-msg').inner_text()[:60].replace('\n', ' '))
    pg.goto('file://' + out + '/staff.html'); pg.reload(); pg.wait_for_timeout(500)
    print('start tab:', pg.locator('.ctabs button[aria-pressed=true]').inner_text().replace('\n', ' '), '| owner bits visible:', pg.locator('#v-owner').is_visible())
    pg.screenshot(path=out + '/s-today.png', full_page=True)
    pg.locator('.big-start').first.click(); pg.wait_for_timeout(500)
    print('after start:', pg.locator('#save').inner_text(), '| calls:', [c['action'] for c in pg.evaluate('__calls')])
    pg.locator('.job.st-work .big-ok').first.click(); pg.wait_for_timeout(500)
    print('after done:', pg.locator('.job').first.inner_text().replace('\n', ' ')[:120])
    # reply OK with a time
    pg.locator('.ctabs button').nth(1).click(); pg.wait_for_timeout(200)
    pg.locator('.job.st-wait .big-ok').first.click(); pg.locator('.times button').nth(1).click(); pg.locator('.sheet .big-ok').click(); pg.wait_for_timeout(500)
    print('ok call:', pg.evaluate('__calls').pop())
    # guide
    pg.locator('.ctabs button').nth(2).click(); pg.wait_for_timeout(200)
    print('guide:', pg.locator('.phone').inner_text()[:120].replace('\n', ' '))
    # pay: last month, confirm, expense with photo
    pg.locator('.ctabs button').nth(3).click(); pg.wait_for_timeout(200)
    if pg.locator('.banner button').count(): pg.locator('.banner button').first.click()
    print('pay:', pg.locator('.pay-total').inner_text().replace('\n', ' '), '| adjusted shown:', 'ปรับยอด' in pg.locator('.phone').inner_text())
    pg.locator('.confirm-box button').click(); pg.wait_for_timeout(500)
    print('confirm call:', pg.evaluate('__calls').pop(), '|', pg.locator('.confirm-box').inner_text()[:40])
    pg.locator('.month-pick select').select_option(index=0); pg.wait_for_timeout(200)
    pg.locator('.add-exp, button:has-text("บันทึกการซื้อของ")').first.click()
    pg.locator('.sheet input[type=file]').set_input_files(out + '/receipt.png'); pg.wait_for_timeout(800)
    pg.locator('.sheet input[type=number]').fill('1500'); pg.locator('.sheet input[type=text]').fill('タオル')
    pg.locator('.sheet .big-ok').click(); pg.wait_for_timeout(600)
    print('expense call:', [c for c in pg.evaluate('__calls') if c['action'] in ('upload_url', 'expense')], '| PUT:', pg.evaluate('window.__put'))
    pg.screenshot(path=out + '/s-pay.png', full_page=True)
    # menu link ?tab=guide
    pg.goto('file://' + out + '/staff.html?tab=guide#ja'); pg.wait_for_timeout(500)
    print('tab=guide opens:', pg.locator('.ctabs button[aria-pressed=true]').inner_text().replace('\n', ' '), '| lang ja title:', pg.locator('h1').first.inner_text())
    b.close()
print('errors:', errors)
