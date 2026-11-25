import * as H from './harness.mjs';
const { DB, LINE, C1, C2 } = H;
let fails = 0; const check = (c, m) => { if (!c) { fails++; console.log('  FAIL:', m); } };
const asg = (r, c) => DB.cleaning_assignments.find((a) => a.reservation_id === r && a.cleaner_id === c);
const T = 'idtok:U_anan';

console.log('no token:', (await H.api('', { action: 'load' })).status);
console.log('bad token:', (await H.api('junk', { action: 'load' })).status);
console.log('not linked:', (await H.api('idtok:U_nobody', { action: 'load' })).status);

// make a second cleaner share job 1 so co-worker + half pay are visible
DB.cleaning_assignments.push({ reservation_id: 1, cleaner_id: C2, job_date: H.plus(3), status: 'ok', plan_time: '10:00', start_time: null, fee_override: 9999, fee_note: 'secret' });
const L = (await H.api(T, { action: 'load' })).body.data;
console.log('me:', L.me.name, '| props:', L.props.map((p) => p.name + (p.members.length ? '*' : '')).join(','), '| jobs:', L.jobs.map((j) => j.date + ' ' + j.prop + ' ' + j.asg.map((a) => a.c.slice(0, 2) + ':' + a.st).join('/')).join(' ; '));
const j1 = L.jobs.find((j) => j.id === 1);
check(j1.asg.length === 2 && j1.asg[1].fee === undefined && j1.asg[1].st === 'other', 'co-worker visible without their fee');
check(L.cleaners.some((c) => c.name === '佐藤'), 'co-worker name for "with"');
check(!JSON.stringify(L).includes('secret') && !JSON.stringify(L).includes('9999'), 'no other cleaner fee leaks');
console.log('guide:', JSON.stringify(L.guide).slice(0, 160));
console.log('expenses:', L.expenses.map((e) => e.status + ' ' + e.photo.slice(0, 40)).join(' | '));
console.log('next guest of job1:', j1.nextIn, j1.guests);

// actions
let r = await H.api(T, { action: 'ok', r: 1, t: '10:30' }); console.log('ok:', JSON.stringify(r.body)); check(asg(1, C1).status === 'ok' && asg(1, C1).plan_time === '10:30', 'ok saved');
console.log(' owner got:', LINE.filter((l) => l.path === 'multicast').pop().body.messages[0].text);
r = await H.api(T, { action: 'ok', r: 1, t: '05:00' }); check(r.body.code === 'badTime', 'bad time');
r = await H.api(T, { action: 'start', r: 1 }); check(r.body.code === 'onlyToday', 'start not today');
r = await H.api(T, { action: 'start', r: 3 }); check(r.body.ok && asg(3, C1).status === 'work', 'start today');
r = await H.api(T, { action: 'done', r: 3 }); check(r.body.ok && asg(3, C1).status === 'done', 'done');
r = await H.api(T, { action: 'cant', r: 2 }); check(r.body.code === 'gone', 'cannot act on someone else\'s job');
r = await H.api(T, { action: 'confirm', month: H.today.slice(0, 7) }); check(r.body.code === 'notYet', 'this month not confirmable');
const last = (() => { const d = new Date(H.today + 'T00:00:00Z'); d.setUTCDate(0); return d.toISOString().slice(0, 7); })();
r = await H.api(T, { action: 'confirm', month: last }); check(r.body.ok && DB.pay_confirms.length === 1, 'confirm last month');
await H.api(T, { action: 'confirm', month: last }); check(DB.pay_confirms.length === 1, 'confirm once');
// expenses
r = await H.api(T, { action: 'upload_url' }); console.log('upload:', r.body.path, r.body.url.slice(0, 60)); check(r.body.path.startsWith('receipts/' + C1 + '/'), 'own folder');
r = await H.api(T, { action: 'expense', date: H.today, amount: 1200, item: 'タオル', prop_id: 1, photo_path: 'receipts/' + C2 + '/x.jpg' }); check(r.body.code === 'bad', 'cannot use another cleaner\'s photo');
r = await H.api(T, { action: 'expense', date: H.today, amount: 1200, item: 'タオル', prop_id: 1, photo_path: 'receipts/' + C1 + '/new.jpg' }); check(r.body.ok && DB.cleaning_expenses.length === 2, 'new expense');
r = await H.api(T, { action: 'expense', id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', date: H.today, amount: 600, item: '洗剤', prop_id: 1, photo_path: 'receipts/' + C1 + '/x2.jpg' });
check(r.body.ok && DB.cleaning_expenses[0].status === 'pending' && DB.cleaning_expenses[0].amount === 600, 'resubmit returned');
r = await H.api(T, { action: 'expense', date: H.today, amount: -5, prop_id: 1, photo_path: 'receipts/' + C1 + '/n.jpg' }); check(r.body.code === 'bad', 'negative amount');
console.log('log:', DB.cleaning_log.map((l) => l.body).join(' / '));
console.log(fails ? fails + ' FAILED' : 'ALL STAFF CHECKS PASSED');
