/* Lazurite 清掃スケジュール(試験環境・第1段階)
 * - 予約データ(reservations)のチェックアウトから清掃の予定を作る
 * - 清掃員・担当・依頼・ガイド・立替は Supabase に保存する
 * - この段階ではオーナーだけがログインする。清掃員の画面はオーナーが代わりに操作して確認する
 * - メール・LINE の送信はまだ行わない(cleaning_messages に記録だけ残す)
 * 画面に出す文字は textContent で入れる(HTMLとして解釈させない)。
 * 元になった試作品: proto/cleaning-proto.html
 */
(function () {
  'use strict';
  const cfg = window.LZ_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });
  const plusDays = (s0, n) => { const d = new Date(s0 + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // Japan time
  const WEEK_END = plusDays(TODAY, 7);
  const monthsBack = (m, n) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) - n; while (mo < 1) { mo += 12; y--; } return y + '-' + String(mo).padStart(2, '0'); };
  const THIS_MONTH = TODAY.slice(0, 7);
  const PAY_MONTHS = [0, 1, 2, 3, 4, 5, 6].map(n => monthsBack(THIS_MONTH, n)); // this month and the 6 before it
  const FROM = PAY_MONTHS[PAY_MONTHS.length - 1] + '-01';
  const LANG_JA = { ja: '日本語', en: '英語', th: 'タイ語', ne: 'ネパール語', vi: 'ベトナム語' };

  // ---------- app menu at the top right (same as the board) ----------
  (function appsMenu() {
    const btn = document.getElementById('apps-btn'), panel = document.getElementById('apps-panel');
    if (!btn || !panel) return;
    const place = () => {
      const r = btn.getBoundingClientRect(), w = Math.min(460, innerWidth - 32);
      panel.style.top = Math.round(r.bottom + 8) + 'px';
      panel.style.left = Math.round(Math.max(16, Math.min(r.right - w, innerWidth - 16 - w))) + 'px';
    };
    const set = (open) => { if (open) place(); panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.setAttribute('aria-label', open ? 'アプリ一覧を閉じる' : 'アプリ一覧を開く'); };
    window.addEventListener('resize', () => { if (!panel.hidden) place(); });
    btn.onclick = (e) => { e.stopPropagation(); set(panel.hidden); };
    panel.addEventListener('click', (e) => { e.stopPropagation(); if (e.target.closest('a.app-tile')) set(false); });
    document.addEventListener('click', () => set(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { set(false); btn.focus(); } });
  })();

  // ---------- load everything from the database ----------
  const q = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
  async function fetchAll(table, build) {
    let out = [];
    for (let from = 0; ; from += 1000) {
      const data = await q(build(sb.from(table)).range(from, from + 999));
      out = out.concat(data);
      if (data.length < 1000) return out;
    }
  }
  const fmtAt = (iso) => { const d = new Date(iso); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  let loadedAt = 0;
  async function loadState() {
    const sync = await sb.rpc('cleaning_sync'); // automatic requests / reminders / cancellations
    if (sync.error) console.error(sync.error);
    const [props, pc, pm, cleaners, res, asg, areas, exps, confs, log, msgs, set] = await Promise.all([
      q(sb.from('properties').select('id,name').order('name')),
      q(sb.from('property_cleaning').select('*')),
      q(sb.from('property_cleaners').select('*')),
      q(sb.from('cleaners').select('*').eq('active', true).order('created_at')),
      fetchAll('reservations', (t0) => t0.select('id,property_id,check_in,check_out,guests').eq('status', 'confirmed').gte('check_out', FROM).order('check_out').order('id')),
      fetchAll('cleaning_assignments', (t0) => t0.select('*').gte('job_date', FROM).order('reservation_id').order('cleaner_id')),
      q(sb.from('guide_areas').select('*').order('sort')),
      q(sb.from('cleaning_expenses').select('*').gte('purchased_on', FROM).order('created_at')),
      q(sb.from('pay_confirms').select('*')),
      q(sb.from('cleaning_log').select('*').order('id', { ascending: false }).limit(300)),
      q(sb.from('cleaning_messages').select('*').eq('audience', 'owner').order('id', { ascending: false }).limit(30)),
      q(sb.from('cleaning_settings').select('*').eq('id', 1).maybeSingle()),
    ]);
    const paths = areas.map(a => a.photo_path).concat(exps.map(e => e.photo_path)).filter(Boolean);
    const urls = {};
    if (paths.length) {
      const signed = await sb.storage.from('cleaning').createSignedUrls(paths, 6 * 3600);
      (signed.data || []).forEach(x => { if (x.signedUrl) urls[x.path] = x.signedUrl; });
    }
    const pcBy = Object.fromEntries(pc.map(x => [x.property_id, x]));
    const nameOf = Object.fromEntries(props.map(p => [p.id, p.name]));
    const cIds = new Set(cleaners.map(c => c.id));
    const st = {};
    st.cleaners = cleaners.map(c => ({ id: c.id, name: c.name, lang: c.lang, contact: c.contact }));
    st.props = props.map(p => { const x = pcBy[p.id] || {}; return {
      id: p.id, name: p.name, out: x.out_time || '10:00', in: x.in_time || '16:00', rate: x.rate || 0,
      main: cIds.has(x.main_cleaner_id) ? x.main_cleaner_id : null,
      members: pm.filter(m => m.property_id === p.id && cIds.has(m.cleaner_id)).map(m => m.cleaner_id) }; });
    const asgBy = {};
    asg.forEach(a => { if (cIds.has(a.cleaner_id)) (asgBy[a.reservation_id] = asgBy[a.reservation_id] || []).push({
      c: a.cleaner_id, st: a.status, plan: a.plan_time, start: a.start_time, end: a.end_time, sent: a.sent_on, auto: a.auto, remind: a.remind_count, reminded: a.reminded_on }); });
    const byProp = {};
    res.forEach(r => { (byProp[r.property_id] = byProp[r.property_id] || []).push(r); });
    st.jobs = res.filter(r => r.check_out && nameOf[r.property_id]).map(r => {
      // next guest of the same property: earliest check-in on or after this check-out
      let next = null;
      byProp[r.property_id].forEach(o => { if (o.id !== r.id && o.check_in >= r.check_out && (!next || o.check_in < next.check_in)) next = o; });
      return { id: r.id, prop: nameOf[r.property_id], date: r.check_out, nextIn: next ? next.check_in : null, guests: next ? next.guests : null, asg: asgBy[r.id] || [] };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.prop.localeCompare(b.prop));
    st.guide = {};
    props.forEach(p => { st.guide[p.name] = []; });
    areas.forEach(a => { if (nameOf[a.property_id]) st.guide[nameOf[a.property_id]].push({ id: a.id, key: a.id, name: a.name, notes: a.notes, photoPath: a.photo_path, photo: urls[a.photo_path] || null }); });
    st.expenses = exps.filter(e => cIds.has(e.cleaner_id)).map(e => ({ id: e.id, c: e.cleaner_id, date: e.purchased_on, amount: e.amount, store: e.store, item: e.item, prop: nameOf[e.property_id] || '', status: e.status, reason: e.reason || '', invoiceNo: e.invoice_no || '', taxRate: e.tax_rate, approvedAt: e.approved_at, photoPath: e.photo_path, photo: urls[e.photo_path] || '' }));
    st.confirms = {};
    confs.forEach(c => { st.confirms[c.cleaner_id + '|' + c.month] = c.confirmed_at; });
    st.log = log.slice().reverse().map(l => ({ cid: l.cleaner_id, at: l.at, who: l.who, text: l.body }));
    st.notices = msgs.map(m => ({ at: fmtAt(m.created_at), text: m.body, kind: m.kind }));
    st.rule = { replyDays: set ? set.reply_days : 2, horizon: set ? set.horizon_days : 30 };
    loadedAt = Date.now();
    return st;
  }

  // ---------- save: compare with the last saved copy and write only what changed ----------
  const KEYS = { cleaners: ['id'], property_cleaning: ['property_id'], property_cleaners: ['property_id', 'cleaner_id'], cleaning_assignments: ['reservation_id', 'cleaner_id'], guide_areas: ['id'], cleaning_expenses: ['id'], pay_confirms: ['cleaner_id', 'month'], cleaning_settings: ['id'] };
  const ORDER = Object.keys(KEYS);
  function rowsOf() {
    const pid = (name) => { const p = S.props.find(x => x.name === name); return p ? p.id : null; };
    const out = {};
    out.cleaners = S.cleaners.map(c => ({ id: c.id, name: c.name, lang: c.lang, contact: c.contact, active: true }));
    out.property_cleaning = S.props.map(p => ({ property_id: p.id, out_time: p.out, in_time: p.in, rate: p.rate, main_cleaner_id: p.main || null }));
    out.property_cleaners = [];
    S.props.forEach(p => p.members.forEach(m => out.property_cleaners.push({ property_id: p.id, cleaner_id: m })));
    out.cleaning_assignments = [];
    S.jobs.forEach(j => j.asg.forEach(a => out.cleaning_assignments.push({ reservation_id: j.id, cleaner_id: a.c, job_date: j.date, status: a.st, plan_time: a.plan || null, start_time: a.start || null, end_time: a.end || null, sent_on: a.sent || null, auto: !!a.auto, remind_count: a.remind || 0, reminded_on: a.reminded || null })));
    out.guide_areas = [];
    Object.keys(S.guide).forEach(name => S.guide[name].forEach((ar, i) => out.guide_areas.push({ id: ar.id, property_id: pid(name), sort: i, name: ar.name, notes: ar.notes, photo_path: ar.photoPath || null })));
    out.cleaning_expenses = S.expenses.map(e => ({ id: e.id, cleaner_id: e.c, property_id: pid(e.prop), purchased_on: e.date, amount: e.amount, store: e.store || '', item: e.item || '', status: e.status, reason: e.reason || null, invoice_no: e.invoiceNo || null, tax_rate: e.taxRate || '10', approved_at: e.approvedAt || null, photo_path: e.photoPath || null }));
    out.pay_confirms = Object.keys(S.confirms).map(k => ({ cleaner_id: k.split('|')[0], month: k.split('|')[1], confirmed_at: S.confirms[k] }));
    out.cleaning_settings = [{ id: 1, reply_days: S.rule.replyDays, horizon_days: S.rule.horizon }];
    return out;
  }
  const keyOf = (t0, r) => KEYS[t0].map(k => r[k]).join('|');
  let snap = null, saving = Promise.resolve();
  function takeSnap() { const now = rowsOf(); snap = {}; ORDER.forEach(t0 => { snap[t0] = new Map(now[t0].map(r => [keyOf(t0, r), JSON.stringify(r)])); }); }
  function setSave(state) {
    const s0 = document.getElementById('save'); if (!s0) return;
    s0.className = state === 'error' ? 'err' : '';
    s0.textContent = state === 'saving' ? '保存中…' : state === 'saved' ? '✓ 保存しました' : state === 'error' ? '保存できませんでした。ページを読み込み直してください。' : '';
  }
  function persist() {
    if (!S || !snap) return;
    const now = rowsOf(), ups = {}, dels = {}; let any = false;
    ORDER.forEach(t0 => {
      ups[t0] = []; dels[t0] = [];
      const seen = new Set();
      now[t0].forEach(r => { const k = keyOf(t0, r), js0 = JSON.stringify(r); seen.add(k); if (snap[t0].get(k) !== js0) { ups[t0].push(r); snap[t0].set(k, js0); } });
      [...snap[t0].keys()].forEach(k => { if (!seen.has(k)) { dels[t0].push(k); snap[t0].delete(k); } });
      if (ups[t0].length || dels[t0].length) any = true;
    });
    if (!any) return;
    setSave('saving');
    saving = saving.then(async () => {
      for (const t0 of ORDER) if (ups[t0].length) { const { error } = await sb.from(t0).upsert(ups[t0], { onConflict: KEYS[t0].join(',') }); if (error) throw error; }
      for (const t0 of ORDER.slice().reverse()) for (const k of dels[t0]) {
        const vals = k.split('|'); let d0 = sb.from(t0).delete();
        KEYS[t0].forEach((kk, i) => { d0 = d0.eq(kk, vals[i]); });
        const { error } = await d0; if (error) throw error;
      }
      setSave('saved');
      // settings that change who gets the automatic request: run the automatic sending again
      if (ups.property_cleaning.length || ups.cleaning_settings.length || ups.property_cleaners.length || dels.property_cleaners.length || dels.cleaners.length) await reload();
    }).catch(e => { console.error(e); setSave('error'); });
  }
  async function reload() {
    if (UI.sheet) return;
    S = await loadState(); takeSnap(); render();
  }
  // ---------- guide translation (Japanese -> the 4 other languages, via the "translate" Edge Function) ----------
  const TR_LANGS = ['en', 'th', 'ne', 'vi'];
  const needsTr = (o) => o && (o.ja || '').trim() && TR_LANGS.some(k => !o[k]);
  function trPending() {
    const out = [];
    Object.keys(S.guide).forEach(name => S.guide[name].forEach(ar => { if (needsTr(ar.name)) out.push(ar.name); ar.notes.forEach(n => { if (needsTr(n)) out.push(n); }); }));
    return out;
  }
  let trTimer = null;
  function queueTranslate() { clearTimeout(trTimer); trTimer = setTimeout(runTranslate, 700); }
  async function runTranslate() {
    if (UI.tr === 'busy') { queueTranslate(); return; }
    const items = trPending().slice(0, 100);
    if (!items.length) return;
    UI.tr = 'busy'; render();
    try {
      const { data, error } = await sb.functions.invoke('translate', { body: { texts: items.map(o => o.ja.trim()) } });
      if (error) {
        const st = error.context && error.context.status;
        UI.tr = st === 503 ? 'nokey' : 'error';
        if (st !== 503) console.error(error);
      } else {
        items.forEach((o, i) => TR_LANGS.forEach(k => { const v = data.translations[k] && data.translations[k][i]; if (v) o[k] = v; }));
        UI.tr = trPending().length ? 'idle' : 'done';
        if (UI.tr === 'idle') queueTranslate(); // more than 100 at once
      }
    } catch (e) { console.error(e); UI.tr = 'error'; }
    render();
  }

  // photos: shrink in the browser, then keep in the private "cleaning" storage
  async function uploadPhoto(file, folder) {
    try {
      setSave('saving');
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.82));
      const path = folder + '/' + crypto.randomUUID() + '.jpg';
      const { error } = await sb.storage.from('cleaning').upload(path, blob, { contentType: 'image/jpeg' });
      if (error) throw error;
      setSave('saved');
      return { path, url: URL.createObjectURL(blob) };
    } catch (e) { console.error(e); setSave('error'); return null; }
  }

  const UI = { view: 'owner', who: null, lang: 'ja', ctab: 'jobs', gprop: null, otab: 'jobs', tr: 'idle', flowOpen: false, editMembers: null, payM: THIS_MONTH, payMO: THIS_MONTH, ogprop: null, delC: null, sheet: null, flash: null, followOpen: false, noticeOpen: false, modeO: 'cal', modeC: 'cal', calO: TODAY.slice(0, 7), calC: TODAY.slice(0, 7), selO: TODAY, selC: TODAY, stmt: null, expFilter: 'pending' };

  // ---------- i18n (cleaner screen) ----------
  const LANGS = [['ja','日本語'],['en','English'],['th','ไทย'],['ne','नेपाली'],['vi','Tiếng Việt']];
  const LOC = { ja: 'ja-JP', en: 'en-US', th: 'th-TH', ne: 'ne-NP', vi: 'vi-VN' };
  const T = {
    ja: { title:'わたしの清掃', jobs:'予定', guide:'ガイド', pay:'お給料', need:'返事をしてください', upcoming:'これからの予定', donesec:'終わった清掃', out:'チェックアウト', nextIn:'次のチェックイン', same:'当日', unknown:'未定', guests:'人', guestsL:'次のお客様', okBtn:'OK・時間を選ぶ', cant:'行けない', pick:'何時に入りますか?', confirm:'決定', cancel:'やめる', planned:'入る時間', start:'清掃を始める', finish:'清掃が終わった', wait:'返事待ち', ok:'OK済み', work:'清掃中', done:'完了', cantSt:'行けないと連絡済み', with:'一緒に', hint:'清掃のあとは、この写真と同じ状態にしてください。', month:'今月のお給料', times:'回', half:'2人で担当(半分)', empty:'予定はありません', started:'開始', ended:'完了', late:'分遅れ', photo:'写真(オーナーが登録)', confirmCant:'本当に行けませんか?オーナーに連絡が届きます。', yes:'はい、行けません', canSt:'できる時間', protoNote:'試作品では日付に関係なく押せます' },
    en: { title:'My cleaning jobs', jobs:'Schedule', guide:'Guide', pay:'Pay', need:'Please reply', upcoming:'Upcoming', donesec:'Finished', out:'Check-out', nextIn:'Next check-in', same:'Same day', unknown:'TBD', guests:'', guestsL:'Next guests', okBtn:'OK · Choose time', cant:"Can't go", pick:'What time will you start?', confirm:'Confirm', cancel:'Cancel', planned:'Start time', start:'Start cleaning', finish:'Finished cleaning', wait:'Waiting for reply', ok:'Accepted', work:'Cleaning now', done:'Done', cantSt:'Told owner: can\'t go', with:'With', hint:'After cleaning, make it look exactly like this photo.', month:'Pay this month', times:'jobs', half:'2 people (half)', empty:'No jobs', started:'Start', ended:'Done', late:' min late', photo:'Photo (added by owner)', confirmCant:"Really can't go? The owner will be notified.", yes:"Yes, I can't go", canSt:'Time window', protoNote:'' },
    th: { title:'งานทำความสะอาดของฉัน', jobs:'ตารางงาน', guide:'คู่มือ', pay:'ค่าจ้าง', need:'กรุณาตอบกลับ', upcoming:'งานที่จะมาถึง', donesec:'งานที่เสร็จแล้ว', out:'เช็คเอาท์', nextIn:'เช็คอินถัดไป', same:'วันเดียวกัน', unknown:'ยังไม่แน่นอน', guests:'คน', guestsL:'แขกคนถัดไป', okBtn:'ตกลง・เลือกเวลา', cant:'ไปไม่ได้', pick:'จะเข้าทำความสะอาดกี่โมง?', confirm:'ยืนยัน', cancel:'ยกเลิก', planned:'เวลาที่จะเข้า', start:'เริ่มทำความสะอาด', finish:'ทำความสะอาดเสร็จแล้ว', wait:'รอตอบกลับ', ok:'ตกลงแล้ว', work:'กำลังทำความสะอาด', done:'เสร็จแล้ว', cantSt:'แจ้งว่าไปไม่ได้แล้ว', with:'ทำร่วมกับ', hint:'หลังทำความสะอาด กรุณาจัดให้เหมือนในรูปนี้', month:'ค่าจ้างเดือนนี้', times:'ครั้ง', half:'ทำ 2 คน (ครึ่งหนึ่ง)', empty:'ไม่มีงาน', started:'เริ่ม', ended:'เสร็จ', late:' นาที สาย', photo:'รูปภาพ (เจ้าของเพิ่ม)', confirmCant:'ไปไม่ได้จริงๆ ใช่ไหม? ระบบจะแจ้งเจ้าของ', yes:'ใช่ ไปไม่ได้', canSt:'ช่วงเวลา', protoNote:'' },
    ne: { title:'मेरो सरसफाइ काम', jobs:'तालिका', guide:'निर्देशिका', pay:'तलब', need:'कृपया जवाफ दिनुहोस्', upcoming:'आउँदै गरेका काम', donesec:'सकिएका काम', out:'चेक-आउट', nextIn:'अर्को चेक-इन', same:'सोही दिन', unknown:'तय भएको छैन', guests:'जना', guestsL:'अर्को पाहुना', okBtn:'ठीक छ・समय छान्नुहोस्', cant:'आउन सक्दिन', pick:'कति बजे सुरु गर्नुहुन्छ?', confirm:'पक्का गर्नुहोस्', cancel:'रद्द', planned:'सुरु गर्ने समय', start:'सरसफाइ सुरु गर्नुहोस्', finish:'सरसफाइ सकियो', wait:'जवाफ पर्खँदै', ok:'स्वीकार गरियो', work:'सरसफाइ हुँदैछ', done:'सकियो', cantSt:'आउन नसक्ने जानकारी दिइयो', with:'सँगै', hint:'सरसफाइपछि यो फोटो जस्तै बनाउनुहोस्।', month:'यो महिनाको तलब', times:'पटक', half:'२ जनाले (आधा)', empty:'कुनै काम छैन', started:'सुरु', ended:'सकियो', late:' मिनेट ढिलो', photo:'फोटो (मालिकले राख्ने)', confirmCant:'साँच्चै आउन सक्नुहुन्न? मालिकलाई जानकारी जान्छ।', yes:'हो, आउन सक्दिन', canSt:'समय', protoNote:'' },
    vi: { title:'Công việc dọn dẹp của tôi', jobs:'Lịch', guide:'Hướng dẫn', pay:'Tiền lương', need:'Vui lòng trả lời', upcoming:'Sắp tới', donesec:'Đã xong', out:'Trả phòng', nextIn:'Nhận phòng tiếp theo', same:'Cùng ngày', unknown:'Chưa rõ', guests:'người', guestsL:'Khách tiếp theo', okBtn:'OK・Chọn giờ', cant:'Không đi được', pick:'Bạn sẽ bắt đầu lúc mấy giờ?', confirm:'Xác nhận', cancel:'Hủy', planned:'Giờ bắt đầu', start:'Bắt đầu dọn', finish:'Đã dọn xong', wait:'Chờ trả lời', ok:'Đã nhận', work:'Đang dọn', done:'Hoàn thành', cantSt:'Đã báo không đi được', with:'Làm cùng', hint:'Sau khi dọn, hãy sắp xếp giống như ảnh này.', month:'Lương tháng này', times:'lần', half:'2 người (chia đôi)', empty:'Không có lịch', started:'Bắt đầu', ended:'Xong', late:' phút trễ', photo:'Ảnh (chủ nhà thêm)', confirmCant:'Bạn thật sự không đi được? Chủ nhà sẽ được báo.', yes:'Vâng, không đi được', canSt:'Khung giờ', protoNote:'' },
  };
  const T2 = {
    ja: { listV:'リスト', calV:'カレンダー', fee:'清掃料', reimb:'立替精算', totalPay:'今月のお支払い', expTitle:'立て替えた買い物', addExp:'立替を登録する', receipt:'レシートの写真', takePhoto:'レシートを撮影する', retake:'撮り直す', pdate:'買った日', amount:'払った金額(円)', store:'お店', item:'買った物', forProp:'どの施設用', submit:'送る', st_pending:'確認中', st_approved:'承認済み', st_returned:'差し戻し', reason:'理由', needPhoto:'レシートの写真と金額を入れてください', confirmBtn:'明細の内容を確認しました', confirmedAt:'確認済み', noExp:'まだありません', resend:'直して送る', feeList:'清掃料の内訳' },
    en: { listV:'List', calV:'Calendar', fee:'Cleaning fee', reimb:'Reimbursement', totalPay:'Payment this month', expTitle:'Things I bought', addExp:'Add a purchase', receipt:'Receipt photo', takePhoto:'Take a receipt photo', retake:'Retake', pdate:'Purchase date', amount:'Amount paid (yen)', store:'Store', item:'Items', forProp:'For which property', submit:'Send', st_pending:'Checking', st_approved:'Approved', st_returned:'Returned', reason:'Reason', needPhoto:'Please add the receipt photo and the amount.', confirmBtn:'I checked this statement', confirmedAt:'Checked', noExp:'None yet', resend:'Fix and send', feeList:'Cleaning fee details' },
    th: { listV:'รายการ', calV:'ปฏิทิน', fee:'ค่าทำความสะอาด', reimb:'เงินคืนค่าซื้อของ', totalPay:'ยอดจ่ายเดือนนี้', expTitle:'ของที่ซื้อแทน', addExp:'บันทึกการซื้อของ', receipt:'รูปใบเสร็จ', takePhoto:'ถ่ายรูปใบเสร็จ', retake:'ถ่ายใหม่', pdate:'วันที่ซื้อ', amount:'จำนวนเงินที่จ่าย (เยน)', store:'ร้าน', item:'ของที่ซื้อ', forProp:'ใช้ที่บ้านไหน', submit:'ส่ง', st_pending:'กำลังตรวจสอบ', st_approved:'อนุมัติแล้ว', st_returned:'ส่งกลับ', reason:'เหตุผล', needPhoto:'กรุณาใส่รูปใบเสร็จและจำนวนเงิน', confirmBtn:'ตรวจสอบรายละเอียดแล้ว', confirmedAt:'ตรวจสอบแล้ว', noExp:'ยังไม่มี', resend:'แก้ไขแล้วส่ง', feeList:'รายละเอียดค่าทำความสะอาด' },
    ne: { listV:'सूची', calV:'क्यालेन्डर', fee:'सरसफाइ शुल्क', reimb:'खर्च फिर्ता', totalPay:'यो महिनाको भुक्तानी', expTitle:'मैले किनेका सामान', addExp:'खरिद दर्ता गर्नुहोस्', receipt:'रसिदको फोटो', takePhoto:'रसिदको फोटो खिच्नुहोस्', retake:'फेरि खिच्नुहोस्', pdate:'किनेको मिति', amount:'तिरेको रकम (येन)', store:'पसल', item:'किनेका सामान', forProp:'कुन घरको लागि', submit:'पठाउनुहोस्', st_pending:'जाँच हुँदै', st_approved:'स्वीकृत', st_returned:'फिर्ता पठाइयो', reason:'कारण', needPhoto:'कृपया रसिदको फोटो र रकम राख्नुहोस्।', confirmBtn:'विवरण जाँचें', confirmedAt:'जाँचिएको', noExp:'अहिलेसम्म छैन', resend:'सच्याएर पठाउनुहोस्', feeList:'सरसफाइ शुल्कको विवरण' },
    vi: { listV:'Danh sách', calV:'Lịch tháng', fee:'Tiền dọn dẹp', reimb:'Hoàn tiền mua đồ', totalPay:'Thanh toán tháng này', expTitle:'Đồ tôi đã mua', addExp:'Đăng ký mua đồ', receipt:'Ảnh hóa đơn', takePhoto:'Chụp hóa đơn', retake:'Chụp lại', pdate:'Ngày mua', amount:'Số tiền đã trả (yên)', store:'Cửa hàng', item:'Món đã mua', forProp:'Dùng cho nhà nào', submit:'Gửi', st_pending:'Đang kiểm tra', st_approved:'Đã duyệt', st_returned:'Bị trả lại', reason:'Lý do', needPhoto:'Vui lòng thêm ảnh hóa đơn và số tiền.', confirmBtn:'Tôi đã kiểm tra bảng kê', confirmedAt:'Đã kiểm tra', noExp:'Chưa có', resend:'Sửa và gửi lại', feeList:'Chi tiết tiền dọn dẹp' },
  };
  Object.keys(T2).forEach(k => Object.assign(T[k], T2[k]));
  const T3 = { ja: 'オーナーに通知しました', en: 'The owner has been notified', th: 'แจ้งเจ้าของแล้ว', ne: 'मालिकलाई जानकारी पठाइयो', vi: 'Đã báo cho chủ nhà' };
  Object.keys(T3).forEach(k => { T[k].notified = T3[k]; });
  const T4 = { ja: '清掃の当日に押せます', en: 'You can press this on the cleaning day', th: 'กดได้ในวันทำความสะอาด', ne: 'सरसफाइको दिन थिच्न सकिन्छ', vi: 'Bấm được vào ngày dọn dẹp' };
  Object.keys(T4).forEach(k => { T[k].onDay = T4[k]; });
  const T5 = {
    ja: { today:'本日の清掃', todayEmpty:'今日の清掃はありません', payTotal:'お支払い', pickMonth:'月を選ぶ', confirmLater:'この月の明細は、翌月1日から確認できます', confirmAsk:'の明細を確認してください', openIt:'開く' },
    en: { today:'Today', todayEmpty:'No cleaning today', payTotal:'Payment', pickMonth:'Month', confirmLater:"You can confirm this month's statement from the 1st of next month.", confirmAsk:': please check your statement', openIt:'Open' },
    th: { today:'งานวันนี้', todayEmpty:'วันนี้ไม่มีงานทำความสะอาด', payTotal:'ยอดจ่าย', pickMonth:'เลือกเดือน', confirmLater:'ตรวจสอบรายละเอียดของเดือนนี้ได้ตั้งแต่วันที่ 1 ของเดือนถัดไป', confirmAsk:': กรุณาตรวจสอบรายละเอียด', openIt:'เปิด' },
    ne: { today:'आजको काम', todayEmpty:'आज कुनै सरसफाइ छैन', payTotal:'भुक्तानी', pickMonth:'महिना छान्नुहोस्', confirmLater:'यो महिनाको विवरण अर्को महिनाको १ गतेदेखि जाँच्न सकिन्छ।', confirmAsk:': कृपया विवरण जाँच गर्नुहोस्', openIt:'खोल्नुहोस्' },
    vi: { today:'Hôm nay', todayEmpty:'Hôm nay không có lịch dọn', payTotal:'Thanh toán', pickMonth:'Chọn tháng', confirmLater:'Bạn có thể xác nhận bảng kê tháng này từ ngày 1 tháng sau.', confirmAsk:': vui lòng kiểm tra bảng kê', openIt:'Mở' },
  };
  Object.keys(T5).forEach(k => Object.assign(T[k], T5[k]));
  const t = (k) => (T[UI.lang] && T[UI.lang][k] != null ? T[UI.lang][k] : T.ja[k]);
  const monthName = (m, lang) => { try { return new Intl.DateTimeFormat(LOC[lang] || 'ja-JP', { year: 'numeric', month: 'long', calendar: 'gregory' }).format(new Date(m + '-15T00:00:00')); } catch (e) { return m; } };

  // guide: same 5 areas for each property (sample notes)
  const AREAS = [
    { key: 'bed', name: { ja:'ベッド', en:'Bed', th:'เตียง', ne:'ओछ्यान', vi:'Giường' }, notes: [
      { ja:'枕は1台に2つ。タグが見えない向きに置く', en:'2 pillows per bed. Hide the tags.', th:'หมอน 2 ใบต่อเตียง ซ่อนป้ายไม่ให้เห็น', ne:'एउटा ओछ्यानमा २ वटा सिरानी। ट्याग नदेखिने गरी राख्नुहोस्।', vi:'Mỗi giường 2 gối. Giấu nhãn đi.' },
      { ja:'シーツのしわを伸ばし、角は三角に折る', en:'Smooth the sheets. Fold corners neatly.', th:'ปูผ้าปูให้เรียบ พับมุมให้เรียบร้อย', ne:'तन्ना सम्म पार्नुहोस्। कुना राम्ररी पट्याउनुहोस्।', vi:'Kéo phẳng ga. Gấp góc gọn gàng.' } ] },
    { key: 'bath', name: { ja:'浴室', en:'Bathroom', th:'ห้องน้ำ', ne:'बाथरुम', vi:'Phòng tắm' }, notes: [
      { warn: true, ja:'排水口の髪の毛を最後にもう一度確認', en:'Check the drain for hair one last time.', th:'ตรวจเส้นผมที่ท่อระบายน้ำอีกครั้งตอนสุดท้าย', ne:'अन्तिममा नालीमा कपाल छ कि फेरि जाँच्नुहोस्।', vi:'Kiểm tra lại tóc ở lỗ thoát nước lần cuối.' },
      { ja:'鏡と蛇口の水滴を拭く', en:'Wipe water spots on the mirror and tap.', th:'เช็ดคราบน้ำที่กระจกและก๊อกน้ำ', ne:'ऐना र धारामा पानीका दाग पुछ्नुहोस्।', vi:'Lau vết nước trên gương và vòi.' } ] },
    { key: 'kitchen', name: { ja:'キッチン', en:'Kitchen', th:'ห้องครัว', ne:'भान्सा', vi:'Bếp' }, notes: [
      { ja:'食器は乾かしてから棚へ', en:'Dry the dishes before putting them away.', th:'เช็ดจานให้แห้งก่อนเก็บเข้าตู้', ne:'भाँडा सुकाएर मात्र दराजमा राख्नुहोस्।', vi:'Lau khô bát đĩa rồi mới cất.' },
      { ja:'冷蔵庫の中に忘れ物がないか確認', en:'Check the fridge for left items.', th:'ตรวจดูของที่ลืมไว้ในตู้เย็น', ne:'फ्रिजमा छुटेका सामान छन् कि हेर्नुहोस्।', vi:'Kiểm tra đồ khách để quên trong tủ lạnh.' } ] },
    { key: 'living', name: { ja:'リビング', en:'Living room', th:'ห้องนั่งเล่น', ne:'बैठक कोठा', vi:'Phòng khách' }, notes: [
      { ja:'リモコンはテーブルの中央に並べる', en:'Line up the remotes in the middle of the table.', th:'วางรีโมทเรียงไว้กลางโต๊ะ', ne:'रिमोटहरू टेबलको बीचमा मिलाएर राख्नुहोस्।', vi:'Xếp điều khiển ở giữa bàn.' } ] },
    { key: 'amenity', name: { ja:'タオル・備品', en:'Towels & supplies', th:'ผ้าเช็ดตัวและของใช้', ne:'तौलिया र सामान', vi:'Khăn & đồ dùng' }, notes: [
      { warn: true, ja:'タオルは「次のお客様の人数+1」セット', en:'Towels: number of next guests + 1 set.', th:'ผ้าเช็ดตัว: จำนวนแขกคนถัดไป + 1 ชุด', ne:'तौलिया: अर्को पाहुनाको संख्या + १ सेट।', vi:'Khăn: số khách tiếp theo + 1 bộ.' },
      { ja:'トイレットペーパーは予備を2つ', en:'Leave 2 spare toilet rolls.', th:'วางกระดาษชำระสำรอง 2 ม้วน', ne:'२ वटा थप ट्वाइलेट पेपर राख्नुहोस्।', vi:'Để 2 cuộn giấy vệ sinh dự phòng.' } ] },
  ];

  let S = null;

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const prop = (n) => S.props.find(p => p.name === n);
  const cl = (id) => S.cleaners.find(c => c.id === id);
  const yen = (v) => '¥' + new Intl.NumberFormat('ja-JP').format(Math.round(v));
  const mins = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
  const hm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const nowHM = () => { const d = new Date(); return hm(d.getHours() * 60 + d.getMinutes()); };
  const dateFmt = (s, lang) => {
    const d = new Date(s + 'T00:00:00');
    try { return new Intl.DateTimeFormat(LOC[lang] || 'ja-JP', { month: 'numeric', day: 'numeric' }).format(d); } catch (e) { return s.slice(5); }
  };
  const wdFmt = (s, lang) => { const d = new Date(s + 'T00:00:00'); try { return new Intl.DateTimeFormat(LOC[lang] || 'ja-JP', { weekday: 'short' }).format(d); } catch (e) { return ''; } };
  const jaDate = (s) => Number(s.slice(5, 7)) + '/' + Number(s.slice(8, 10)) + '(' + '日月火水木金土'[new Date(s + 'T00:00:00').getDay()] + ')';
  const lateMin = (a) => (a.plan && a.start ? mins(a.start) - mins(a.plan) : 0);
  const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  const md = (s) => Number(s.slice(5, 7)) + '/' + Number(s.slice(8, 10));
  const waitDays = (a) => (a.st === 'wait' && a.sent ? dayDiff(a.sent, TODAY) : 0);
  const isLate = (a) => a.st === 'wait' && waitDays(a) >= S.rule.replyDays; // no reply for N days
  const addDays = (s0, n) => { const d = new Date(s0 + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const REMIND_AFTER = 1; // days without a reply before the app nudges the cleaner by itself
  const nudged = (a) => a.st === 'wait' && a.sent && waitDays(a) >= REMIND_AFTER;
  // short notice: the cleaning is today or tomorrow and somebody has not replied yet
  const isRush = (j) => j.date >= TODAY && dayDiff(TODAY, j.date) <= 1 && j.asg.some(a => a.st === 'wait');
  const stuck = (j) => j.asg.filter(a => a.st === 'wait' && (isLate(a) || isRush(j)));
  const jobStatus = (j) => {
    if (!j.asg.length) return j.date < TODAY ? 'old' : j.date > addDays(TODAY, S.rule.horizon) ? 'pre' : 'none';
    if (j.asg.some(a => a.st === 'cant')) return 'bad';
    if (isRush(j)) return 'rush';
    if (j.asg.some(isLate)) return 'late';
    if (j.asg.some(a => a.st === 'wait')) return 'wait';
    if (j.asg.every(a => a.st === 'done')) return 'done';
    if (j.asg.some(a => a.st === 'work')) return 'work';
    return 'ok';
  };
  const ICON = {
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/></svg>',
    in: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h12"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3.3 4 1.9 4.5 4.5"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M8 7h7"/></svg>',
    yen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l6 8 6-8"/><path d="M12 11v10M7 13h10M7 17h10"/></svg>',
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
  };
  const icon = (k) => { const s = el('span'); s.innerHTML = ICON[k]; return s.firstChild; }; // static markup only

  // ---------- top controls ----------
  const whoSel = $('who');
  function fillWho() { whoSel.replaceChildren(...S.cleaners.map(c => { const o = el('option', null, c.name + '(' + LANG_JA[c.lang] + ')'); o.value = c.id; return o; })); whoSel.value = UI.who; }
  // open the "today" tab first when the cleaner has a job today
  const cleanerStartTab = () => { UI.ctab = cl(UI.who) && myToday().length ? 'today' : 'jobs'; UI.payM = THIS_MONTH; };
  whoSel.onchange = () => { UI.who = whoSel.value; UI.lang = cl(UI.who).lang; cleanerStartTab(); render(); };
  $('v-owner').onclick = () => { UI.view = 'owner'; render(); };
  $('v-cleaner').onclick = () => { UI.view = 'cleaner'; if (cl(UI.who)) UI.lang = cl(UI.who).lang; cleanerStartTab(); render(); };

  function render() {
    if (!cl(UI.who)) { UI.who = S.cleaners[0] ? S.cleaners[0].id : null; if (cl(UI.who) && UI.view === 'cleaner') UI.lang = cl(UI.who).lang; }
    if (!prop(UI.ogprop)) UI.ogprop = S.props[0] ? S.props[0].name : null;
    $('v-owner').setAttribute('aria-pressed', String(UI.view === 'owner'));
    $('v-cleaner').setAttribute('aria-pressed', String(UI.view === 'cleaner'));
    $('who-wrap').hidden = UI.view !== 'cleaner'; fillWho();
    document.documentElement.lang = UI.view === 'cleaner' ? UI.lang : 'ja';
    const app = $('app');
    app.replaceChildren(UI.view === 'owner' ? ownerView() : cleanerView());
    const old = document.querySelector('.sheet-bg'); if (old) old.remove();
    if (UI.sheet) document.body.append(UI.sheet());
    persist();
  }

  // ============================================================
  // CLEANER VIEW
  // ============================================================
  function myJobs() { return S.jobs.filter(j => j.asg.some(a => a.c === UI.who)); }
  // today's jobs of this cleaner, except the ones they said they cannot do
  function myToday() { return myJobs().filter(j => j.date === TODAY && j.asg.find(a => a.c === UI.who).st !== 'cant'); }
  // finished months (with something to pay) that the cleaner has not confirmed yet
  function toConfirm(cid) { return PAY_MONTHS.filter(m => m < THIS_MONTH && !S.confirms[cid + '|' + m] && monthTotal(cid, m) > 0); }
  function cleanerView() {
    const box = el('div', 'phone');
    if (!cl(UI.who)) { box.append(el('div', 'empty', '「清掃員」タブで清掃員を登録すると、清掃員の画面を確認できます。')); return box; }
    const head = el('div', 'ph-head');
    const h = el('div'); h.append(el('h1', null, t('title')), el('div', 'who', cl(UI.who).name));
    head.append(h); box.append(head);
    const langs = el('div', 'langs'); langs.setAttribute('aria-label', 'Language');
    LANGS.forEach(([k, n]) => { const b = el('button', null, n); b.type = 'button'; b.setAttribute('aria-pressed', String(UI.lang === k)); b.onclick = () => { UI.lang = k; render(); }; langs.append(b); });
    box.append(langs);

    const waitN = myJobs().filter(j => j.asg.find(a => a.c === UI.who).st === 'wait').length;
    const todayN = myToday().filter(j => j.asg.find(a => a.c === UI.who).st !== 'done').length;
    const confN = toConfirm(UI.who).length;
    const tabs = el('div', 'ctabs');
    [['today', 'today'], ['jobs', 'cal'], ['guide', 'book'], ['pay', 'yen']].forEach(([k, ic]) => {
      const b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(UI.ctab === k));
      if (k === 'today' && todayN) b.classList.add('has-today');
      const d = el('span', 'dot'); d.append(icon(ic));
      if (k === 'today' && todayN) d.append(el('span', 'badge now', String(todayN)));
      if (k === 'jobs' && waitN) d.append(el('span', 'badge', String(waitN)));
      if (k === 'pay' && confN) d.append(el('span', 'badge now', '!'));
      b.append(d, el('span', null, t(k))); b.onclick = () => { UI.ctab = k; render(); }; tabs.append(b);
    });
    box.append(tabs);
    if (UI.ctab === 'today') box.append(...cleanerToday());
    if (UI.ctab === 'jobs') { box.append(viewToggle('C', [t('listV'), t('calV')])); box.append(...(UI.modeC === 'cal' ? cleanerCalendar() : cleanerJobs())); }
    if (UI.ctab === 'guide') box.append(...cleanerGuide());
    if (UI.ctab === 'pay') box.append(...cleanerPay());
    return box;
  }

  function cleanerToday() {
    const list = myToday().sort((a, b) => a.prop.localeCompare(b.prop));
    const out = [el('div', 'sec-title', t('today') + ' · ' + dateFmt(TODAY, UI.lang) + ' ' + wdFmt(TODAY, UI.lang))];
    out.push(...(list.length ? list.map(jobCard) : [el('div', 'empty', t('todayEmpty'))]));
    return out;
  }

  function cleanerJobs() {
    const mine = myJobs();
    const me = (j) => j.asg.find(a => a.c === UI.who);
    const need = mine.filter(j => me(j).st === 'wait');
    const up = mine.filter(j => j.date > TODAY && ['ok', 'work', 'cant'].includes(me(j).st)).sort((a, b) => a.date.localeCompare(b.date));
    const fin = mine.filter(j => me(j).st === 'done').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    const out = [];
    if (need.length) { const s = el('div', 'sec-title alert', '● ' + t('need') + ' (' + need.length + ')'); out.push(s, ...need.map(jobCard)); }
    out.push(el('div', 'sec-title', t('upcoming')));
    out.push(...(up.length ? up.map(jobCard) : [el('div', 'empty', t('empty'))]));
    if (fin.length) out.push(el('div', 'sec-title', t('donesec')), ...fin.map(jobCard));
    return out;
  }

  function jobCard(j) {
    const p = prop(j.prop), a = j.asg.find(x => x.c === UI.who);
    const stMap = { wait: ['s-wait', t('wait'), 'st-wait'], ok: ['s-ok', t('ok'), 'st-ok'], work: ['s-work', t('work'), 'st-work'], done: ['s-done', t('done'), 'st-done'], cant: ['s-bad', t('cantSt'), 'st-bad'] };
    const [pc, pl, bc] = stMap[a.st];
    const c = el('article', 'card job ' + bc);
    const top = el('div', 'job-top');
    const left = el('div');
    const d = el('div', 'job-date', dateFmt(j.date, UI.lang)); d.append(el('small', null, wdFmt(j.date, UI.lang)));
    left.append(d, el('div', 'job-prop', j.prop));
    const pill = el('span', 'pill ' + pc); pill.append(el('i'), document.createTextNode(pl));
    top.append(left, pill); c.append(top);

    const facts = el('div', 'facts');
    const fact = (ic, v, l, tight) => { const f = el('div', 'fact' + (tight ? ' tight' : '')); f.append(icon(ic), el('div', 'v', v), el('div', 'l', l)); return f; };
    const same = j.nextIn === j.date;
    const nextLabel = !j.nextIn ? t('unknown') : same ? p.in : dateFmt(j.nextIn, UI.lang);
    facts.append(
      fact('out', p.out, t('out')),
      fact('in', nextLabel, t('nextIn') + (same ? ' · ' + t('same') : ''), same),
      fact('people', j.guests == null ? '—' : j.guests + (t('guests') ? ' ' + t('guests') : ''), t('guestsL')));
    c.append(facts);

    const others = j.asg.filter(x => x.c !== UI.who).map(x => cl(x.c).name);
    if (others.length) c.append(el('div', 'with', t('with') + ': ' + others.join(', ')));

    if (a.st === 'wait') {
      const act = el('div', 'actions');
      const no = el('button', 'btn ghost', t('cant')); no.type = 'button'; no.onclick = () => openCant(j);
      const yes = el('button', 'btn big-ok', t('okBtn')); yes.type = 'button'; yes.onclick = () => openTime(j);
      act.append(no, yes); c.append(act);
    }
    if (a.st === 'ok' || a.st === 'work') {
      const pl2 = el('div', 'planned'); pl2.append(el('span', null, t('planned')), el('span', 't', a.plan));
      const ch = el('button', 'btn ghost small', '✎'); ch.type = 'button'; ch.setAttribute('aria-label', 'change'); ch.style.marginLeft = 'auto'; ch.onclick = () => openTime(j);
      if (a.st === 'ok') pl2.append(ch);
      c.append(pl2);
    }
    if (a.st === 'ok') {
      const b = el('button', 'btn big-start', t('start')); b.type = 'button'; b.style.padding = '14px'; b.style.fontSize = '1.05rem';
      b.onclick = () => { a.start = nowHM(); a.st = 'work'; const lm = lateMin(a); notify(cl(UI.who).name + ' さんが ' + jaDate(j.date) + ' ' + j.prop + ' の清掃を開始しました' + (lm > 0 ? '(予定より' + lm + '分遅れ)' : '')); render(); };
      c.append(b);
      if (j.date > TODAY) { b.disabled = true; c.append(el('div', 'log', t('onDay'))); }
    }
    if (a.st === 'work') {
      c.append(logLine(a));
      const b = el('button', 'btn big-ok', t('finish')); b.type = 'button'; b.style.padding = '14px'; b.style.fontSize = '1.05rem';
      b.onclick = () => { a.end = nowHM(); a.st = 'done'; notify(cl(UI.who).name + ' さんが ' + jaDate(j.date) + ' ' + j.prop + ' の清掃を完了しました(開始 ' + a.start + ' → 完了 ' + a.end + ')'); render(); };
      c.append(b);
    }
    if (a.st === 'done') c.append(logLine(a));
    return c;
  }
  function logLine(a) {
    const l = el('div', 'log');
    l.append(document.createTextNode(t('started') + ' ' + a.start + (a.end ? ' → ' + t('ended') + ' ' + a.end : '')));
    const lm = lateMin(a); if (lm > 0) { l.append(document.createTextNode('  ')); l.append(el('span', 'late', '(' + lm + t('late') + ')')); }
    const nt = el('div', null, '✓ ' + t('notified')); nt.style.color = 'var(--done)'; l.append(nt);
    return l;
  }

  function openTime(j) {
    const p = prop(j.prop), a = j.asg.find(x => x.c === UI.who);
    let chosen = a.plan || null;
    UI.sheet = () => {
      const bg = el('div', 'sheet-bg'); bg.onclick = (e) => { if (e.target === bg) { UI.sheet = null; render(); } };
      const sh = el('div', 'sheet'); sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
      sh.append(el('h3', null, t('pick')));
      sh.append(el('div', 'muted', j.prop + ' · ' + dateFmt(j.date, UI.lang) + ' · ' + t('out') + ' ' + p.out + (j.nextIn === j.date ? ' / ' + t('nextIn') + ' ' + p.in : '')));
      const grid = el('div', 'times');
      const end = mins(p.in) - 120;
      for (let m = mins(p.out); m <= end; m += 30) {
        const v = hm(m); const b = el('button', null, v); b.type = 'button'; b.setAttribute('aria-pressed', String(chosen === v));
        b.onclick = () => { chosen = v; grid.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.textContent === v))); ok.disabled = false; };
        grid.append(b);
      }
      sh.append(grid);
      const row = el('div', 'row');
      const cancel = el('button', 'btn ghost', t('cancel')); cancel.type = 'button'; cancel.onclick = () => { UI.sheet = null; render(); };
      const ok = el('button', 'btn big-ok', t('confirm')); ok.type = 'button'; ok.disabled = !chosen;
      ok.onclick = () => { a.plan = chosen; a.st = 'ok'; notify(cl(UI.who).name + ' さんが ' + jaDate(j.date) + ' ' + j.prop + ' にOKの返事をしました(' + chosen + ' から入る予定)'); UI.sheet = null; render(); };
      row.append(cancel, ok); sh.append(row);
      bg.append(sh); return bg;
    };
    render();
  }
  function openCant(j) {
    const a = j.asg.find(x => x.c === UI.who);
    UI.sheet = () => {
      const bg = el('div', 'sheet-bg'); bg.onclick = (e) => { if (e.target === bg) { UI.sheet = null; render(); } };
      const sh = el('div', 'sheet'); sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
      sh.append(el('h3', null, t('confirmCant')), el('div', 'muted', j.prop + ' · ' + dateFmt(j.date, UI.lang)));
      const row = el('div', 'row');
      const cancel = el('button', 'btn ghost', t('cancel')); cancel.type = 'button'; cancel.onclick = () => { UI.sheet = null; render(); };
      const yes = el('button', 'btn', t('yes')); yes.type = 'button'; yes.style.background = 'var(--bad)'; yes.style.borderColor = 'var(--bad)';
      yes.onclick = () => { a.st = 'cant'; delete a.plan; notify(cl(UI.who).name + ' さんから ' + jaDate(j.date) + ' ' + j.prop + ' に「行けない」と返事がありました', 'cant'); UI.sheet = null; render(); };
      row.append(cancel, yes); sh.append(row); bg.append(sh); return bg;
    };
    render();
  }

  function myProps() { return S.props.filter(p => p.members.includes(UI.who)); }
  function cleanerGuide() {
    const out = [];
    const mine = myProps();
    if (!mine.length) return [el('div', 'empty', t('empty'))];
    if (!mine.some(p => p.name === UI.gprop)) UI.gprop = mine[0].name;
    const bar = el('div', 'g-props');
    mine.forEach(p => { const b = el('button', null, p.name); b.type = 'button'; b.setAttribute('aria-pressed', String(UI.gprop === p.name)); b.onclick = () => { UI.gprop = p.name; render(); }; bar.append(b); });
    out.push(bar, el('div', 'g-hint', t('hint')));
    S.guide[UI.gprop].forEach(ar => {
      const c = el('article', 'card area');
      const ph = el('div', 'photo');
      if (ar.photo) { const img = el('img'); img.src = ar.photo; img.alt = ar.name[UI.lang] || ar.name.ja; ph.append(img); }
      else { const inner = el('div'); inner.append(icon('cam'), el('div', null, t('photo'))); ph.append(inner); }
      c.append(ph);
      const b = el('div', 'area-body'); b.append(el('h4', null, ar.name[UI.lang] || ar.name.ja));
      const ul = el('ul'); ar.notes.forEach(n => ul.append(el('li', n.warn ? 'warn' : null, (n.warn ? '! ' : '') + (n[UI.lang] || n.ja))));
      b.append(ul); c.append(b); out.push(c);
    });
    return out;
  }

  function payFor(cid, month) {
    const rows = [];
    S.jobs.forEach(j => {
      if (j.date.slice(0, 7) !== month) return;
      const a = j.asg.find(x => x.c === cid && x.st === 'done'); if (!a) return;
      const share = j.asg.length >= 2 ? 0.5 : 1;
      rows.push({ j, amount: prop(j.prop).rate * share, half: share < 1 });
    });
    return rows.sort((a, b) => a.j.date.localeCompare(b.j.date));
  }
  // ============================================================
  // OWNER VIEW
  // ============================================================
  const STB = {
    none: ['sb-none', '!', '担当なし'], wait: ['sb-wait', '?', '返事待ち'], bad: ['sb-bad', '✕', '行けない'], late: ['sb-late', '!', '返事なし'], rush: ['sb-late', '!', '急ぎ'], pre: ['sb-pre', '…', '送信前'], old: ['sb-pre', '–', '記録なし'],
    ok: ['sb-ok', '✓', 'OK'], work: ['sb-work', '▶', '清掃中'], done: ['sb-done', '✓', '完了'],
  };
  const unsettled = (j) => ['none', 'wait', 'bad', 'late', 'rush'].includes(jobStatus(j));
  const needsFollow = (j) => { const s = jobStatus(j); return s === 'none' ? !!prop(j.prop).main : ['bad', 'late', 'rush'].includes(s); }; // the owner has to act
  const names = (list) => list.map(a => cl(a.c).name + ' さん').join('・');
  function followReason(j) {
    const s = jobStatus(j);
    if (s === 'none') return 'メイン担当が決まっていないため、自動送信できていません。';
    if (s === 'bad') return names(j.asg.filter(a => a.st === 'cant')) + 'から「行けない」と返事がありました。';
    if (s === 'rush') { const w = stuck(j); return '清掃日が' + (j.date === TODAY ? '今日' : '明日') + 'です。' + names(w) + 'に ' + md(w[0].sent) + ' に送信済みですが、まだ返事がありません' + (w[0].remind ? '(再送 ' + w[0].remind + '回)' : '') + '。日が近いため、すぐに表示しています。'; }
    const late = j.asg.filter(isLate);
    return names(late) + 'に ' + md(late[0].sent) + ' に送信 → ' + waitDays(late[0]) + '日 返事がありません' + (late[0].remind ? '(再送 ' + late[0].remind + '回)' : '') + '。';
  }
  function followBtns(j) {
    const s = jobStatus(j), out = [];
    if (s === 'late' || s === 'rush') {
      const r = el('button', 'btn ghost small', 'もう一度送る'); r.type = 'button';
      r.onclick = () => {
        const late = stuck(j);
        UI.flash = jaDate(j.date) + ' ' + j.prop + ':' + names(late) + 'にもう一度送信しました。';
        late.forEach(a => { a.sent = TODAY; a.remind = (a.remind || 0) + 1; });
        render();
      };
      out.push(r);
    }
    const b = el('button', 'btn small', s === 'none' ? '依頼する' : '代わりの人に依頼'); b.type = 'button'; b.onclick = () => openAssign(j);
    out.push(b);
    return out;
  }

  function ownerView() {
    const box = el('div', 'owner');
    const h = el('div'); h.append(el('h1', null, '清掃スケジュール'), el('div', 'note', '今日:' + jaDate(TODAY)));
    box.append(h);
    const menu = el('nav', 'omenu'); menu.setAttribute('aria-label', 'メニュー');
    const todayList = S.jobs.filter(j => j.date === TODAY);
    const todayLeft = todayList.filter(j => jobStatus(j) !== 'done').length;
    const GROUPS = [
      ['清掃', [['today', '本日の清掃'], ['jobs', '今後の清掃'], ['past', '終わった清掃']]],
      ['お金', [['exp', '立替精算'], ['pay', '支払い・明細書']]],
      ['設定', [['cleaners', '清掃員'], ['settings', '施設と担当'], ['guide', 'ガイドの登録']]],
    ];
    GROUPS.forEach(([gl, items]) => {
      const g = el('div', 'og'); const tabs = el('div', 'otabs');
      g.append(el('span', 'og-l', gl), tabs); menu.append(g);
      items.forEach(([k, l]) => {
      const b = el('button', null, l); b.type = 'button'; b.setAttribute('aria-pressed', String(UI.otab === k)); b.onclick = () => { UI.otab = k; UI.stmt = null; render(); };
      if (k === 'exp') { const n = S.expenses.filter(e => e.status === 'pending').length; if (n) b.append(document.createTextNode(' (' + n + ')')); }
      if (k === 'today' && todayList.length) { b.classList.add('has-today'); b.append(el('span', 'tbadge' + (todayLeft ? '' : ' fin'), todayLeft ? 'あと' + todayLeft + '件' : '完了')); }
      tabs.append(b);
      });
    });
    box.append(menu);
    if (UI.otab === 'jobs') {
      if (UI.flash) {
        const f = el('div', 'banner good flash'); f.append(el('div', 'h', UI.flash));
        const x = el('button', 'linkbtn', '閉じる'); x.type = 'button'; x.onclick = () => { UI.flash = null; render(); }; f.append(x); box.append(f);
      }
      box.append(viewToggle('O', ['リスト', 'カレンダー']));
      const up = ownerUpcoming();
      box.append(up[0], noticePanel(), ...(UI.modeO === 'cal' ? ownerCalendar() : up.slice(1)));
    }
    if (UI.otab === 'today') box.append(...ownerToday(todayList));
    if (UI.otab === 'exp') box.append(ownerExpenses());
    if (UI.otab === 'past') box.append(ownerJobs(S.jobs.filter(j => j.date < TODAY).reverse().slice(0, 60), true));
    if (UI.otab === 'pay') box.append(ownerPay());
    if (UI.otab === 'cleaners') box.append(ownerCleaners());
    if (UI.otab === 'settings') box.append(ownerSettings());
    if (UI.otab === 'guide') box.append(ownerGuide());
    return box;
  }

  function ownerToday(list) {
    const out = [];
    const cnt = (f) => list.filter(f).length;
    const done = cnt(j => jobStatus(j) === 'done'), work = cnt(j => jobStatus(j) === 'work');
    const follow = cnt(j => needsFollow(j)), ready = list.length - done - work - follow;
    const ban = el('div', 'banner ' + (!list.length ? 'good' : follow ? 'badb' : done === list.length ? 'good' : 'warn'));
    if (!list.length) ban.append(el('div', 'h', '今日(' + jaDate(TODAY) + ')の清掃はありません'));
    else {
      ban.append(el('div', 'h', '今日(' + jaDate(TODAY) + ')の清掃 ' + list.length + '件'));
      const chips = el('div', 'chips');
      [['完了', done, 'var(--done)'], ['清掃中', work, 'var(--work)'], ['これから', ready, 'var(--ok)'], ['要フォロー', follow, 'var(--bad)']].forEach(([l, n, c]) => { if (n) { const ch = el('span', 'chip', l + ' ' + n + '件'); ch.style.color = c; chips.append(ch); } });
      ban.append(chips);
    }
    out.push(ban, noticePanel());
    if (list.length) out.push(ownerJobs(list.slice().sort((a, b) => a.prop.localeCompare(b.prop)), false, true));
    return out;
  }

  function ownerUpcoming() {
    const up = S.jobs.filter(j => j.date >= TODAY).sort((a, b) => a.date.localeCompare(b.date));
    const week = up.filter(j => j.date > TODAY && j.date <= WEEK_END), later = up.filter(j => j.date > WEEK_END);
    const follow = up.filter(needsFollow);
    const waiting = up.filter(j => jobStatus(j) === 'wait').length;
    const ban = el('div', 'card ntc' + (follow.length ? ' alert' : ''));
    const hd = el('button', 'ntc-head'); hd.type = 'button'; hd.setAttribute('aria-expanded', String(UI.followOpen));
    hd.append(el('span', null, (follow.length ? '⚠' : '✓') + ' オーナーのフォローが必要な清掃'), follow.length ? el('span', 'ntc-new', follow.length + '件') : el('span', 'note', '0件'), el('span', 'note sp', UI.followOpen ? '閉じる ▲' : '開く ▼'));
    hd.onclick = () => { UI.followOpen = !UI.followOpen; render(); };
    ban.append(hd);
    const body = el('div', 'ntc-body');
    if (follow.length) {
      const fl = el('div', 'follow');
      follow.forEach(j => {
        const row = el('div', 'frow'), ft = el('div', 'ft'), fb = el('div', 'fb');
        const dl = el('button', 'daylink', jaDate(j.date) + ' ' + j.prop); dl.type = 'button';
        dl.onclick = () => { UI.modeO = 'cal'; saveMode('O', 'cal'); UI.calO = j.date.slice(0, 7); UI.selO = j.date; render(); };
        ft.append(dl, el('div', 'note', followReason(j)));
        fb.append(...followBtns(j)); row.append(ft, fb); fl.append(row);
      });
      body.append(fl);
    } else {
      body.append(el('div', null, 'フォローが必要な清掃はありません。'));
    }
    if (UI.followOpen) ban.append(body);
    body.append(el('div', 'note', 'チェックアウトの予定は、メイン担当に自動で送信されます。' + (waiting ? '返事待ちは ' + waiting + '件。' : '') + '1日返事がないと自動で催促し、' + S.rule.replyDays + '日たっても返事がないとき、または清掃日が明日以内のときに、ここに表示されます。'));
    const top = el('div', 'mgr');
    const noMain = S.props.filter(p => !p.main);
    if (!S.cleaners.length || noMain.length) {
      const sb0 = el('div', 'banner warn');
      if (!S.cleaners.length) sb0.append(el('div', 'h', '最初の準備:清掃員を登録してください'), el('div', 'note', '①「清掃員」タブで清掃員を追加 → ②「施設と担当」タブで施設ごとの担当とメイン担当を選ぶ。メイン担当を選ぶと、その施設の清掃依頼が自動で送られます。'));
      else sb0.append(el('div', 'h', 'メイン担当が決まっていない施設が ' + noMain.length + ' あります'), el('div', 'note', noMain.map(p => p.name).join('、') + '。「施設と担当」タブでメイン担当を選ぶと、自動送信が始まります。'));
      top.append(sb0);
    }
    top.append(ban);
    const out = [top];
    const head = (t1, t2) => { const s = el('div', 'sec-h', t1); s.append(el('small', null, t2)); return s; };
    out.push(head('1週間以内', jaDate(addDays(TODAY, 1)) + '〜' + jaDate(WEEK_END) + '・' + week.length + '件(今日の清掃は「本日の清掃」タブ)'), ownerJobs(week, false, true));
    out.push(head('それ以降', later.length + '件' + (later.length > 40 ? '(近い順に40件を表示。それより先はカレンダーで確認できます)' : '')), ownerJobs(later.slice(0, 40), false, false));
    return out;
  }

  function ownerJobs(list, past, inWeek) {
    const wrap = el('div', 'olist');
    list.forEach(j => {
      const p = prop(j.prop), s = jobStatus(j);
      const follow = !past && needsFollow(j);
      const urgent = follow || (inWeek && unsettled(j));
      const c = el('article', 'card ojob' + (urgent ? ' urgent' + (s !== 'wait' ? ' bad' : '') : ''));
      const [bc, g, lbl] = STB[s];
      const sb = el('div', 'stblock ' + bc); sb.append(el('div', 'g', g), el('div', 'l', lbl)); c.append(sb);
      const body = el('div', 'body');
      const d = el('div', 'd', jaDate(j.date) + ' ' + j.prop);
      if (follow) d.append(el('span', 'tag', '要フォロー')); else if (urgent) d.append(el('span', 'tag w', s === 'none' ? '担当なし' : '返事待ち'));
      body.append(d);
      const meta = el('div', 'meta');
      const same = j.nextIn === j.date;
      meta.append(document.createTextNode('OUT ' + p.out + ' → 次のIN '));
      meta.append(same ? el('span', 'tight', '当日 ' + p.in) : document.createTextNode(j.nextIn ? jaDate(j.nextIn) : '未定'));
      if (j.guests != null) meta.append(document.createTextNode(' · 次のお客様 ' + j.guests + '人'));
      body.append(meta);
      const who = el('div', 'who');
      if (!j.asg.length) who.append(el('span', 'note', past ? '記録がありません' : s === 'pre' ? 'まだ送信していません(清掃日の ' + S.rule.horizon + '日前になると自動で送信します)' : 'メイン担当が決まっていないため、自動送信できていません'));
      j.asg.forEach(a => {
        const map = { wait: ['s-wait', '返事待ち'], ok: ['s-ok', 'OK'], work: ['s-work', '清掃中'], done: ['s-done', '完了'], cant: ['s-bad', '行けない'] };
        const span = el('span'); span.style.display = 'inline-flex'; span.style.gap = '6px'; span.style.alignItems = 'center';
        span.append(el('span', 'nm', cl(a.c).name), isLate(a) ? pillEl('s-bad', '返事なし ' + waitDays(a) + '日') : pillEl(...map[a.st]));
        const parts = [];
        if (a.sent && !a.start) parts.push((a.auto ? '自動送信 ' : '送信 ') + md(a.sent) + (a.remind ? '(再送' + a.remind + '回)' : ''));
        if (nudged(a)) parts.push('自動で催促 ' + md(addDays(a.sent, REMIND_AFTER)));
        if (a.plan) parts.push('予定 ' + a.plan);
        if (a.start) parts.push('開始 ' + a.start);
        if (a.end) parts.push('完了 ' + a.end);
        const tm = el('span', 'tm', parts.join(' / '));
        const lm = lateMin(a); if (lm > 0) tm.append(document.createTextNode(' '), el('span', 'late', lm + '分遅れ'));
        span.append(tm); who.append(span);
      });
      if (j.asg.length >= 2) who.append(el('span', 'note', '2名(清掃料は折半)'));
      body.append(who); c.append(body);
      const act = el('div', 'act');
      if (!past && s !== 'done') {
        if (follow) act.append(...followBtns(j));
        else { const b = el('button', 'btn small ghost', s === 'none' || s === 'pre' ? '依頼する' : '変更'); b.type = 'button'; b.onclick = () => openAssign(j); act.append(b); }
      }
      c.append(act);
      wrap.append(c);
    });
    if (!list.length) wrap.append(el('div', 'empty', '該当する清掃はありません'));
    return wrap;
  }
  const pillEl = (cls, text) => { const p = el('span', 'pill ' + cls); p.append(el('i'), document.createTextNode(text)); return p; };

  function openAssign(j) {
    const p = prop(j.prop);
    const sel = new Set(j.asg.filter(a => a.st !== 'cant').map(a => a.c));
    if (!sel.size && !j.asg.length) sel.add(p.main);
    let showOthers = false;
    UI.sheet = () => {
      const bg = el('div', 'sheet-bg'); bg.onclick = (e) => { if (e.target === bg) { UI.sheet = null; render(); } };
      const sh = el('div', 'sheet'); sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
      sh.append(el('h3', null, needsFollow(j) && j.asg.length ? '代わりの人に依頼する' : '清掃を依頼する'), el('div', 'muted', jaDate(j.date) + ' ' + j.prop + '(最大2名)'));
      const list = el('div', 'picklist');
      const boxes = [];
      const sync = () => boxes.forEach(i => { i.disabled = !i.checked && sel.size >= 2; });
      const row = (c, outside) => {
        const lab = el('label'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = sel.has(c.id); boxes.push(cb);
        const was = j.asg.find(a => a.c === c.id);
        cb.onchange = () => { if (cb.checked) sel.add(c.id); else sel.delete(c.id); sync(); go.disabled = !sel.size; };
        lab.append(cb, el('span', null, c.name + '(' + LANG_JA[c.lang] + ')'));
        if (was && was.st === 'cant') lab.append(el('span', 'pill s-bad', '行けない'));
        if (was && isLate(was)) lab.append(el('span', 'pill s-bad', '返事なし'));
        if (p.main === c.id) lab.append(el('span', 'main', 'メイン担当'));
        if (outside) lab.append(el('span', 'main', '担当に追加'));
        return lab;
      };
      const members = S.cleaners.filter(c => p.members.includes(c.id));
      const others = S.cleaners.filter(c => !p.members.includes(c.id));
      list.append(el('div', 'sub', 'この施設の担当'));
      members.forEach(c => list.append(row(c, false)));
      if (others.length) {
        if (showOthers || others.some(c => sel.has(c.id))) {
          list.append(el('div', 'sub', 'この施設の担当ではない清掃員(選ぶと、この施設の担当にも追加されます)'));
          others.forEach(c => list.append(row(c, true)));
        } else {
          const more = el('button', 'linkbtn', '担当以外の清掃員にも依頼する'); more.type = 'button'; more.onclick = () => { showOthers = true; render(); };
          list.append(more);
        }
      }
      sh.append(list, el('div', 'note', 'メイン担当には予約が入った時点で自動で送信済みです。ここでは、代わりの人や2人目に手動で依頼できます。チェックを外した人には取り消しのお知らせが届きます(本番ではメールやLINE)。'));
      const r = el('div', 'row');
      const cancel = el('button', 'btn ghost', 'やめる'); cancel.type = 'button'; cancel.onclick = () => { UI.sheet = null; render(); };
      const go = el('button', 'btn', '依頼する'); go.type = 'button'; go.disabled = !sel.size;
      go.onclick = () => {
        sel.forEach(id => { if (!p.members.includes(id)) p.members.push(id); });
        const keep = j.asg.filter(a => sel.has(a.c) && a.st !== 'cant');
        const added = [...sel].filter(id => !keep.some(a => a.c === id)).map(id => ({ c: id, st: 'wait', sent: TODAY }));
        j.asg = keep.concat(added); UI.sheet = null; render();
      };
      r.append(cancel, go); sh.append(r);
      bg.append(sh); setTimeout(sync, 0); return bg;
    };
    render();
  }

  function propChecks(selected, onToggle) {
    const box = el('div', 'checks');
    const allLab = el('label', 'all'); const all = el('input'); all.type = 'checkbox';
    allLab.append(all, document.createTextNode('すべての施設')); box.append(allLab);
    const boxes = S.props.map(p => {
      const lab = el('label'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = selected(p);
      cb.onchange = () => { onToggle(p, cb.checked); syncAll(); };
      lab.append(cb, document.createTextNode(p.name)); box.append(lab);
      return [p, cb];
    });
    const syncAll = () => { const n = boxes.filter(([, cb]) => cb.checked).length; all.checked = n === boxes.length && n > 0; all.indeterminate = n > 0 && n < boxes.length; };
    all.onchange = () => { boxes.forEach(([p, cb]) => { if (cb.checked !== all.checked) { cb.checked = all.checked; onToggle(p, all.checked); } }); syncAll(); };
    syncAll();
    return box;
  }

  function ownerCleaners() {
    const wrap = el('div', 'mgr');
    wrap.append(el('div', 'note', '清掃員ごとに、名前・表示する言語・連絡方法・担当する施設を設定します。名前は欄を直すと変わります(これまでの記録はそのまま残ります)。清掃員の画面には、担当施設の清掃とガイドだけが表示されます。'));
    S.cleaners.forEach(c => {
      const card = el('div', 'card mgr-row');
      const top = el('div', 'top');
      const ni = el('input', 'nm-in'); ni.type = 'text'; ni.value = c.name; ni.setAttribute('aria-label', '名前');
      ni.onchange = () => { const v = ni.value.trim(); if (v) c.name = v; else ni.value = c.name; };
      top.append(ni);
      const ls = el('select'); ls.setAttribute('aria-label', c.name + ' の言語');
      LANGS.forEach(([k, n]) => { const o = el('option', null, n + '(' + LANG_JA[k] + ')'); o.value = k; ls.append(o); }); ls.value = c.lang;
      ls.onchange = () => { c.lang = ls.value; };
      const cs = el('select'); cs.setAttribute('aria-label', c.name + ' の連絡方法');
      ['LINE', 'メール'].forEach(v => { const o = el('option', null, '連絡:' + v); o.value = v; cs.append(o); }); cs.value = c.contact;
      cs.onchange = () => { c.contact = cs.value; };
      const del = el('button', 'linkbtn del', UI.delC === c.id ? '本当に削除する(この人への依頼の記録も消えます)' : '削除'); del.type = 'button'; del.style.marginLeft = 'auto';
      del.onclick = () => {
        if (UI.delC !== c.id) { UI.delC = c.id; render(); return; }
        S.cleaners = S.cleaners.filter(x => x.id !== c.id);
        S.props.forEach(p => { p.members = p.members.filter(x => x !== c.id); if (p.main === c.id) p.main = null; });
        S.jobs.forEach(j => { j.asg = j.asg.filter(a => a.c !== c.id); });
        S.expenses = S.expenses.filter(e => e.c !== c.id);
        Object.keys(S.confirms).forEach(k => { if (k.split('|')[0] === c.id) delete S.confirms[k]; });
        UI.delC = null; render();
      };
      top.append(ls, cs, del); card.append(top);
      card.append(el('div', 'note', '担当施設'));
      card.append(propChecks(p => p.members.includes(c.id), (p, on) => {
        if (on && !p.members.includes(c.id)) p.members.push(c.id);
        if (!on) { p.members = p.members.filter(x => x !== c.id); if (p.main === c.id) p.main = null; }
      }));
      wrap.append(card);
    });
    // add form
    const add = el('div', 'card mgr-row');
    add.append(el('div', 'nm', '清掃員を追加'));
    const grid = el('div', 'form-grid');
    const f = (label, input) => { const l = el('label', 'field'); l.append(document.createTextNode(label), input); return l; };
    const nm = el('input'); nm.type = 'text'; nm.placeholder = '例:Nguyen';
    const lg = el('select'); LANGS.forEach(([k, n]) => { const o = el('option', null, n + '(' + LANG_JA[k] + ')'); o.value = k; lg.append(o); });
    const ct = el('select'); ['LINE', 'メール'].forEach(v => { const o = el('option', null, v); o.value = v; ct.append(o); });
    grid.append(f('名前', nm), f('表示する言語', lg), f('連絡方法', ct));
    add.append(grid, el('div', 'note', '担当施設'));
    const pick = new Set();
    add.append(propChecks(() => false, (p, on) => { if (on) pick.add(p.name); else pick.delete(p.name); }));
    const msg = el('div', 'note');
    const btn = el('button', 'btn', '追加する'); btn.type = 'button'; btn.style.alignSelf = 'flex-start';
    btn.onclick = () => {
      const name = nm.value.trim(); if (!name) { msg.textContent = '名前を入力してください。'; nm.focus(); return; }
      const id = crypto.randomUUID();
      S.cleaners.push({ id, name, lang: lg.value, contact: ct.value });
      S.props.forEach(p => { if (pick.has(p.name)) p.members.push(id); });
      render();
    };
    add.append(btn, msg, el('div', 'note', '清掃員本人がログインして使えるようにする機能は、次の段階で追加します。'));
    wrap.append(add);
    return wrap;
  }

  function ownerSettings() {
    const wrap = el('div', 'mgr');
    const rc = el('div', 'card panel rule');
    const rh = el('div', 'ban-head');
    const rt = el('button', 'btn small ghost', UI.flowOpen ? '閉じる ▲' : '詳細を見る ▼'); rt.type = 'button'; rt.setAttribute('aria-expanded', String(UI.flowOpen));
    rt.onclick = () => { UI.flowOpen = !UI.flowOpen; render(); };
    rh.append(el('h2', null, '自動送信とフォローの流れ'), rt); rc.append(rh);
    if (!UI.flowOpen) rc.append(el('div', 'note', '予約が入るとメイン担当に自動送信 → 1日返事がなければ自動で催促 → 「行けない」・' + S.rule.replyDays + '日返事なし・直前の予約は「要フォロー」に表示。返事を待つ日数などの設定は「詳細を見る」から変えられます。'));
    const step = (n, node) => { const r = el('div', 'step'); const d = el('div'); d.append(node); r.append(el('b', null, String(n)), d); return r; };
    const sel = el('select'); sel.setAttribute('aria-label', '返事を待つ日数');
    [2, 3].forEach(n => { const o = el('option', null, n + '日'); o.value = String(n); sel.append(o); }); sel.value = String(S.rule.replyDays);
    sel.onchange = () => { S.rule.replyDays = Number(sel.value); render(); };
    const hz = el('select'); hz.setAttribute('aria-label', '自動送信の対象期間');
    [[30, '30日'], [60, '60日'], [90, '90日'], [365, '1年']].forEach(([n, l]) => { const o = el('option', null, l); o.value = String(n); hz.append(o); }); hz.value = String(S.rule.horizon);
    hz.onchange = () => { S.rule.horizon = Number(hz.value); render(); };
    const s1x = el('span'); s1x.append(document.createTextNode('チェックアウトの予約が入ると、その施設の「メイン担当」に清掃の依頼を自動で送ります。対象は、清掃日が今日から '), hz, document.createTextNode(' 以内の予約です。それより先の予約は、その期間に入った時点で自動で送ります。'));
    const s3 = el('span'); s3.append(document.createTextNode('次のどれかに当てはまると、オーナーの画面に「要フォロー」と表示します。①「行けない」の返事が来た ②送信から '), sel, document.createTextNode(' たっても返事がない ③清掃日が今日・明日なのに返事がない(前日に入った予約など。日数を待たずにすぐ表示)。オーナーは「もう一度送る」か「代わりの人に依頼」を選びます。'));
    if (UI.flowOpen) rc.append(
      step(1, s1x),
      step(2, document.createTextNode('清掃員は「OK・時間を選ぶ」または「行けない」で返事をします。')),
      step(3, document.createTextNode('送信から1日たっても返事がないときは、アプリが自動でもう一度お知らせして、返事を促します。')),
      step(4, s3),
      step(5, document.createTextNode('清掃の当日、清掃員が「清掃を始める」「清掃が終わった」を押すと、時刻が記録され、オーナーに通知が届きます(LINE を予定)。')),
      step(6, document.createTextNode('【将来の予定】「清掃が終わった」が押されたら、次のゲストに「清掃が終わったので入室できます」というメールを自動で送ります。Beds24 側のメール設定ができてから対応します。')),
      el('div', 'note', '試験環境では、まだ実際のメール・LINE は送信しません。画面の上で動きを確認できます。'));
    wrap.append(rc);
    const card = el('div', 'card panel');
    card.append(el('h2', null, '施設と担当'));
    const tw = el('div', 'table-wrap'); const tb = el('table');
    const hr = el('tr'); ['施設', 'OUT〜IN', '清掃料(1回)', '担当する清掃員', 'メイン担当(自動送信の送り先)'].forEach(x => hr.append(el('th', null, x)));
    const thead = el('thead'); thead.append(hr); const body = el('tbody');
    S.props.forEach(p => {
      const tr = el('tr'); tr.append(el('td', null, p.name));
      const td1 = el('td'); const s1 = el('select'); [['10:00', '16:00'], ['11:00', '15:00']].forEach(([o, i]) => { const op = el('option', null, o + '〜' + i); op.value = o; s1.append(op); });
      s1.value = p.out; s1.setAttribute('aria-label', p.name + ' OUT〜IN');
      s1.onchange = () => { p.out = s1.value; p.in = s1.value === '10:00' ? '16:00' : '15:00'; };
      td1.append(s1); tr.append(td1);
      const td2 = el('td'); const inp = el('input'); inp.type = 'number'; inp.step = '500'; inp.value = p.rate; inp.setAttribute('aria-label', p.name + ' 清掃料');
      inp.onchange = () => { p.rate = Number(inp.value) || 0; }; td2.append(inp); tr.append(td2);
      const td3 = el('td'); td3.style.whiteSpace = 'normal';
      const editing = UI.editMembers === p.id;
      if (editing) {
        const ch = el('div', 'checks');
        S.cleaners.forEach(c => {
          const lab = el('label'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = p.members.includes(c.id);
          cb.onchange = () => { if (cb.checked) p.members.push(c.id); else { p.members = p.members.filter(x => x !== c.id); if (p.main === c.id) p.main = null; } render(); };
          lab.append(cb, document.createTextNode(c.name)); ch.append(lab);
        });
        td3.append(ch);
      } else {
        const mem = S.cleaners.filter(c => p.members.includes(c.id));
        td3.append(el('div', mem.length ? 'members' : 'note', mem.length ? mem.map(c => c.name).join('、') : '(担当なし)'));
      }
      const eb = el('button', 'linkbtn', editing ? '完了' : '変更'); eb.type = 'button';
      eb.onclick = () => { UI.editMembers = editing ? null : p.id; render(); };
      td3.append(eb); tr.append(td3);
      const td4 = el('td'); const s3 = el('select');
      S.cleaners.filter(c => p.members.includes(c.id)).forEach(c => { const op = el('option', null, c.name); op.value = c.id; s3.append(op); });
      { const op = el('option', null, p.members.length ? '(未設定)' : '(担当なし)'); op.value = ''; s3.prepend(op); }
      s3.value = p.main || ''; s3.setAttribute('aria-label', p.name + ' メイン担当'); s3.onchange = () => { p.main = s3.value || null; };
      td4.append(s3); tr.append(td4);
      body.append(tr);
    });
    tb.append(thead, body); tw.append(tb); card.append(tw);
    card.append(el('div', 'note', '「担当する清掃員」に入っている人だけが、その施設の清掃とガイドを見られます。担当は「変更」から選ぶか、「清掃員」タブでまとめて選べます(すべての施設もまとめて選べます)。メイン担当は自動送信の送り先です。'));
    wrap.append(card);
    return wrap;
  }

  function ownerGuide() {
    const wrap = el('div', 'mgr');
    const bar = el('div', 'g-props');
    S.props.forEach(p => { const b = el('button', null, p.name); b.type = 'button'; b.setAttribute('aria-pressed', String(UI.ogprop === p.name)); b.onclick = () => { UI.ogprop = p.name; render(); }; bar.append(b); });
    wrap.append(bar, el('div', 'note', '場所ごとに「清掃後のあるべき姿」の写真と注意点を登録します。日本語で書くと、英語・タイ語・ネパール語・ベトナム語に自動で翻訳され、清掃員の画面ではその人の言語で表示されます。'));
    const pend = trPending().length;
    const trMsg = { busy: ['warn', '翻訳しています…'], nokey: ['warn', '自動翻訳の準備がまだできていません(翻訳用のキーを設定すると、まとめて翻訳できます)。それまでは日本語のまま表示されます。'], error: ['badb', '翻訳できませんでした。時間をおいて「翻訳する」を押してください。'] }[UI.tr];
    if (trMsg || pend) {
      const tb = el('div', 'banner ' + (trMsg ? trMsg[0] : 'warn') + ' flash');
      tb.append(el('div', 'h', trMsg ? trMsg[1] : 'まだ翻訳されていない文が ' + pend + '件 あります'));
      if (pend && UI.tr !== 'busy') { const go = el('button', 'btn small', '翻訳する'); go.type = 'button'; go.onclick = () => { UI.tr = 'idle'; runTranslate(); }; tb.append(go); }
      wrap.append(tb);
    }
    const areas = S.guide[UI.ogprop];
    areas.forEach((ar, ai) => {
      const c = el('article', 'card g-edit');
      const ph = el('label', 'photo'); ph.title = '写真を選ぶ';
      const file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
      file.onchange = async () => { const f = file.files && file.files[0]; if (!f) return; const up = await uploadPhoto(f, 'guide'); if (up) { ar.photoPath = up.path; ar.photo = up.url; render(); } };
      if (ar.photo) { const img = el('img'); img.src = ar.photo; img.alt = ar.name.ja; ph.append(img); }
      else { const inner = el('div'); inner.append(icon('cam'), el('div', null, 'タップして写真を選ぶ')); ph.append(inner); }
      ph.append(file); c.append(ph);
      const body = el('div', 'area-body');
      const top = el('div'); top.style.display = 'flex'; top.style.gap = '8px'; top.style.alignItems = 'center';
      const nameIn = el('input'); nameIn.type = 'text'; nameIn.value = ar.name.ja; nameIn.setAttribute('aria-label', '場所の名前');
      nameIn.style.cssText = 'flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:7px 9px;font-weight:700;color:var(--fg)';
      nameIn.onchange = () => { if (nameIn.value.trim() !== ar.name.ja) { ar.name = { ja: nameIn.value.trim() || '場所' }; queueTranslate(); } };
      const delA = el('button', 'linkbtn del', '場所を削除'); delA.type = 'button'; delA.onclick = () => { areas.splice(ai, 1); render(); };
      top.append(nameIn, delA); body.append(top);
      const notes = el('div', 'notes'); notes.style.marginTop = '8px';
      ar.notes.forEach((n, ni) => {
        const r = el('div', 'nrow');
        const tx = el('input'); tx.type = 'text'; tx.value = n.ja; tx.setAttribute('aria-label', '注意点');
        tx.onchange = () => { if (tx.value !== n.ja) { ar.notes[ni] = { ja: tx.value, warn: ar.notes[ni].warn }; queueTranslate(); } };
        const wl = el('label'); const wc = el('input'); wc.type = 'checkbox'; wc.checked = !!n.warn; wc.onchange = () => { ar.notes[ni].warn = wc.checked; }; wl.append(wc, document.createTextNode('重要'));
        const del = el('button', 'linkbtn del', '削除'); del.type = 'button'; del.onclick = () => { ar.notes.splice(ni, 1); render(); };
        r.append(tx, wl, del);
        if (n.ja && n.ja.trim() && !needsTr(n)) { const pv = el('div', 'tr-pv', '英語: ' + n.en); r.append(pv); }
        notes.append(r);
      });
      const addN = el('button', 'linkbtn', '+ 注意点を追加'); addN.type = 'button'; addN.style.alignSelf = 'flex-start';
      addN.onclick = () => { ar.notes.push({ ja: '' }); render(); };
      notes.append(addN); body.append(notes); c.append(body); wrap.append(c);
    });
    if (!areas.length) {
      const tp = el('button', 'btn', 'ひな形を入れる(ベッド・浴室・キッチン・リビング・タオル備品)'); tp.type = 'button'; tp.style.alignSelf = 'flex-start';
      tp.onclick = () => { JSON.parse(JSON.stringify(AREAS)).forEach(a => areas.push({ ...a, id: crypto.randomUUID(), photo: null })); render(); };
      wrap.append(tp);
    }
    const addA = el('button', 'btn ghost', '+ 場所を追加'); addA.type = 'button'; addA.style.alignSelf = 'flex-start';
    addA.onclick = () => { areas.push({ id: crypto.randomUUID(), key: 'x' + Date.now(), name: { ja: '新しい場所' }, notes: [{ ja: '' }], photo: null }); render(); };
    wrap.append(addA);
    return wrap;
  }

  // ---------- shared: log, receipt sample, view mode ----------
  const stamp = () => { const d = new Date(); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const addLog = (cid, who, text) => { const at = stamp(); S.log.push({ cid, at, who, text }); sb.from('cleaning_log').insert({ cleaner_id: cid, at, who, body: text }).then(r => { if (r.error) { console.error(r.error); setSave('error'); } }); };
  // message the owner would receive (LINE in production)
  const notify = (text, kind) => { S.notices.unshift({ at: stamp(), text, kind, fresh: true }); sb.from('cleaning_messages').insert({ audience: 'owner', kind: kind || 'info', body: text }).then(r => { if (r.error) { console.error(r.error); setSave('error'); } }); };
  function noticePanel() {
    const fresh = S.notices.filter(n => n.fresh).length;
    const box = el('div', 'card ntc');
    const head = el('button', 'ntc-head'); head.type = 'button'; head.setAttribute('aria-expanded', String(UI.noticeOpen));
    head.append(el('span', null, '🔔 清掃員からの通知'), fresh ? el('span', 'ntc-new', '新着 ' + fresh + '件') : el('span', 'note', S.notices.length + '件'), el('span', 'note sp', UI.noticeOpen ? '閉じる ▲' : '開く ▼'));
    head.onclick = () => { if (UI.noticeOpen) S.notices.forEach(n => { n.fresh = false; }); UI.noticeOpen = !UI.noticeOpen; render(); };
    box.append(head);
    if (UI.noticeOpen) {
      const body = el('div', 'ntc-body');
      body.append(el('div', 'note', '清掃員が「OK」「行けない」「清掃を始める」「清掃が終わった」を押すと、オーナーに下の文面でお知らせする予定です(試験環境ではまだ LINE・メールは送信しません。この欄で確認できます)。'));
      S.notices.slice(0, 20).forEach(n => { const r = el('div', 'ntc-row' + (n.kind === 'cant' ? ' cant' : '') + (n.fresh ? ' fresh' : '')); r.append(el('span', 'at', n.at), el('span', 'tx', n.text)); body.append(r); });
      box.append(body);
    }
    return box;
  }
  function receiptSVG(store, item, amount, date) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320" viewBox="0 0 240 320"><rect width="240" height="320" fill="#fbfaf6"/>' +
      '<text x="120" y="38" font-size="16" text-anchor="middle" font-family="sans-serif" fill="#222">' + esc(store) + '</text>' +
      '<text x="120" y="58" font-size="10" text-anchor="middle" font-family="sans-serif" fill="#666">登録番号 T1234567890123(サンプル)</text>' +
      '<text x="20" y="92" font-size="11" font-family="sans-serif" fill="#444">' + esc(date) + '</text>' +
      '<line x1="20" y1="104" x2="220" y2="104" stroke="#bbb" stroke-dasharray="3 3"/>' +
      '<text x="20" y="130" font-size="12" font-family="sans-serif" fill="#222">' + esc(item) + '</text>' +
      '<line x1="20" y1="230" x2="220" y2="230" stroke="#bbb" stroke-dasharray="3 3"/>' +
      '<text x="20" y="258" font-size="14" font-family="sans-serif" fill="#222">合計</text>' +
      '<text x="220" y="258" font-size="16" text-anchor="end" font-family="sans-serif" fill="#222">¥' + Number(amount).toLocaleString('ja-JP') + '</text>' +
      '<text x="20" y="280" font-size="10" font-family="sans-serif" fill="#666">(10%対象)</text>' +
      '<text x="120" y="306" font-size="10" text-anchor="middle" font-family="sans-serif" fill="#aaa">サンプルのレシート画像</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  const loadMode = (k) => { try { return localStorage.getItem('lz-view-' + k) || 'cal'; } catch (e) { return 'cal'; } };
  const saveMode = (k, v) => { try { localStorage.setItem('lz-view-' + k, v); } catch (e) {} };
  const CAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
  const LIST_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>';
  function viewToggle(key, labels) {
    const box = el('div', 'vtoggle'); box.setAttribute('role', 'group');
    [['cal', CAL_ICON, labels[1]], ['list', LIST_ICON, labels[0]]].forEach(([v, ic, l]) => {
      const b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(UI['mode' + key] === v));
      const s = el('span'); s.innerHTML = ic; b.append(s.firstChild, document.createTextNode(l)); // static icon markup
      b.onclick = () => { UI['mode' + key] = v; saveMode(key, v); render(); }; box.append(b);
    });
    return box;
  }
  const addMonth = (m, n) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + n; while (mo > 12) { y++; mo -= 12; } while (mo < 1) { y--; mo += 12; } return y + '-' + String(mo).padStart(2, '0'); };
  // items(date) -> [{ cls, label }]
  function calendar(key, items, lang, compact) {
    const month = UI['cal' + key];
    const card = el('div', 'card cal');
    const head = el('div', 'cal-head');
    const prev = el('button', null, '‹'); prev.type = 'button'; prev.setAttribute('aria-label', 'previous month'); prev.onclick = () => { UI['cal' + key] = addMonth(month, -1); render(); };
    const next = el('button', null, '›'); next.type = 'button'; next.setAttribute('aria-label', 'next month'); next.onclick = () => { UI['cal' + key] = addMonth(month, 1); render(); };
    let title = month;
    try { title = new Intl.DateTimeFormat(LOC[lang] || 'ja-JP', { year: 'numeric', month: 'long' }).format(new Date(month + '-01T00:00:00')); } catch (e) {}
    head.append(prev, el('b', null, title), next); card.append(head);
    const grid = el('div', 'cal-grid');
    for (let i = 0; i < 7; i++) {
      let w = '日月火水木金土'[i];
      try { w = new Intl.DateTimeFormat(LOC[lang] || 'ja-JP', { weekday: 'narrow' }).format(new Date(Date.UTC(2026, 9, 4 + i, 12))); } catch (e) {}
      grid.append(el('div', 'cal-wd' + (i === 0 ? ' sun' : ''), w));
    }
    const first = new Date(month + '-01T00:00:00');
    const start = new Date(first); start.setDate(1 - first.getDay());
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (i >= 35 && ds.slice(0, 7) !== month) break;
      const cell = el('button', 'cal-day' + (ds.slice(0, 7) !== month ? ' out' : '') + (ds === TODAY ? ' today' : '')); cell.type = 'button';
      cell.setAttribute('aria-pressed', String(UI['sel' + key] === ds));
      cell.append(el('span', 'n', String(d.getDate())));
      const its = items(ds);
      if (compact) { const dots = el('div', 'cal-dots'); its.forEach(it => { const i2 = el('i', it.cls); dots.append(i2); }); if (its.length) cell.append(dots); }
      else its.slice(0, 3).forEach(it => cell.append(el('span', 'cal-chip ' + it.cls, it.label)));
      if (!compact && its.length > 3) cell.append(el('span', 'note', '+' + (its.length - 3)));
      cell.setAttribute('aria-label', ds + ' ' + its.length);
      cell.onclick = () => { UI['sel' + key] = ds; render(); };
      grid.append(cell);
    }
    card.append(grid);
    return card;
  }
  const calLegend = (pairs) => { const l = el('div', 'cal-legend'); pairs.forEach(([cls, t1]) => { const s = el('span'); s.append(el('i', cls), document.createTextNode(t1)); l.append(s); }); return l; };

  // ---------- cleaner: calendar + pay with reimbursements ----------
  const MY_CLS = { wait: 'sb-wait', ok: 'sb-ok', work: 'sb-work', done: 'sb-done', cant: 'sb-bad' };
  function cleanerCalendar() {
    const mine = myJobs(); const me = (j) => j.asg.find(a => a.c === UI.who);
    const out = [];
    // requests waiting for a reply stay on top, whichever day is selected
    const need = mine.filter(j => me(j).st === 'wait').sort((a, b) => a.date.localeCompare(b.date));
    if (need.length) {
      out.push(el('div', 'sec-title alert', '● ' + t('need') + ' (' + need.length + ')'), ...(UI.needAll ? need : need.slice(0, 3)).map(jobCard));
      if (need.length > 3) { const mb = el('button', 'btn ghost small', UI.needAll ? '▲' : '▼ +' + (need.length - 3)); mb.type = 'button'; mb.onclick = () => { UI.needAll = !UI.needAll; render(); }; out.push(mb); }
    }
    const cal = calendar('C', (ds) => mine.filter(j => j.date === ds).map(j => ({ cls: MY_CLS[me(j).st], label: j.prop })), UI.lang, true);
    cal.append(calLegend([['sb-wait', t('wait')], ['sb-ok', t('ok')], ['sb-done', t('done')], ['sb-bad', t('cantSt')]]));
    out.push(cal);
    const sel = UI.selC; const all = mine.filter(j => j.date === sel); const day = all.filter(j => me(j).st !== 'wait');
    out.push(el('div', 'sec-title', dateFmt(sel, UI.lang) + ' ' + wdFmt(sel, UI.lang)));
    if (day.length) out.push(...day.map(jobCard)); else if (!all.length) out.push(el('div', 'empty', t('empty')));
    return out;
  }
  const expFor = (cid, month, status) => S.expenses.filter(e => e.c === cid && e.date.slice(0, 7) === month && (!status || e.status === status));
  function monthTotal(cid, m) { return payFor(cid, m).reduce((s0, r) => s0 + r.amount, 0) + expFor(cid, m, 'approved').reduce((s0, e) => s0 + e.amount, 0); }
  function monthPicker(value, onPick, lang, label) {
    const l = el('label', 'field month-pick'); l.append(document.createTextNode(label));
    const sel = el('select');
    PAY_MONTHS.forEach(m => { const o = el('option', null, monthName(m, lang)); o.value = m; sel.append(o); });
    sel.value = value; sel.onchange = () => onPick(sel.value);
    l.append(sel); return l;
  }
  function cleanerPay() {
    const month = UI.payM;
    const out = [];
    const ask = toConfirm(UI.who);
    if (ask.length && !ask.includes(month)) {
      const bn = el('div', 'banner warn flash'); bn.append(el('div', 'h', monthName(ask[0], UI.lang) + t('confirmAsk')));
      const go = el('button', 'btn small', t('openIt')); go.type = 'button'; go.onclick = () => { UI.payM = ask[0]; render(); };
      bn.append(go); out.push(bn);
    }
    out.push(monthPicker(month, (m) => { UI.payM = m; render(); }, UI.lang, t('pickMonth')));
    const rows = payFor(UI.who, month);
    const fee = rows.reduce((s, r) => s + r.amount, 0);
    const exps = expFor(UI.who, month);
    const reimb = exps.filter(e => e.status === 'approved').reduce((s, e) => s + e.amount, 0);
    const top = el('div', 'card pay-total');
    top.append(el('div', 'muted', monthName(month, UI.lang) + ' · ' + t('payTotal')), el('div', 'v', yen(fee + reimb)));
    const br = el('div', 'card breakdown');
    const r1 = el('div', 'pay-row'); r1.append(el('span', null, t('fee') + ' (' + rows.length + ' ' + t('times') + ')'), el('b', null, yen(fee)));
    const r2 = el('div', 'pay-row'); r2.append(el('span', null, t('reimb')), el('b', null, yen(reimb)));
    br.append(r1, r2);
    const key = UI.who + '|' + month;
    const cb = el('div', 'card confirm-box');
    if (S.confirms[key]) cb.append(el('div', 'confirmed', '✓ ' + t('confirmedAt') + ' ' + S.confirms[key]));
    else if (month >= THIS_MONTH) cb.append(el('div', 'note', t('confirmLater')));
    else if (fee + reimb > 0) { const b = el('button', 'btn', t('confirmBtn')); b.type = 'button'; b.onclick = () => { S.confirms[key] = stamp(); addLog(UI.who, cl(UI.who).name, Number(month.slice(5)) + '月分の明細の内容を確認'); render(); }; cb.append(b); }
    else cb.hidden = true;
    const eh = el('div', 'sec-title', t('expTitle'));
    const add = el('button', 'btn ghost', '+ ' + t('addExp')); add.type = 'button'; add.onclick = () => openExpense(null);
    const elist = el('div', 'olist');
    if (!exps.length) elist.append(el('div', 'empty', t('noExp')));
    exps.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(e => elist.append(expCard(e, false)));
    const fh = el('div', 'sec-title', t('feeList'));
    const list = el('div', 'card');
    if (!rows.length) list.append(el('div', 'empty', t('empty')));
    rows.forEach(r => {
      const row = el('div', 'pay-row');
      const l = el('div'); l.append(el('div', null, dateFmt(r.j.date, UI.lang) + ' ' + r.j.prop)); if (r.half) l.append(el('div', 'half', t('half')));
      row.append(l, el('div', 'tnum', yen(r.amount))); list.append(row);
    });
    out.push(top, br, cb, eh); if (month === THIS_MONTH) out.push(add); out.push(elist, fh, list);
    return out;
  }
  function expStatusPill(e, ja) {
    const m = { pending: ['s-wait', ja ? '確認待ち' : t('st_pending')], approved: ['s-done', ja ? '承認済み' : t('st_approved')], returned: ['s-bad', ja ? '差し戻し' : t('st_returned')] };
    return pillEl(...m[e.status]);
  }
  function expCard(e, owner) {
    const c = el('article', 'card exp');
    const th = el('button', 'thumb'); th.type = 'button'; th.setAttribute('aria-label', 'receipt');
    const img = el('img'); img.src = e.photo; img.alt = 'receipt'; th.append(img); th.onclick = () => openImage(e.photo); c.append(th);
    const mid = el('div');
    mid.append(el('div', 't1', e.item || e.store || '—'), el('div', 't2', [owner ? jaDate(e.date) : dateFmt(e.date, UI.lang), e.store, e.prop].filter(Boolean).join(' · ')));
    if (owner) mid.append(el('div', 't2', '清掃員:' + cl(e.c).name));
    const st = el('div'); st.style.marginTop = '4px'; st.append(expStatusPill(e, owner)); mid.append(st);
    c.append(mid, el('div', 'amt', yen(e.amount)));
    if (e.status === 'returned' && e.reason) {
      const rs = el('div', 'reason', (owner ? '差し戻しの理由' : t('reason')) + ':' + e.reason); c.append(rs);
      if (!owner) { const b = el('button', 'btn small', t('resend')); b.type = 'button'; b.style.gridColumn = '2 / -1'; b.style.justifySelf = 'start'; b.onclick = () => openExpense(e); c.append(b); }
    }
    if (owner) c.append(ownerExpFields(e));
    return c;
  }
  function openImage(src) {
    UI.sheet = () => {
      const bg = el('div', 'sheet-bg'); bg.onclick = () => { UI.sheet = null; render(); };
      const sh = el('div', 'sheet'); const img = el('img', 'pv'); img.src = src; img.alt = 'receipt'; img.style.maxHeight = '70vh';
      sh.append(img); bg.append(sh); return bg;
    };
    render();
  }
  function openExpense(existing) {
    const mine = myProps();
    const d = existing ? { ...existing } : { date: TODAY, amount: '', store: '', item: '', prop: (mine[0] || S.props[0]).name, photo: null };
    let err = '';
    UI.sheet = () => {
      const bg = el('div', 'sheet-bg'); bg.onclick = (e) => { if (e.target === bg) { UI.sheet = null; render(); } };
      const sh = el('div', 'sheet'); sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
      sh.append(el('h3', null, t('addExp')));
      const file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.setAttribute('capture', 'environment'); file.hidden = true;
      file.onchange = async () => { const f = file.files && file.files[0]; if (!f) return; const up = await uploadPhoto(f, 'receipts'); if (up) { d.photoPath = up.path; d.photo = up.url; render(); } };
      const shot = el('label', 'shot'); shot.append(icon('cam'), document.createTextNode(d.photo ? t('retake') : t('takePhoto')), file);
      if (d.photo) { const pv = el('img', 'pv'); pv.src = d.photo; pv.alt = t('receipt'); sh.append(pv); }
      sh.append(shot);
      const f = (label, inp) => { const l = el('label', 'field'); l.append(document.createTextNode(label), inp); return l; };
      const di = el('input'); di.type = 'date'; di.value = d.date; di.onchange = () => { d.date = di.value || TODAY; };
      const ai = el('input'); ai.type = 'number'; ai.inputMode = 'numeric'; ai.min = '0'; ai.value = d.amount; ai.oninput = () => { d.amount = ai.value; };
      const ii = el('input'); ii.type = 'text'; ii.value = d.item; ii.oninput = () => { d.item = ii.value; };
      const ps = el('select'); (mine.length ? mine : S.props).forEach(p => { const o = el('option', null, p.name); o.value = p.name; ps.append(o); }); ps.value = d.prop; ps.onchange = () => { d.prop = ps.value; };
      sh.append(f(t('amount'), ai), f(t('pdate'), di), f(t('item'), ii), f(t('forProp'), ps));
      if (err) { const m = el('div', 'msg', err); m.style.color = 'var(--bad)'; m.style.fontWeight = '700'; sh.append(m); }
      const row = el('div', 'row');
      const cancel = el('button', 'btn ghost', t('cancel')); cancel.type = 'button'; cancel.onclick = () => { UI.sheet = null; render(); };
      const go = el('button', 'btn big-ok', t('submit')); go.type = 'button';
      go.onclick = () => {
        const amt = Number(d.amount);
        if (!d.photo || !(amt > 0)) { err = t('needPhoto'); render(); return; }
        if (existing) { Object.assign(existing, { ...d, amount: amt, status: 'pending', reason: '' }); addLog(UI.who, cl(UI.who).name, '立替を修正して再提出(' + yen(amt) + ')'); }
        else { S.expenses.push({ id: crypto.randomUUID(), c: UI.who, ...d, amount: amt, status: 'pending', invoiceNo: '', taxRate: '10' }); addLog(UI.who, cl(UI.who).name, '立替を登録(' + yen(amt) + (d.item ? ' ' + d.item : '') + ')'); }
        UI.sheet = null; render();
      };
      row.append(cancel, go); sh.append(row); bg.append(sh); return bg;
    };
    render();
  }

  // ---------- owner: calendar, expenses, statements ----------
  // short label for the calendar; properties that share the first word get a longer one
  function shortName(name) {
    const first = name.split(' ')[0];
    const same = S.props.filter(p => p.name.split(' ')[0] === first).map(p => p.name);
    if (same.length < 2 || name === same.slice().sort((a, b) => a.length - b.length)[0]) return first;
    return first[0] + '.' + name.slice(first.length + 1).replace(/ /g, '');
  }
  function ownerCalendar() {
    const up = S.jobs;
    const cal = calendar('O', (ds) => up.filter(j => j.date === ds).map(j => ({ cls: STB[jobStatus(j)][0], label: shortName(j.prop) })), 'ja', false);
    cal.append(calLegend([['sb-pre', '送信前'], ['sb-late', '急ぎ・返事なし・担当なし'], ['sb-bad', '行けない'], ['sb-wait', '返事待ち'], ['sb-ok', 'OK'], ['sb-done', '完了']]));
    const sel = UI.selO; const day = S.jobs.filter(j => j.date === sel);
    const h = el('div', 'sec-h', jaDate(sel) + 'の清掃'); h.append(el('small', null, day.length + '件'));
    return [cal, h, ownerJobs(day, sel < TODAY, sel >= TODAY && sel <= WEEK_END)];
  }
  function ownerExpFields(e) {
    const box = el('div', 'owner-fields');
    const f = (label, inp) => { const l = el('label', 'field'); l.append(document.createTextNode(label), inp); return l; };
    const inv = el('input'); inv.type = 'text'; inv.placeholder = 'T + 13桁'; inv.value = e.invoiceNo || ''; inv.oninput = () => { e.invoiceNo = inv.value.trim(); };
    const tx = el('select'); [['10', '10%'], ['8', '8%(軽減)'], ['mix', '10%と8%が混在']].forEach(([v, l]) => { const o = el('option', null, l); o.value = v; tx.append(o); }); tx.value = e.taxRate || '10'; tx.onchange = () => { e.taxRate = tx.value; };
    const st0 = el('input'); st0.type = 'text'; st0.placeholder = 'レシートの店名'; st0.value = e.store || ''; st0.oninput = () => { e.store = st0.value.trim(); };
    box.append(f('お店(任意・明細書用)', st0), f('インボイス登録番号(レシートを見て入力)', inv), f('税率', tx));
    if (e.status === 'pending') {
      const rs = el('input'); rs.type = 'text'; rs.placeholder = '差し戻す場合の理由';
      const ok = el('button', 'btn small', '承認'); ok.type = 'button'; ok.style.background = 'var(--done)'; ok.style.borderColor = 'var(--done)';
      ok.onclick = () => { e.status = 'approved'; e.approvedAt = stamp(); addLog(e.c, 'オーナー', '立替を承認(' + yen(e.amount) + (e.item ? ' ' + e.item : '') + ')'); render(); };
      const ng = el('button', 'btn ghost small', '差し戻す'); ng.type = 'button';
      ng.onclick = () => { if (!rs.value.trim()) { rs.focus(); rs.placeholder = '理由を入力してください'; return; } e.status = 'returned'; e.reason = rs.value.trim(); addLog(e.c, 'オーナー', '立替を差し戻し(理由:' + e.reason + ')'); render(); };
      box.append(f('差し戻しの理由', rs), ok, ng);
    } else if (e.status === 'approved') {
      box.append(el('span', 'note', '承認日時 ' + (e.approvedAt || '')));
    }
    return box;
  }
  function ownerExpenses() {
    const wrap = el('div', 'mgr');
    const pend = S.expenses.filter(e => e.status === 'pending');
    const ban = el('div', 'banner ' + (pend.length ? 'warn' : 'good'));
    ban.append(el('div', 'h', pend.length ? '確認待ちの立替が ' + pend.length + '件 あります' : '✓ 確認待ちの立替はありません'));
    ban.append(el('div', 'note', 'レシート画像を押すと大きく表示されます。内容が正しければ「承認」すると、その月の支払いに加わります。インボイス登録番号と税率は、経費処理の明細書に載ります。'));
    wrap.append(ban);
    const tabs = el('div', 'otabs');
    [['pending', '確認待ち'], ['all', 'すべて']].forEach(([k, l]) => { const b = el('button', null, l); b.type = 'button'; b.setAttribute('aria-pressed', String(UI.expFilter === k)); b.onclick = () => { UI.expFilter = k; render(); }; tabs.append(b); });
    wrap.append(tabs);
    const list = (UI.expFilter === 'pending' ? pend : S.expenses.slice()).sort((a, b) => b.date.localeCompare(a.date));
    if (!list.length) wrap.append(el('div', 'empty', '該当する立替はありません'));
    list.forEach(e => wrap.append(expCard(e, true)));
    return wrap;
  }
  function ownerPay() {
    if (UI.stmt) return statement(UI.stmt);
    const month = UI.payMO;
    const card = el('div', 'card panel');
    card.append(monthPicker(month, (m) => { UI.payMO = m; render(); }, 'ja', '対象の月'));
    card.append(el('h2', null, Number(month.slice(5)) + '月の支払い(清掃料+立替精算)'));
    const tw = el('div', 'table-wrap'); const tb = el('table');
    const hr = el('tr'); ['清掃員', '清掃', '清掃料', '立替精算', '支払合計', '本人確認', ''].forEach((x, i) => hr.append(el('th', i && i < 5 ? 'num' : null, x)));
    const thead = el('thead'); thead.append(hr); const body = el('tbody');
    let all = 0;
    S.cleaners.forEach(c => {
      const rows = payFor(c.id, month); const fee = rows.reduce((s, r) => s + r.amount, 0);
      const reimb = expFor(c.id, month, 'approved').reduce((s, e) => s + e.amount, 0);
      const pend = expFor(c.id, month, 'pending').length;
      all += fee + reimb;
      const tr = el('tr');
      const rtd = el('td', 'num', yen(reimb)); if (pend) { rtd.append(el('div', 'note', '確認待ち ' + pend + '件')); }
      const ctd = el('td', null, S.confirms[c.id + '|' + month] ? '✓ ' + S.confirms[c.id + '|' + month] : month >= THIS_MONTH ? '翌月1日から' : fee + reimb > 0 ? '未確認' : '—');
      const btd = el('td'); const b = el('button', 'btn ghost small', '明細書'); b.type = 'button'; b.onclick = () => { UI.stmt = c.id; render(); }; btd.append(b);
      tr.append(el('td', null, c.name), el('td', 'num', rows.length + '回'), el('td', 'num', yen(fee)), rtd, el('td', 'num', yen(fee + reimb)), ctd, btd);
      body.append(tr);
    });
    const tr = el('tr'); const td = el('td', null, '合計'); td.style.fontWeight = '700'; const tdv = el('td', 'num', yen(all)); tdv.style.fontWeight = '700';
    tr.append(td, el('td'), el('td'), el('td'), tdv, el('td'), el('td')); body.append(tr);
    tb.append(thead, body); tw.append(tb); card.append(tw);
    card.append(el('div', 'note', '清掃員の「本人確認」は、翌月1日から押せます。清掃料は施設ごとの固定額で、2名で入った清掃は半額ずつです。立替精算は「承認済み」の分だけを含めます。「明細書」から、経費処理のエビデンス用の支払明細書を表示できます。'));
    return card;
  }
  function statement(cid) {
    const month = UI.payMO, c = cl(cid);
    const rows = payFor(cid, month), fee = rows.reduce((s, r) => s + r.amount, 0);
    const exps = expFor(cid, month, 'approved'), reimb = exps.reduce((s, e) => s + e.amount, 0);
    const lastDay = new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate();
    const payDay = addMonth(month, 1) + '-10';
    const wrap = el('div', 'mgr');
    const back = el('button', 'linkbtn', '← 支払い一覧に戻る'); back.type = 'button'; back.style.alignSelf = 'flex-start'; back.onclick = () => { UI.stmt = null; render(); };
    wrap.append(back);
    const s = el('div', 'card stmt');
    s.append(el('h2', null, '支払明細書'));
    const hd = el('div', 'hd');
    const dl = (pairs) => { const d = el('dl'); pairs.forEach(([k, v]) => d.append(el('dt', null, k), el('dd', null, v))); return d; };
    hd.append(
      dl([['明細番号', 'LZ-' + month.replace('-', '') + '-' + cid.slice(0, 4).toUpperCase()], ['発行日', jaDate(TODAY)], ['対象期間', jaDate(month + '-01') + '〜' + jaDate(month + '-' + lastDay)], ['支払予定日', jaDate(payDay) + '(仮)']]),
      dl([['支払先', c.name + ' 様'], ['住所', '(清掃員の登録情報から表示)'], ['発行者', 'Lazurite(事業者名・住所は設定で登録)'], ['区分', '清掃業務の報酬・立替金の精算']]));
    s.append(hd);
    const sum = el('div', 'sum');
    [['清掃料', fee], ['立替精算(実費)', reimb], ['お支払い合計', fee + reimb]].forEach(([l, v]) => { const d = el('div'); d.append(el('div', 'l', l), el('div', 'v', yen(v))); sum.append(d); });
    s.append(sum);
    // fee table
    s.append(el('h3', null, '1. 清掃料の明細(' + rows.length + '件)'));
    const t1 = el('table'); const h1 = el('tr'); ['日付', '施設', '開始', '完了', '単価', '人数', '金額'].forEach((x, i) => h1.append(el('th', i >= 4 ? 'num' : null, x)));
    const th1 = el('thead'); th1.append(h1); const b1 = el('tbody');
    rows.forEach(r => { const a = r.j.asg.find(x => x.c === cid); const tr = el('tr'); tr.append(el('td', null, jaDate(r.j.date)), el('td', null, r.j.prop), el('td', null, a.start || '—'), el('td', null, a.end || '—'), el('td', 'num', yen(prop(r.j.prop).rate)), el('td', 'num', r.half ? '2名(折半)' : '1名'), el('td', 'num', yen(r.amount))); b1.append(tr); });
    const f1 = el('tr'); const f1a = el('td', null, '小計'); f1a.colSpan = 6; f1a.style.fontWeight = '700'; const f1b = el('td', 'num', yen(fee)); f1b.style.fontWeight = '700'; f1.append(f1a, f1b); b1.append(f1);
    t1.append(th1, b1); const w1 = el('div', 'table-wrap'); w1.append(t1); s.append(w1);
    // reimbursement table
    s.append(el('h3', null, '2. 立替金の精算明細(' + exps.length + '件)'));
    if (exps.length) {
      const t2 = el('table'); const h2 = el('tr'); ['購入日', 'お店', '登録番号', '品目', '施設', '税率', '金額', 'レシート'].forEach((x, i) => h2.append(el('th', i === 6 ? 'num' : null, x)));
      const th2 = el('thead'); th2.append(h2); const b2 = el('tbody');
      exps.forEach((e, i) => {
        const tr = el('tr');
        const rc = el('td'); const rb = el('button', 'linkbtn', 'R-' + String(i + 1).padStart(2, '0')); rb.type = 'button'; rb.onclick = () => openImage(e.photo); rc.append(rb);
        tr.append(el('td', null, jaDate(e.date)), el('td', null, e.store), el('td', null, e.invoiceNo || '未入力'), el('td', null, e.item), el('td', null, e.prop), el('td', null, e.taxRate === 'mix' ? '10%/8%' : e.taxRate + '%'), el('td', 'num', yen(e.amount)), rc);
        b2.append(tr);
      });
      const f2 = el('tr'); const f2a = el('td', null, '小計'); f2a.colSpan = 6; f2a.style.fontWeight = '700'; const f2b = el('td', 'num', yen(reimb)); f2b.style.fontWeight = '700'; f2.append(f2a, f2b, el('td')); b2.append(f2);
      t2.append(th2, b2); const w2 = el('div', 'table-wrap'); w2.append(t2); s.append(w2);
    } else s.append(el('div', 'note', 'この月の承認済みの立替はありません。'));
    // records
    s.append(el('h3', null, '3. 確認の記録'));
    const rec = el('dl', 'rec');
    const conf = S.confirms[cid + '|' + month];
    rec.append(el('dt', null, '清掃員の内容確認'), el('dd', null, conf ? '確認済み ' + conf + '(アプリで本人が確認)' : '未確認'));
    rec.append(el('dt', null, '源泉徴収'), el('dd', null, '契約の形(雇用/業務委託)が決まったら、必要に応じて欄を追加します'));
    s.append(rec);
    s.append(el('h3', null, '4. 変更履歴'));
    const logs = S.log.filter(l => l.cid === cid);
    const lt = el('div', 'note'); lt.style.display = 'flex'; lt.style.flexDirection = 'column'; lt.style.gap = '2px';
    if (!logs.length) lt.append(el('span', null, '記録はありません'));
    logs.forEach(l => lt.append(el('span', null, l.at + ' ' + l.who + ':' + l.text)));
    s.append(lt);
    const tools = el('div', 'tools');
    const pb = el('button', 'btn', 'PDFで保存・印刷'); pb.type = 'button'; pb.disabled = true;
    const cb = el('button', 'btn ghost', 'CSVで出力(税理士・会計ソフト用)'); cb.type = 'button'; cb.disabled = true;
    tools.append(pb, cb, el('span', 'note', 'この段階ではまだ押せません。'));
    s.append(tools);
    wrap.append(s);
    return wrap;
  }

  async function boot() {
    const { data } = await sb.auth.getSession();
    $('loading').hidden = true;
    if (!data.session) { $('gate').hidden = false; return; }
    try { S = await loadState(); } catch (e) { console.error(e); $('gate').hidden = false; $('gate-msg').textContent = 'データを読み込めませんでした。時間をおいて、もう一度開いてください。'; return; }
    takeSnap();
    UI.modeO = loadMode('O'); UI.modeC = loadMode('C');
    if (S.jobs.some(j => j.date === TODAY)) UI.otab = 'today';
    $('wrap').hidden = false;
    render();
    document.addEventListener('change', () => persist()); // fields that do not redraw the screen
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - loadedAt > 60000) saving = saving.then(reload).catch(e => console.error(e)); });
  }
  boot();
})();
