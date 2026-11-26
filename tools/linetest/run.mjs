import * as H from './harness.mjs';
const { DB, LINE, C1, C2 } = H;
const show = (label) => { const m = H.lastLine(); console.log(label, '→', m.path, m.body.to ?? '(reply)', '|', m.body.messages.map(H.textOf).join(' // ').slice(0, 300)); };
const asg = (r, c) => DB.cleaning_assignments.find((a) => a.reservation_id === r && a.cleaner_id === c);
let fails = 0; const check = (cond, msg) => { if (!cond) { fails++; console.log('  FAIL:', msg); } };

// 1. bad signature / wrong dispatch key
console.log('bad signature:', await H.hook([], 'nope'));
console.log('wrong key:', (await H.send(new Request('https://x', { method: 'POST', headers: { 'x-dispatch-key': 'bad' } }))).status);

// 2. request to a linked Thai cleaner, to an unlinked cleaner, owner note, remind after reply (stale)
DB.cleaning_messages.push(
  { id: 101, audience: 'cleaner', cleaner_id: C1, reservation_id: 1, kind: 'request', body: 'x', delivered_at: null },
  { id: 102, audience: 'cleaner', cleaner_id: C2, reservation_id: 2, kind: 'request', body: 'x', delivered_at: null },
  { id: 103, audience: 'owner', cleaner_id: null, reservation_id: null, kind: 'info', body: 'テスト通知', delivered_at: null },
);
console.log('dispatch:', await H.dispatch());
console.log(' statuses:', DB.cleaning_messages.map((m) => m.id + ':' + m.send_status).join(' '));
check(DB.cleaning_messages.find((m) => m.id === 102).send_status === 'no_line', 'unlinked cleaner should be no_line');
const req = LINE.find((l) => l.body.to === 'U_anan');
console.log(' request(th):', H.textOf(req.body.messages[0]));
const owner = LINE.find((l) => l.path === 'multicast');
check(owner && owner.body.to.length === 2, 'owner multicast to 2');

// 3. OK -> time choices -> pick 10:30
await H.postback('U_anan', 'a=ok&r=1&c=' + C1);
const qr = H.lastLine().body.messages[0];
console.log(' time choices:', qr.quickReply.items.map((i) => i.action.label).join(','));
check(qr.quickReply.items.length === 7 && qr.quickReply.items[6].action.label === '13:00', '7 choices 10:00..13:00 (check-in 16:00 minus 3 hours of cleaning)');
await H.postback('U_anan', 'a=ok&r=1&c=' + C1 + '&t=10:30');
show(' ok reply');
check(asg(1, C1).status === 'ok' && asg(1, C1).plan_time === '10:30', 'saved ok 10:30');
const ownerOk = LINE.filter((l) => l.path === 'multicast').pop();
console.log(' owner got:', ownerOk.body.messages[0].text);
// remind after answering -> stale
DB.cleaning_messages.push({ id: 104, audience: 'cleaner', cleaner_id: C1, reservation_id: 1, kind: 'remind', body: 'x', delivered_at: null });
await H.dispatch(); check(DB.cleaning_messages.find((m) => m.id === 104).send_status === 'stale', 'remind after reply is stale');

// 4. forged postback: another LINE user presses Anan's button
await H.postback('U_owner1', 'a=cant&r=1&c=' + C1); show(' forged');
check(asg(1, C1).status === 'ok', 'forged press must not change');
// bad time
await H.postback('U_anan', 'a=ok&r=1&c=' + C1 + '&t=03:00'); check(asg(1, C1).plan_time === '10:30', 'bad time ignored');

// 5. start too early (not today) / start today / start again / done / done again
await H.postback('U_anan', 'a=start&r=1&c=' + C1); show(' start early'); check(asg(1, C1).status === 'ok', 'not started early');
DB.cleaning_messages.push({ id: 105, audience: 'cleaner', cleaner_id: C1, reservation_id: 3, kind: 'today', body: 'x', delivered_at: null });
await H.dispatch(); show(' today msg');
await H.postback('U_anan', 'a=start&r=3&c=' + C1); show(' start'); check(asg(3, C1).status === 'work', 'started');
console.log(' owner got:', LINE.filter((l) => l.path === 'multicast').pop().body.messages[0].text);
await H.postback('U_anan', 'a=start&r=3&c=' + C1); show(' start again');
await H.postback('U_anan', 'a=done&r=3&c=' + C1); show(' done'); check(asg(3, C1).status === 'done', 'done');
console.log(' owner got:', LINE.filter((l) => l.path === 'multicast').pop().body.messages[0].text);
await H.postback('U_anan', 'a=done&r=3&c=' + C1); show(' done again');

