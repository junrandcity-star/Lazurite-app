/* Lazurite 運営ボード
 * - ログイン: メールのリンク または 6桁コード(Supabase Auth)
 * - 売上ダッシュボード: properties / reservations / nightly_sales から集計
 * - 予約メモ・Todo: memos / todos を読み書き
 * 画面に出す文字はすべて textContent で入れる(HTMLとして解釈させない)。
 */
(function () {
  "use strict";

  const cfg = window.LZ_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
  });

  const ALL = "全施設";
  const CHAN = { airbnb: "Airbnb", "booking.com": "Booking.com", "trip.com": "Trip.com" };
  const CH_KEYS = ["airbnb", "booking.com", "trip.com"];
  const CH_COLORS = ["var(--s1)", "var(--s2)", "var(--s3)"];

  const S = {
    user: null, loaded: false, tab: "dash", prop: ALL,
    props: [], res: [], nights: [], memos: {}, todos: [],
    sub: "res", q: "", past: false, open: null, limit: 40, confirmDel: null,
  };

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const jstToday = () => { const d = new Date(Date.now() + 9 * 3600e3); return d.toISOString().slice(0, 10); };
  const today = jstToday();
  const thisMonth = today.slice(0, 7);
  const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const md = (s) => (s ? Number(s.slice(5, 7)) + "/" + Number(s.slice(8, 10)) : "");
  const wd = (s) => "日月火水木金土"[new Date(s + "T00:00:00Z").getUTCDay()];
  const mLabel = (m) => Number(m.slice(5, 7)) + "月";
  const daysIn = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
  const nextMonth = (m) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + 1; if (mo > 12) { y++; mo = 1; } return y + "-" + String(mo).padStart(2, "0"); };
  const prevMonth = (m) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1; if (mo < 1) { y--; mo = 12; } return y + "-" + String(mo).padStart(2, "0"); };
  const nf = new Intl.NumberFormat("ja-JP");
  const yen = (v) => (v == null || isNaN(v) ? "—" : "¥" + nf.format(Math.round(v)));
  const yenShort = (v) => (v >= 10000 ? "¥" + nf.format(Math.round(v / 10000)) + "万" : "¥" + nf.format(Math.round(v)));
  const pct = (v) => (v == null || isNaN(v) ? "—" : (v * 100).toFixed(1) + "%");
  const fmtTime = (iso) => { try { const d = new Date(iso); return (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); } catch (e) { return ""; } };
  function msg(id, text, ok) { const m = $(id); m.textContent = text || ""; m.classList.toggle("ok", !!ok); }

  // ---------- auth ----------
  let loginEmail = "";
  $("send-code").onclick = async () => {
    const email = $("email").value.trim();
    if (!email) { msg("login-msg", "メールアドレスを入力してください。"); return; }
    $("send-code").disabled = true; msg("login-msg", "");
    const { error } = await sb.auth.signInWithOtp({
      email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
    });
    $("send-code").disabled = false;
    if (error) { msg("login-msg", authError(error)); return; }
    loginEmail = email;
    $("step-email").hidden = true; $("step-code").hidden = false; $("code").focus();
  };
  $("verify-code").onclick = async () => {
    const token = $("code").value.replace(/\s/g, "");
    if (!token) { msg("login-msg", "メールに書かれたコードを入力してください。"); return; }
    $("verify-code").disabled = true; msg("login-msg", "");
    const { error } = await sb.auth.verifyOtp({ email: loginEmail, token, type: "email" });
    $("verify-code").disabled = false;
    if (error) msg("login-msg", "コードが正しくないか、期限が切れています。もう一度メールを送ってください。");
  };
  $("code").addEventListener("keydown", (e) => { if (e.key === "Enter") $("verify-code").click(); });
  $("email").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) $("send-code").click(); });
  $("back-email").onclick = () => { $("step-code").hidden = true; $("step-email").hidden = false; msg("login-msg", ""); };
  $("logout").onclick = async () => { await sb.auth.signOut(); };

  function authError(e) {
    const m = (e && e.message) || "";
    if (/signups not allowed|not found|user not found/i.test(m)) return "このメールアドレスは登録されていません。招待されたアドレスを入力してください。";
    const sec = m.match(/after (\d+) seconds?/i);
    if (sec) return "続けて送信できません。" + sec[1] + "秒ほど待ってから、もう一度お試しください。";
    if ((e && e.code === "over_email_send_rate_limit") || /email rate limit/i.test(m))
      return "ログイン用メールの送信数が上限に達しました(1時間あたりの上限)。1時間ほど待ってからお試しください。すでに届いているログインメールがあれば、そのリンクを開いてもログインできます。";
    if (/rate|too many/i.test(m)) return "短時間に何度も送信されました。しばらく待ってからもう一度お試しください。";
    return "メールを送れませんでした(" + m + ")。";
  }

  sb.auth.onAuthStateChange((_event, session) => {
    const u = session ? session.user : null;
    const changed = (u && u.id) !== (S.user && S.user.id);
    S.user = u;
    if (!u) { S.loaded = false; showLogin(); return; }
    if (changed || !S.loaded) { showMain(); loadAll(); }
  });

  function showLogin() { $("main").hidden = true; $("login").hidden = false; $("step-email").hidden = false; $("step-code").hidden = true; }
  function showMain() { $("login").hidden = true; $("main").hidden = false; $("who").textContent = S.user.email || ""; if (location.hash.includes("access_token")) history.replaceState(null, "", location.pathname); }

  // ---------- data ----------
  async function fetchAll(table, cols, order) {
    const out = []; const size = 1000;
    for (let from = 0; ; from += size) {
      let q = sb.from(table).select(cols).range(from, from + size - 1);
      if (order) q = q.order(order[0], { ascending: true }).order(order[1] || order[0], { ascending: true });
      const { data, error } = await q;
      if (error) throw error;
      out.push(...data);
      if (data.length < size) break;
    }
    return out;
  }

  async function loadAll() {
    msg("main-msg", "データを読み込んでいます…", true);
    try {
      const [props, res, nights] = await Promise.all([
        fetchAll("properties", "id,name,rooms,open_date", ["id"]),
        fetchAll("reservations", "id,property_id,external_id,channel,status,check_in,check_out,nights,room_revenue,cleaning_fee,penalty_fee", ["id"]),
        fetchAll("nightly_sales", "reservation_id,stay_date,room_revenue", ["reservation_id", "stay_date"]),
      ]);
      S.props = props.sort((a, b) => a.name.localeCompare(b.name));
      S.res = res; S.nights = nights;
      await loadNotes();
      S.loaded = true;
      msg("main-msg", "");
      $("foot").textContent = "予約データ:" + res.length + "件(エアホストCSVから取り込み)。数字は1泊ごとの宿泊料金(清掃費・キャンセル料を除く)で計算しています。";
      render();
    } catch (e) {
      msg("main-msg", "データを読み込めませんでした。時間をおいて再読み込みしてください。(" + (e.message || e) + ")");
    }
  }
  async function loadNotes() {
    const [memos, todos] = await Promise.all([
      fetchAll("memos", "reservation_id,body,updated_at", ["reservation_id"]),
      fetchAll("todos", "id,reservation_id,body,due_date,done,done_at,created_at", ["id"]),
    ]);
    S.memos = Object.fromEntries(memos.map((m) => [m.reservation_id, m]));
    S.todos = todos;
  }
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && S.loaded && !isTyping()) { try { await loadNotes(); render(); } catch (e) {} }
  });
  function isTyping() { const a = document.activeElement; return a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type === "text")); }

  // ---------- tabs & chips ----------
  $("tab-dash").onclick = () => { S.tab = "dash"; render(); };
  $("tab-todo").onclick = () => { S.tab = "todo"; render(); };
  // アプリ一覧(右上のボタンで開閉)
  const appsBtn = $("apps-btn"), appsPanel = $("apps-panel");
  const placeApps = () => {
    const r = appsBtn.getBoundingClientRect(), w = Math.min(460, innerWidth - 32);
    appsPanel.style.top = Math.round(r.bottom + 8) + "px";
    appsPanel.style.left = Math.round(Math.max(16, Math.min(r.right - w, innerWidth - 16 - w))) + "px";
  };
  window.addEventListener("resize", () => { if (!appsPanel.hidden) placeApps(); });
  const setApps = (open) => { if (open) placeApps(); appsPanel.hidden = !open; appsBtn.setAttribute("aria-expanded", String(open)); appsBtn.setAttribute("aria-label", open ? "アプリ一覧を閉じる" : "アプリ一覧を開く"); };
  appsBtn.onclick = (e) => { e.stopPropagation(); setApps(appsPanel.hidden); };
  appsPanel.addEventListener("click", (e) => { e.stopPropagation(); if (e.target.closest("a.app-tile, button.app-tile")) setApps(false); });
  document.addEventListener("click", () => setApps(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !appsPanel.hidden) { setApps(false); appsBtn.focus(); } });
  $("go-todo").onclick = () => { S.tab = "todo"; render(); window.scrollTo(0, 0); };
  function renderChips() {
    const names = [ALL, ...S.props.map((p) => p.name)];
    $("prop-chips").replaceChildren(...names.map((n) => {
      const b = el("button", "chip", n); b.type = "button"; b.setAttribute("aria-pressed", String(n === S.prop));
      b.onclick = () => { S.prop = n; S.limit = 40; render(); }; return b;
    }));
  }

  function render() {
    if (!S.loaded) return;
    $("tab-dash").setAttribute("aria-selected", String(S.tab === "dash"));
    $("tab-todo").setAttribute("aria-selected", String(S.tab === "todo"));
    $("view-dash").hidden = S.tab !== "dash";
    $("view-todo").hidden = S.tab !== "todo";
    renderChips();
    if (S.tab === "dash") renderDash(); else renderTodo();
  }

  // ============================================================
  // ダッシュボード
  // ============================================================
  function metrics() {
    const propById = Object.fromEntries(S.props.map((p) => [p.id, p]));
    const resById = Object.fromEntries(S.res.map((r) => [r.id, r]));
    const lastData = S.nights.reduce((m, n) => (n.stay_date > m ? n.stay_date : m), "0000-00-00").slice(0, 7);
    const cur = lastData >= thisMonth ? thisMonth : lastData;           // 今月(データがあれば)/最新月
    const year = cur.slice(0, 4);
    const firstData = S.nights.reduce((m, n) => (n.stay_date < m ? n.stay_date : m), "9999-12-31").slice(0, 7);
    let start = year + "-01"; if (firstData > start) start = firstData;
    const months = []; for (let m = start; m <= lastData; m = nextMonth(m)) months.push(m);

    const openDays = (p, m) => {
      const last = m + "-" + String(daysIn(m)).padStart(2, "0");
      const open = p.open_date || "0000-01-01";
      if (open > last) return 0;
      const first = open.slice(0, 7) === m ? +open.slice(8, 10) : 1;
      return (daysIn(m) - first + 1) * (p.rooms || 1);
    };

    function calc(propIds) {
      const set = new Set(propIds);
      const props = S.props.filter((p) => set.has(p.id));
      const byMonth = {};
      const blank = (m) => ({ month: m, nights: 0, revenue: 0, airbnb: 0, "booking.com": 0, "trip.com": 0, other: 0, bookings: 0, days: props.reduce((s, p) => s + openDays(p, m), 0) });
      for (const m of months) byMonth[m] = blank(m);
      if (!byMonth[prevMonth(start)]) byMonth[prevMonth(start)] = blank(prevMonth(start));
      for (const n of S.nights) {
        const r = resById[n.reservation_id]; if (!r || !set.has(r.property_id)) continue;
        const m = n.stay_date.slice(0, 7); if (!byMonth[m]) continue;
        const v = Number(n.room_revenue); const x = byMonth[m];
        x.nights++; x.revenue += v;
        if (CH_KEYS.includes(r.channel)) x[r.channel] += v; else x.other += v;
      }
      for (const r of S.res) {
        if (!set.has(r.property_id) || r.status === "cancelled") continue;
        const m = r.check_in.slice(0, 7); if (byMonth[m]) byMonth[m].bookings++;
      }
      for (const x of Object.values(byMonth)) {
        x.occ = x.days ? x.nights / x.days : null;
        x.adr = x.nights ? x.revenue / x.nights : null;
        x.revpar = x.days ? x.revenue / x.days : null;
      }
      const ytdMonths = months.filter((m) => m <= cur && m.slice(0, 4) === year);
      const sum = (k) => ytdMonths.reduce((s, m) => s + byMonth[m][k], 0);
      const ytd = { nights: sum("nights"), revenue: sum("revenue"), days: sum("days"), bookings: sum("bookings") };
      ytd.occ = ytd.days ? ytd.nights / ytd.days : null;
      ytd.adr = ytd.nights ? ytd.revenue / ytd.nights : null;
      ytd.revpar = ytd.days ? ytd.revenue / ytd.days : null;
      ytd.byCh = {};
      for (const r of S.res) {
        if (!set.has(r.property_id) || r.status === "cancelled") continue;
        if (r.check_in.slice(0, 4) !== year || r.check_in.slice(0, 7) > cur) continue;
        const c = ytd.byCh[r.channel] || (ytd.byCh[r.channel] = { bookings: 0, nights: 0, revenue: 0 });
        c.bookings++; c.nights += r.nights; c.revenue += Number(r.room_revenue);
      }
      ytd.cancels = S.res.filter((r) => set.has(r.property_id) && r.status === "cancelled" && r.check_in.slice(0, 4) === year).length;
      return { byMonth, ytd, cur: byMonth[cur], prev: byMonth[prevMonth(cur)] };
    }

    const selIds = S.prop === ALL ? S.props.map((p) => p.id) : S.props.filter((p) => p.name === S.prop).map((p) => p.id);
    return { months, cur, year, lastData, calc, sel: calc(selIds), propById };
  }

  function renderDash() {
    const M = metrics();
    const { sel, cur } = M;
    const isNow = cur === thisMonth;
    const curName = isNow ? "今月(" + mLabel(cur) + ")" : "最新月(" + mLabel(cur) + ")";
    $("dash-lede").textContent = (S.prop === ALL ? "全施設" : S.prop) + "。大きな数字は" + curName + "、矢印は前月比、下段は" + M.year + "年1月からの累計。" + (isNow ? "今月は今日以降の予約済み分を含みます。" : "");

    const c = sel.cur, p = sel.prev, y = sel.ytd;
    const chg = (a, b) => (a == null || !b ? null : a / b - 1);
    const tiles = [
      { lab: "宿泊売上(清掃費除く)", val: yen(c.revenue), d: chg(c.revenue, p && p.revenue), unit: "%", cum: yen(y.revenue) },
      { lab: "稼働率", val: pct(c.occ), d: c.occ != null && p && p.occ != null ? c.occ - p.occ : null, unit: "pt", cum: pct(y.occ) },
      { lab: "ADR(平均1泊単価)", val: yen(c.adr), d: chg(c.adr, p && p.adr), unit: "%", cum: yen(y.adr) },
      { lab: "RevPAR", val: yen(c.revpar), d: chg(c.revpar, p && p.revpar), unit: "%", cum: yen(y.revpar) },
      { lab: "予約件数(チェックイン)", val: c.bookings + "件", d: p ? c.bookings - p.bookings : null, unit: "件", cum: y.bookings + "件(キャンセル " + y.cancels + "件)" },
    ];
    $("tiles").replaceChildren(...tiles.map((t) => {
      const box = el("div", "tile");
      box.append(el("div", "lab", t.lab), el("div", "val", t.val));
      const d = el("div", "delta");
      if (t.d != null && isFinite(t.d)) {
        const n = t.unit === "件" ? t.d : t.d * 100;
        d.textContent = (n > 0 ? "▲ +" : n < 0 ? "▼ " : "± ") + (t.unit === "件" ? n : n.toFixed(1)) + t.unit + " 前月比";
        d.classList.add(n > 0 ? "up" : n < 0 ? "down" : "flat");
      }
      const cum = el("div", "cum"); cum.append(document.createTextNode(M.year + "年累計 "), el("b", "", t.cum));
      box.append(d, cum); return box;
    }));

    // charts
    const rows = M.months.map((m) => sel.byMonth[m]);
    const present = CH_KEYS.filter((k) => rows.some((r) => r[k]));
    $("rev-legend").replaceChildren(...present.map((k) => { const s = el("span"); const w = el("i", "sw"); w.style.background = CH_COLORS[CH_KEYS.indexOf(k)]; s.append(w, document.createTextNode(CHAN[k])); return s; }));
    barChart($("rev-chart"), rows, {
      keys: present.concat(rows.some((r) => r.other) ? ["other"] : []),
      colors: present.map((k) => CH_COLORS[CH_KEYS.indexOf(k)]).concat(["var(--muted)"]),
      fmtAxis: yenShort,
      tip: (r) => [...present.filter((k) => r[k]).map((k) => [CH_COLORS[CH_KEYS.indexOf(k)], CHAN[k], yen(r[k])]), [null, "合計", yen(r.revenue)]],
      future: (r) => r.month > thisMonth,
    });
    barChart($("occ-chart"), rows, {
      keys: ["occ"], colors: ["var(--s1)"], yMax: 1, fmtAxis: (v) => Math.round(v * 100) + "%",
      tip: (r) => (r.days ? [[null, "稼働率", pct(r.occ)], [null, "販売泊数", r.nights + " / " + r.days + "日"], [null, "ADR", yen(r.adr)]] : [[null, "", "営業開始前"]]),
      future: (r) => r.month > thisMonth,
    });

    // property table
    const pt = $("prop-table");
    const head = el("thead"); const hr = el("tr");
    [["施設", ""], [mLabel(cur) + "の売上", "num"], [mLabel(cur) + "の稼働率", "num"], ["累計売上", "num"], ["累計稼働率", "num hide-narrow"], ["ADR", "num hide-narrow"], ["予約件数", "num hide-narrow"]]
      .forEach(([t, c2]) => { const th = el("th", c2, t); hr.append(th); });
    head.append(hr);
    const body = el("tbody");
    const prows = S.props.map((p) => ({ p, m: M.calc([p.id]) })).sort((a, b) => b.m.ytd.revenue - a.m.ytd.revenue);
    const maxRev = Math.max(1, ...prows.map((x) => x.m.ytd.revenue));
    prows.forEach(({ p, m }) => {
      const tr = el("tr"); if (p.name === S.prop) tr.className = "sel";
      tr.onclick = () => { S.prop = S.prop === p.name ? ALL : p.name; render(); };
      tr.append(el("td", "", p.name), el("td", "num", yen(m.cur.revenue)), el("td", "num", pct(m.cur.occ)));
      const td = el("td", "num"); const bc = el("div", "bar-cell"); const bar = el("i"); bar.style.width = Math.round((m.ytd.revenue / maxRev) * 56) + "px";
      bc.append(bar, document.createTextNode(yen(m.ytd.revenue))); td.append(bc); tr.append(td);
      tr.append(el("td", "num hide-narrow", pct(m.ytd.occ)), el("td", "num hide-narrow", yen(m.ytd.adr)), el("td", "num hide-narrow", m.ytd.bookings + "件"));
      body.append(tr);
    });
    pt.replaceChildren(head, body);

    // channel table
    const ct = $("ch-table");
    const h2 = el("thead"); const r2 = el("tr");
    [["チャネル", ""], ["予約件数", "num"], ["泊数", "num"], ["平均泊数", "num"], ["宿泊売上", "num"], ["ADR", "num"]].forEach(([t, c2]) => r2.append(el("th", c2, t)));
    h2.append(r2);
    const b2 = el("tbody");
    Object.entries(y.byCh).sort((a, b) => b[1].revenue - a[1].revenue).forEach(([k, v]) => {
      const tr = el("tr");
      tr.append(el("td", "", CHAN[k] || k), el("td", "num", v.bookings + "件"), el("td", "num", v.nights + "泊"),
        el("td", "num", (v.nights / v.bookings).toFixed(1) + "泊"), el("td", "num", yen(v.revenue)), el("td", "num", yen(v.nights ? v.revenue / v.nights : null)));
      b2.append(tr);
    });
    ct.replaceChildren(h2, b2);
  }

  // simple stacked bar chart in SVG
  function barChart(box, rows, o) {
    box.replaceChildren();
    const W = Math.max(300, box.clientWidth || 300), H = 230, mb = 22, mt = 8;
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("role", "img");
    const total = (r) => o.keys.reduce((s, k) => s + (r[k] || 0), 0);
    let max = o.yMax != null ? o.yMax : Math.max(1, ...rows.map(total));
    const ticks = niceTicks(max); max = ticks[ticks.length - 1];
    // left margin from widest tick label
    const probe = document.createElementNS(NS, "text"); svg.append(probe); box.append(svg);
    let ml = 0; ticks.forEach((t) => { probe.textContent = o.fmtAxis(t); ml = Math.max(ml, probe.getComputedTextLength ? probe.getComputedTextLength() : 40); });
    probe.remove(); ml = Math.ceil(ml) + 8;
    const y = (v) => mt + (H - mb - mt) * (1 - v / max);
    ticks.forEach((t) => {
      const ln = document.createElementNS(NS, "line"); ln.setAttribute("x1", ml); ln.setAttribute("x2", W); ln.setAttribute("y1", y(t)); ln.setAttribute("y2", y(t)); ln.setAttribute("stroke", "var(--grid)"); svg.append(ln);
      const tx = document.createElementNS(NS, "text"); tx.setAttribute("x", ml - 6); tx.setAttribute("y", y(t) + 4); tx.setAttribute("text-anchor", "end"); tx.textContent = o.fmtAxis(t); svg.append(tx);
    });
    const band = (W - ml) / Math.max(1, rows.length), bw = Math.min(30, band * 0.62);
    const every = band < 26 ? 2 : 1;
    rows.forEach((r, i) => {
      const x0 = ml + band * i + (band - bw) / 2;
      const g = document.createElementNS(NS, "g"); if (o.future && o.future(r)) g.setAttribute("opacity", "0.45");
      let acc = 0; const ks = o.keys.filter((k) => r[k]);
      ks.forEach((k, j) => {
        const v = r[k]; const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", x0); rect.setAttribute("width", bw); rect.setAttribute("y", y(acc + v)); rect.setAttribute("height", Math.max(0, y(acc) - y(acc + v)));
        rect.setAttribute("fill", o.colors[o.keys.indexOf(k)]); if (j === ks.length - 1) rect.setAttribute("rx", 3);
        g.append(rect); acc += v;
      });
      svg.append(g);
      if (i % every === 0) { const tx = document.createElementNS(NS, "text"); tx.setAttribute("x", ml + band * i + band / 2); tx.setAttribute("y", H - 6); tx.setAttribute("text-anchor", "middle"); tx.textContent = mLabel(r.month); svg.append(tx); }
      const hit = document.createElementNS(NS, "rect"); hit.setAttribute("x", ml + band * i); hit.setAttribute("width", band); hit.setAttribute("y", 0); hit.setAttribute("height", H - mb); hit.setAttribute("fill", "transparent");
      const show = (ev) => showTip(box, mLabel(r.month), o.tip(r), ev);
      hit.addEventListener("mousemove", show); hit.addEventListener("click", show); hit.addEventListener("mouseleave", () => hideTip(box));
      svg.append(hit);
    });
  }
  function niceTicks(max) {
    const step0 = max / 4; const p = Math.pow(10, Math.floor(Math.log10(step0))); const f = step0 / p;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
    const out = []; for (let v = 0; v <= max + step * 0.999; v += step) out.push(+v.toFixed(10)); return out;
  }
  function showTip(box, title, lines, ev) {
    let t = box.querySelector(".tip"); if (!t) { t = el("div", "tip"); box.append(t); }
    t.replaceChildren(el("div", "t", title));
    lines.forEach(([c, n, v]) => { const r = el("div"); if (c) { const s = el("i", "sw"); s.style.background = c; s.style.marginRight = "6px"; r.append(s); } r.append(document.createTextNode((n ? n + " " : "") + v)); t.append(r); });
    const rect = box.getBoundingClientRect(); const x = ev.clientX - rect.left;
    t.hidden = false; const tw = t.offsetWidth;
    t.style.left = Math.max(0, Math.min(rect.width - tw, x - tw / 2)) + "px"; t.style.top = "0px";
  }
  function hideTip(box) { const t = box.querySelector(".tip"); if (t) t.hidden = true; }
  let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (S.tab === "dash") render(); }, 150); });

  // ============================================================
  // 予約メモ・Todo
  // ============================================================
  $("sub-res").onclick = () => { S.sub = "res"; render(); };
  $("sub-list").onclick = () => { S.sub = "list"; render(); };
  $("q").addEventListener("input", (e) => { S.q = e.target.value.trim().toLowerCase(); S.limit = 40; render(); });
  $("past").addEventListener("change", (e) => { S.past = e.target.checked; S.limit = 40; render(); });

  const propName = (r) => { const p = S.props.find((x) => x.id === r.property_id); return p ? p.name : ""; };
  const dueClass = (t) => (!t.due_date || t.done ? "" : t.due_date < today ? "over" : t.due_date <= addDays(today, 3) ? "soon" : "");
  const todosFor = (rid) => S.todos.filter((t) => t.reservation_id === rid)
    .sort((a, b) => (a.done - b.done) || String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")) || a.id - b.id);
  function matches(r) {
    if (S.prop !== ALL && propName(r) !== S.prop) return false;
    if (!S.q) return true;
    const memo = (S.memos[r.id] || {}).body || "";
    return (r.external_id + " " + propName(r) + " " + memo + " " + todosFor(r.id).map((t) => t.body).join(" ")).toLowerCase().includes(S.q);
  }
  function writeFailed(e) { msg("main-msg", "保存できませんでした。通信状態を確認して、もう一度お試しください。(" + ((e && e.message) || e) + ")"); }

  function renderTodo() {
    $("sub-res").setAttribute("aria-pressed", String(S.sub === "res"));
    $("sub-list").setAttribute("aria-pressed", String(S.sub === "list"));
    $("past").parentElement.hidden = S.sub !== "res";
    const open = S.todos.filter((t) => !t.done);
    const stat = (label, n, cls) => { const s = el("span", "stat" + (cls && n ? " " + cls : "")); s.append(document.createTextNode(label), el("b", "", String(n))); return s; };
    $("todo-stats").replaceChildren(
      stat("未完了のTodo", open.length),
      stat("期限切れ", open.filter((t) => t.due_date && t.due_date < today).length, "bad"),
      stat("今日〜3日以内が期限", open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= addDays(today, 3)).length));
    if (S.sub === "res") renderResList(); else renderTodoList();
  }

  function renderResList() {
    let list = S.res.filter(matches);
    if (!S.past && !S.q) list = list.filter((r) => (r.check_out || r.check_in) >= today || todosFor(r.id).some((t) => !t.done));
    list.sort((a, b) => (S.past || S.q ? b.check_in.localeCompare(a.check_in) : a.check_in.localeCompare(b.check_in)));
    const v = $("todo-view");
    if (!list.length) { v.replaceChildren(el("div", "empty", S.past || S.q ? "条件に合う予約がありません。" : "今後の予約がありません。「過去の予約も表示」にチェックすると、これまでの予約にもメモやTodoを残せます。")); return; }
    const out = list.slice(0, S.limit).map(resCard);
    if (list.length > S.limit) { const m = el("button", "more", "さらに表示(残り " + (list.length - S.limit) + " 件)"); m.type = "button"; m.onclick = () => { S.limit += 40; render(); }; out.push(m); }
    v.replaceChildren(...out);
  }

  function resCard(r) {
    const card = el("article", "res"); card.id = "res-" + r.id;
    const head = el("button", "res-head"); head.type = "button"; head.setAttribute("aria-expanded", String(S.open === r.id));
    const dates = el("div", "res-dates", md(r.check_in) + "(" + wd(r.check_in) + ")→ " + (r.check_out ? md(r.check_out) + "(" + wd(r.check_out) + ")" : "—"));
    dates.append(el("small", "", r.nights + "泊"));
    const badges = el("div", "res-badges");
    if (r.status === "cancelled") badges.append(el("span", "badge bad", "キャンセル"));
    const ts = todosFor(r.id), openN = ts.filter((t) => !t.done).length, over = ts.filter((t) => dueClass(t) === "over").length;
    if (over) badges.append(el("span", "badge bad", "期限切れ " + over));
    if (openN) badges.append(el("span", "badge", "Todo " + openN)); else if (ts.length) badges.append(el("span", "badge muted", "Todo 完了"));
    if ((S.memos[r.id] || {}).body) badges.append(el("span", "badge muted", "メモ"));
    head.append(dates, badges, el("div", "res-meta", propName(r) + " · " + (CHAN[r.channel] || r.channel || "") + " · " + r.external_id));
    head.onclick = () => { S.open = S.open === r.id ? null : r.id; S.confirmDel = null; render(); };
    card.append(head);
    if (S.open === r.id) card.append(resBody(r));
    return card;
  }

  function resBody(r) {
    const body = el("div", "res-body");
    const memo = S.memos[r.id] || {};
    const mBox = el("div"); mBox.append(el("div", "lab2", "メモ"));
    const ta = el("textarea"); ta.id = "memo-" + r.id; ta.value = memo.body || ""; ta.placeholder = "例:到着が遅くなる予定。駐車場の案内を送る。";
    const row = el("div", "row-end"); const saved = el("span", "saved", memo.updated_at ? "最終更新 " + fmtTime(memo.updated_at) : "");
    const btn = el("button", "btn ghost", "メモを保存"); btn.type = "button"; btn.disabled = true;
    ta.addEventListener("input", () => { btn.disabled = ta.value === (memo.body || ""); if (!btn.disabled) saved.textContent = "未保存の変更があります"; });
    const save = async () => {
      if (btn.disabled) return; btn.disabled = true;
      const { data, error } = await sb.from("memos").upsert({ reservation_id: r.id, body: ta.value, updated_at: new Date().toISOString() }, { onConflict: "reservation_id" }).select().single();
      if (error) { writeFailed(error); btn.disabled = false; saved.textContent = "保存できませんでした"; return; }
      S.memos[r.id] = data; memo.body = data.body; saved.textContent = "保存しました"; msg("main-msg", "");
    };
    btn.onclick = save; ta.addEventListener("blur", (e) => { if (e.relatedTarget !== btn) save(); });
    row.append(saved, btn); mBox.append(ta, row);

    const tBox = el("div"); tBox.append(el("div", "lab2", "Todo"));
    const ul = el("ul", "todos"); fillTodos(ul, r.id);
    const add = el("div", "add");
    const it = el("input"); it.type = "text"; it.id = "new-" + r.id; it.placeholder = "やること(例:清掃業者に連絡)"; it.setAttribute("aria-label", "新しいTodo");
    const due = el("input"); due.type = "date"; due.setAttribute("aria-label", "期限");
    const ab = el("button", "btn", "追加"); ab.type = "button";
    const doAdd = async () => {
      const text = it.value.trim(); if (!text) { it.focus(); return; }
      ab.disabled = true;
      const { data, error } = await sb.from("todos").insert({ reservation_id: r.id, body: text, due_date: due.value || null }).select().single();
      ab.disabled = false;
      if (error) { writeFailed(error); return; }
      S.todos.push(data); msg("main-msg", ""); render(); const ni = document.getElementById("new-" + r.id); if (ni) ni.focus();
    };
    ab.onclick = doAdd; it.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) doAdd(); });
    add.append(it, due, ab); tBox.append(ul, add);
    body.append(mBox, tBox);
    return body;
  }

  function fillTodos(ul, rid) {
    const ts = todosFor(rid);
    if (!ts.length) { ul.replaceChildren(el("li", "muted", "まだTodoはありません。下の欄から追加できます。")); return; }
    ul.replaceChildren(...ts.map((t) => {
      const li = el("li", "todo" + (t.done ? " done" : ""));
      const cb = el("input"); cb.type = "checkbox"; cb.checked = !!t.done; cb.setAttribute("aria-label", "完了");
      cb.onchange = () => setDone(t, cb.checked);
      const tx = el("div", "todo-text", t.body);
      if (t.due_date) tx.append(el("span", "due " + dueClass(t), "期限 " + md(t.due_date) + "(" + wd(t.due_date) + ")"));
      const del = el("button", "del" + (S.confirmDel === t.id ? " confirm" : ""), S.confirmDel === t.id ? "本当に削除" : "削除"); del.type = "button";
      del.onclick = async () => {
        if (S.confirmDel !== t.id) { S.confirmDel = t.id; fillTodos(ul, rid); return; }
        S.confirmDel = null;
        const { error } = await sb.from("todos").delete().eq("id", t.id);
        if (error) { writeFailed(error); return; }
        S.todos = S.todos.filter((x) => x.id !== t.id); render();
      };
      li.append(cb, tx, del); return li;
    }));
  }
  async function setDone(t, done) {
    const { error } = await sb.from("todos").update({ done, done_at: done ? new Date().toISOString() : null }).eq("id", t.id);
    if (error) { writeFailed(error); render(); return; }
    t.done = done; render();
  }

  function renderTodoList() {
    const byId = Object.fromEntries(S.res.map((r) => [r.id, r]));
    let ts = S.todos.filter((t) => !t.done && byId[t.reservation_id] && (S.prop === ALL || propName(byId[t.reservation_id]) === S.prop));
    if (S.q) ts = ts.filter((t) => (t.body + " " + byId[t.reservation_id].external_id + " " + propName(byId[t.reservation_id])).toLowerCase().includes(S.q));
    const v = $("todo-view");
    if (!ts.length) { v.replaceChildren(el("div", "empty", S.todos.length ? "未完了のTodoはありません。" : "まだTodoがありません。「予約ごと」で予約を開くと追加できます。")); return; }
    const in3 = addDays(today, 3);
    const groups = [
      ["期限切れ", "bad", ts.filter((t) => t.due_date && t.due_date < today)],
      ["今日〜3日以内", "", ts.filter((t) => t.due_date && t.due_date >= today && t.due_date <= in3)],
      ["それ以降", "", ts.filter((t) => t.due_date && t.due_date > in3)],
      ["期限なし", "", ts.filter((t) => !t.due_date)],
    ];
    const out = [];
    groups.forEach(([name, cls, g]) => {
      if (!g.length) return;
      const sec = el("section", "group list"); sec.append(el("h3", cls, name + "(" + g.length + ")"));
      g.sort((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || ""))).forEach((t) => {
        const r = byId[t.reservation_id];
        const box = el("div", "tl");
        const cb = el("input"); cb.type = "checkbox"; cb.setAttribute("aria-label", "完了"); cb.onchange = () => setDone(t, cb.checked);
        const col = el("div"); const tx = el("div", "todo-text", t.body);
        if (t.due_date) tx.append(el("span", "due " + dueClass(t), "期限 " + md(t.due_date) + "(" + wd(t.due_date) + ")"));
        const w = el("button", "where", md(r.check_in) + "(" + wd(r.check_in) + ")〜" + md(r.check_out || r.check_in) + "・" + propName(r)); w.type = "button";
        w.onclick = () => {
          S.sub = "res"; S.open = r.id; S.q = ""; $("q").value = "";
          if ((r.check_out || r.check_in) < today) { S.past = true; $("past").checked = true; }
          S.limit = 100000; render();
          const c = document.getElementById("res-" + r.id); if (c) c.scrollIntoView({ block: "center" });
        };
        col.append(tx, w); box.append(cb, col); sec.append(box);
      });
      out.push(sec);
    });
    v.replaceChildren(...out);
  }
})();
