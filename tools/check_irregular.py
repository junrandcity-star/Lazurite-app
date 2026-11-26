import sys, re, pathlib, base64
from playwright.sync_api import sync_playwright
repo, out = sys.argv[1], sys.argv[2]
html = pathlib.Path(repo + '/test/cleaning.html').read_text(encoding='utf-8')
fake = pathlib.Path('/home/claude/tools/fake_supabase.js').read_text(encoding='utf-8')
css = pathlib.Path(repo + '/test/css/cleaning.css').read_text(encoding='utf-8')
js = pathlib.Path(repo + '/test/js/cleaning.js').read_text(encoding='utf-8')
html = re.sub(r'<script src="https://cdn[^>]*></script>\s*<script src="js/config[^>]*></script>', lambda m: '<script>' + fake + '</script>', html)
html = re.sub(r'<script src="js/cleaning[^>]*></script>', lambda m: '<script>' + js + '</script>', html)
html = re.sub(r'<link rel="stylesheet" href="css/cleaning[^>]*>', lambda m: '<style>' + css + '</style>', html)
pathlib.Path(out + '/t.html').write_text(html, encoding='utf-8')
png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
pathlib.Path(out + '/p.png').write_bytes(png)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 900, 'height': 1000})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'ERR_' not in m.text else None)
    pg.goto('file://' + out + '/t.html#seed-fail'); pg.wait_for_timeout(700)
    tabs = pg.locator('.og-tabs button, .omenu button')
    print('fail banner:', pg.locator('.ntc-body.fail .h').first.inner_text() if pg.locator('.ntc-body.fail').count() else 'NONE')
    pg.screenshot(path=out + '/1-owner.png', full_page=False)
    # settings: cleaning time
    pg.get_by_role('tab', name='設定').click(); pg.wait_for_timeout(200)
    names = [t for t in pg.locator('.omenu button, .og-tabs button').all_inner_texts()]
    print('menu:', names)
    for n in ['施設と担当', '施設']:
        if pg.get_by_role('button', name=n, exact=True).count(): pg.get_by_role('button', name=n, exact=True).first.click(); break
    pg.wait_for_timeout(300)
    sel = pg.locator('select[aria-label="Laughter 清掃にかかる時間"]')
    print('duration select:', sel.count())
    sel.select_option('180'); pg.wait_for_timeout(500)
    print('note:', pg.locator('tbody tr').first.locator('td').nth(2).inner_text().replace('\n', ' '))
    print('db duration:', pg.evaluate('__DB.property_cleaning[0].duration_min'))
    pg.screenshot(path=out + '/2-settings.png', full_page=False)
    # cleaner proxy
    pg.set_viewport_size({'width': 400, 'height': 900})
    pg.locator('#v-cleaner').click(); pg.wait_for_timeout(300)
    pg.locator('.ctabs button').nth(0).click(); pg.wait_for_timeout(200)
    print('today cards:', pg.locator('.job').count(), '| cantLater:', pg.locator('.job .linkbtn.del').count(), '| report btn:', pg.get_by_role('button', name=re.compile('รายงาน')).count())
    # time choices for today's job (Pear Field 2h default): edit
    pg.locator('.job .planned button').first.click(); pg.wait_for_timeout(200)
    print('time choices Pear Field:', pg.locator('.times button').all_inner_texts())
    pg.get_by_role('button', name='ยกเลิก').click()
    # report
    pg.get_by_role('button', name=re.compile('รายงาน')).click(); pg.wait_for_timeout(200)
    pg.locator('.sheet textarea').fill('浴室の電球が切れています')
    pg.locator('.sheet input[type=file]').set_input_files([out + '/p.png', out + '/p.png'])
    pg.wait_for_timeout(1200)
    print('thumbs:', pg.locator('.sheet .rep-photos img').count())
    pg.screenshot(path=out + '/3-report.png', full_page=False)
    pg.locator('.sheet .big-ok').click(); pg.wait_for_timeout(400)
    print('reports in db:', pg.evaluate('JSON.stringify(__DB.cleaning_reports.map(r => [r.body, r.photos.length, r.photos[0].split("/")[0]]))'))
    print('owner notice:', pg.evaluate('__DB.cleaning_messages.filter(m => m.kind === "report").map(m => m.body).join()'))
    # can't go after OK, same day
    pg.locator('.job .linkbtn.del').first.click(); pg.wait_for_timeout(200)
    print('urgent note:', pg.locator('.urgent-note').inner_text())
    pg.screenshot(path=out + '/4-cant.png', full_page=False)
    pg.get_by_role('button', name='ยกเลิก').click()
    # guide: how to
    pg.locator('.ctabs button').nth(2).click(); pg.wait_for_timeout(200)
    pg.get_by_role('button', name=re.compile('วิธีใช้')).click(); pg.wait_for_timeout(200)
    print('howto sections:', pg.locator('.howto h4').all_inner_texts())
    pg.screenshot(path=out + '/5-howto.png', full_page=True)
    # owner sees the report
    pg.set_viewport_size({'width': 900, 'height': 1000})
    pg.locator('#v-owner').click(); pg.wait_for_timeout(200)
    pg.get_by_role('tab', name=re.compile('^清掃')).click()
    pg.locator('.otabs button').nth(0).click(); pg.wait_for_timeout(300)
    lk = pg.get_by_role('button', name=re.compile('清掃員からの報告'))
    print('report link:', lk.count(), lk.first.inner_text() if lk.count() else '')
    if lk.count():
        lk.first.click(); pg.wait_for_timeout(400)
        print('owner sheet imgs:', pg.locator('.sheet .rep-photos img').count(), '|', pg.locator('.sheet .tx').first.inner_text())
        pg.screenshot(path=out + '/6-owner-report.png', full_page=False)
        pg.get_by_role('button', name='閉じる').click()
    # follow: unassigned cleanings
    pg.locator('.otabs button').nth(1).click(); pg.wait_for_timeout(200)
    print('follow head:', pg.locator('.ntc-head').first.inner_text().replace('\n', ' '))
    # pause the cleaner
    pg.get_by_role('tab', name='設定').click(); pg.get_by_role('button', name='清掃員', exact=True).click(); pg.wait_for_timeout(200)
    pg.get_by_role('button', name='休止', exact=True).click(); pg.wait_for_timeout(100)
    print('confirm text:', pg.locator('.linkbtn.del').first.inner_text())
    pg.locator('.linkbtn.del').first.click(); pg.wait_for_timeout(600)
    print('db active:', pg.evaluate('__DB.cleaners[0].active'), '| cancels:', pg.evaluate('__DB.cleaning_messages.filter(m => m.kind === "cancel").length'), '| future asg left:', pg.evaluate('__DB.cleaning_assignments.filter(a => a.job_date >= new Date(Date.now()+9*3600e3).toISOString().slice(0,10)).length'), '| done kept:', pg.evaluate('__DB.cleaning_assignments.filter(a => a.status === "done").length'))
    print('paused section:', pg.locator('.mgr-row').filter(has_text='休止中の清掃員').count())
    pg.screenshot(path=out + '/7-paused.png', full_page=True)
    # pay of last month still shows the paused cleaner
    pg.get_by_role('tab', name=re.compile('お金')).click(); pg.wait_for_timeout(200)
    btns = pg.locator('.omenu button, .og-tabs button').all_inner_texts()
    print('money menu:', btns)
    pg.get_by_role('button', name=re.compile('支払')).first.click(); pg.wait_for_timeout(200)
    sel = pg.locator('.card.panel select').first
    opts = sel.locator('option').all_text_contents(); print('months:', opts[:3])
    sel.select_option(index=0); pg.wait_for_timeout(300)
    print('pay rows:', [t.replace('\t', ' ') for t in pg.locator('tbody tr').all_inner_texts()][:3])
    # resume
    pg.get_by_role('tab', name='設定').click(); pg.get_by_role('button', name='清掃員', exact=True).click(); pg.wait_for_timeout(200)
    pg.get_by_role('button', name='再開する').click(); pg.wait_for_timeout(500)
    print('resumed active:', pg.evaluate('__DB.cleaners[0].active'))
    pg.get_by_role('button', name='自動送信').first.click() if pg.get_by_role('button', name='自動送信').count() else None
    print('errors:', errors)