// 5b. OK on the cleaning day itself -> reply carries the start button
DB.cleaning_assignments.push({ reservation_id: 3, cleaner_id: C2, job_date: H.today, status: 'wait', plan_time: null, start_time: null });
DB.cleaners[1].line_user_id = 'U_sato';
await H.postback('U_sato', 'a=ok&r=3&c=' + C2 + '&t=11:00');
const sameDay = LINE.filter((l) => l.path === 'reply').pop();
console.log(' same-day ok reply:', sameDay.body.messages.map(H.textOf).join(' // '));
check(sameDay.body.messages.length === 2 && JSON.stringify(sameDay.body.messages[1]).includes('a=start'), 'same-day OK has start button');
DB.cleaners[1].line_user_id = null;

// 6. can't go
DB.cleaning_assignments.push({ reservation_id: 4, cleaner_id: C1, job_date: H.plus(2), status: 'wait', plan_time: null, start_time: null });
await H.postback('U_anan', 'a=cant&r=4&c=' + C1); show(' cant'); check(asg(4, C1).status === 'cant', 'cant saved');
console.log(' owner got:', LINE.filter((l) => l.path === 'multicast').pop().body.messages[0].text);

// 7. cancel message for a cancelled reservation (assignment already removed), change message
DB.cleaning_messages.push({ id: 106, audience: 'cleaner', cleaner_id: C1, reservation_id: 5, kind: 'cancel', body: '11/30 Laughter の清掃依頼は取り消し', delivered_at: null });
await H.dispatch(); show(' cancel');
asg(1, C1).status = 'wait';
DB.cleaning_messages.push({ id: 107, audience: 'cleaner', cleaner_id: C1, reservation_id: 1, kind: 'change', body: 'x', delivered_at: null });
await H.dispatch(); show(' change');

// 8. linking: code for cleaner 佐藤 from a LINE that is also an owner
await H.hook([{ type: 'message', replyToken: 'rt', source: { type: 'user', userId: 'U_owner1' }, message: { type: 'text', text: '１２３ ４５６' } }]);
show(' link'); check(DB.cleaners[1].line_user_id === 'U_owner1' && DB.owner_line[0].line_user_id === 'U_owner1', 'owner+cleaner both linked');
// a normal chat message gets no reply
const n = LINE.length;
await H.hook([{ type: 'message', replyToken: 'rt', source: { type: 'user', userId: 'U_anan' }, message: { type: 'text', text: 'こんにちは' } }]);
check(LINE.length === n, 'no reply to chat');

// 9. all 5 languages render (request bubble)
for (const lang of ['ja', 'en', 'ne', 'vi']) {
  DB.cleaners[0].lang = lang; asg(1, C1).status = 'wait';
  DB.cleaning_messages.push({ id: 200 + LINE.length, audience: 'cleaner', cleaner_id: C1, reservation_id: 1, kind: 'request', body: 'x', delivered_at: null });
  await H.dispatch(); show(' request(' + lang + ')');
}

// 10. 18:00 the day before: "tomorrow" with a can't-go button (only for accepted jobs)
DB.cleaners[0].lang = 'ja'; asg(1, C1).status = 'ok'; asg(1, C1).plan_time = '10:30';
DB.cleaning_messages.push({ id: 400, audience: 'cleaner', cleaner_id: C1, reservation_id: 1, kind: 'tomorrow', body: 'x', delivered_at: null });
await H.dispatch(); show(' tomorrow');
check(!JSON.stringify(H.lastLine().body).includes('a=cant'), 'tomorrow has no cant button');
asg(1, C1).status = 'wait';
DB.cleaning_messages.push({ id: 401, audience: 'cleaner', cleaner_id: C1, reservation_id: 1, kind: 'tomorrow', body: 'x', delivered_at: null });
await H.dispatch(); check(DB.cleaning_messages.find((m) => m.id === 401).send_status === 'stale', 'tomorrow not sent when not accepted');

// 11. a cleaner blocks the account: owners are told
await H.hook([{ type: 'unfollow', source: { type: 'user', userId: 'U_anan' } }]);
const ul = DB.cleaning_messages.filter((m) => m.kind === 'unlinked'); console.log(' unlinked:', ul.map((m) => m.body).join());
check(ul.length === 1 && DB.cleaners[0].line_user_id === null, 'unfollow tells owners and unlinks');
console.log(fails ? fails + ' FAILED' : 'ALL CHECKS PASSED');
