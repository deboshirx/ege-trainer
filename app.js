/* Тренажёр ЕГЭ — логика мини-аппа.
   Данные предметов лежат в subjects/*.js и регистрируются через window.SUBJECTS.push({...}).

   Формат предмета:
   { id, name, short, order,
     parts:  [{name, nums:[...]}],
     topics: [{name, nums:[...]}],
     data:   [{ n, kind:'short'|'long', topic, pts, fmt, mode, how:[...], tip,
                tasks:[{ q, a (строка или массив вариантов), mode, s:[шаги решения], ans (для 'long') }] }] }

   mode: 'set' — ответ из цифр, порядок не важен; иначе — точное совпадение
   (без учёта регистра, пробелов, ё/е, запятой/точки). */

const SUBJ = window.SUBJECTS.slice().sort((a, b) => a.order - b.order);
const tg = window.Telegram && window.Telegram.WebApp;
const inTG = !!(tg && tg.platform && tg.platform !== 'unknown');
if (tg) { try { tg.ready(); tg.expand(); } catch (e) {} }
if (inTG && tg.colorScheme === 'dark') document.documentElement.classList.add('dark');

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
/* миграция прогресса из первой версии (только профильная математика) */
(function migrate() {
  const old = store.get('ege_solved', null);
  if (old && !store.get('ege_solved_v2', null)) {
    const nw = {}; Object.keys(old).forEach(k => nw['math-profile:' + k] = 1);
    store.set('ege_solved_v2', nw);
  }
})();
let solved = store.get('ege_solved_v2', {});
const K = (sid, n, i) => sid + ':' + n + '-' + i;
const markSolved = (sid, n, i) => { solved[K(sid, n, i)] = 1; store.set('ege_solved_v2', solved); };
const countTasks = s => s.data.reduce((a, t) => a + t.tasks.length, 0);
const countSolved = s => s.data.reduce((a, t) => a + t.tasks.filter((_, i) => solved[K(s.id, t.n, i)]).length, 0);

let subject = null;
const byN = n => subject.data.find(t => t.n === n);
const state = { tab: 'nums', nums: new Set(), topics: new Set(), shuffle: false, skipSolved: false, queue: [], pos: 0, results: [] };

const app = document.getElementById('app');
let backHandler = null;
function setBack(fn) {
  backHandler = fn;
  if (tg && tg.BackButton) { try { fn ? tg.BackButton.show() : tg.BackButton.hide(); } catch (e) {} }
}
if (tg && tg.BackButton) { try { tg.BackButton.onClick(() => backHandler && backHandler()); } catch (e) {} }
const haptic = t => { try { tg && tg.HapticFeedback && (t === 'sel' ? tg.HapticFeedback.selectionChanged() : tg.HapticFeedback.notificationOccurred(t)); } catch (e) {} };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = {
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/></svg>',
  close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chev: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  down: '<svg class="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
  chat: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  dumbbell: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5l11 11"/><path d="M21 21l-1-1"/><path d="M3 3l1 1"/><path d="M18 22l4-4"/><path d="M2 6l4-4"/><path d="M3 10l7-7"/><path d="M14 21l7-7"/></svg>'
};
function header(title, left) {
  return `<div class="hdr">${left ? `<button class="round" id="hback" aria-label="Назад">${left}</button>` : '<div class="spacer"></div>'}<h1>${esc(title)}</h1><div class="spacer"></div></div>`;
}
function bindBack(fn) { const b = document.getElementById('hback'); if (b) { b.onclick = fn; if (inTG) b.style.visibility = 'hidden'; } setBack(fn); }
function plural(n, a, b, c) { const m10 = n % 10, m100 = n % 100; return (m10 === 1 && m100 !== 11) ? a : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) ? b : c; }

/* ---------- Выбранные предметы (локально + облако Telegram) ---------- */
const MY_KEY = 'ege_my_subjects';
let mySubjects = store.get(MY_KEY, null);
const cloud = (inTG && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9')) ? tg.CloudStorage : null;
function saveMySubjects(ids) {
  mySubjects = ids;
  store.set(MY_KEY, ids);
  if (cloud) { try { cloud.setItem(MY_KEY, JSON.stringify(ids)); } catch (e) {} }
}
function loadFromCloud(done) {
  if (!cloud) return done();
  let finished = false;
  const finish = () => { if (!finished) { finished = true; done(); } };
  setTimeout(finish, 1500);
  try {
    cloud.getItem(MY_KEY, (err, val) => {
      if (!err && val) { try { const ids = JSON.parse(val); if (Array.isArray(ids) && ids.length) { mySubjects = ids; store.set(MY_KEY, ids); } } catch (e) {} }
      finish();
    });
  } catch (e) { finish(); }
}
const visibleSubjects = () => {
  const list = SUBJ.filter(s => mySubjects && mySubjects.includes(s.id));
  return list.length ? list : SUBJ;
};

/* ---------- Выбор предметов ---------- */
function renderPicker(isEdit) {
  const chosen = new Set(mySubjects || []);
  const cb = on => `<span class="cb ${on ? 'on' : ''}">${ICON.check}</span>`;
  const draw = () => {
    app.innerHTML = `<div class="screen">
      ${isEdit ? header('Мои предметы', ICON.back) : ''}
      <div class="pick-head">
        <div class="t">Какие предметы ты сдаёшь?</div>
        <div class="s">Выбери все, к которым готовишься. Изменить список можно в любой момент.</div>
      </div>
      <div class="box" style="margin-top:0">
        ${SUBJ.map(s => `<button class="opt" data-id="${s.id}"><span class="ic-sm">${esc(s.short)}</span><span class="lb">${esc(s.name)}</span>${cb(chosen.has(s.id))}</button>`).join('')}
      </div>
    </div>
    <div class="bottom"><div class="in">
      <div class="count">${chosen.size ? 'Выбрано: ' + chosen.size : 'Выбери хотя бы один предмет'}</div>
      <button class="main" id="go" ${chosen.size ? '' : 'disabled'}>${isEdit ? 'Сохранить' : 'Продолжить'}</button>
    </div></div>`;
    if (isEdit) bindBack(renderHome); else setBack(null);
    app.querySelectorAll('.opt[data-id]').forEach(b => b.onclick = () => {
      const id = b.dataset.id; chosen.has(id) ? chosen.delete(id) : chosen.add(id); haptic('sel'); draw();
    });
    document.getElementById('go').onclick = () => {
      if (!chosen.size) return;
      saveMySubjects(SUBJ.filter(s => chosen.has(s.id)).map(s => s.id));
      haptic('success'); renderHome();
    };
  };
  draw();
  scrollTo(0, 0);
}

/* ---------- Главная ---------- */
function renderHome() {
  const list = visibleSubjects();
  const total = list.reduce((a, s) => a + countTasks(s), 0);
  const done = list.reduce((a, s) => a + countSolved(s), 0);
  const pct = total ? Math.round(done / total * 100) : 0;
  app.innerHTML = `<div class="screen">
    <div class="hero">
      <div class="t">Тренажёр ЕГЭ</div>
      <div class="s">Задания в формате экзамена с подробными решениями</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="meta"><span>Решено ${done} из ${total}</span><span>${pct}%</span></div>
    </div>
    <div class="panel-top home-top"><h2>Мои предметы</h2><button class="link" id="edit">Изменить</button></div>
    <div class="tiles">
      ${list.map(s => {
        const t = countTasks(s), d = countSolved(s), p = t ? Math.round(d / t * 100) : 0;
        return `<button class="tile" data-id="${s.id}">
          <span class="ic">${esc(s.short)}</span>
          <span class="tn">${esc(s.name)}</span>
          <span class="tm">${s.data.length} ${plural(s.data.length, 'номер', 'номера', 'номеров')}</span>
          <span class="tb"><i style="width:${p}%"></i></span>
          <span class="tp">${p ? p + '% решено' : 'Начать'}</span>
        </button>`;
      }).join('')}
    </div>
    <button class="cur-card" id="homeCur">
      <span class="ava">${ICON.chat}</span>
      <span class="info"><b>Не понял тему?</b><small>Разбери её с куратором — он объяснит и ответит на вопросы</small></span>
      ${ICON.chev}
    </button>
  </div>`;
  setBack(null);
  app.querySelectorAll('.tile').forEach(b => b.onclick = () => { haptic('sel'); openSubject(b.dataset.id); });
  document.getElementById('homeCur').onclick = () => { haptic('sel'); openCuratorsDirect(); };
  document.getElementById('edit').onclick = () => { haptic('sel'); renderPicker(true); };
  scrollTo(0, 0);
}

function openSubject(id) {
  if (!subject || subject.id !== id) {
    subject = SUBJ.find(s => s.id === id);
    state.tab = 'nums'; state.nums = new Set(); state.topics = new Set();
  }
  renderSubject();
}

/* ---------- Предмет: номера / темы ---------- */
function selectedNums() {
  if (state.tab === 'nums') return [...state.nums].sort((a, b) => a - b);
  const s = new Set(); state.topics.forEach(i => subject.topics[i].nums.forEach(n => s.add(n)));
  return [...s].sort((a, b) => a - b);
}
function buildQueue() {
  let q = [];
  selectedNums().forEach(n => { const t = byN(n); if (t) t.tasks.forEach((_, i) => { if (!(state.skipSolved && solved[K(subject.id, n, i)])) q.push({ n, i }); }); });
  if (state.shuffle) for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
  return q;
}

function renderSubject() {
  const chip = n => {
    const t = byN(n); const all = t && t.tasks.every((_, i) => solved[K(subject.id, n, i)]);
    return `<button class="chip ${state.nums.has(n) ? 'on' : ''}" data-n="${n}" aria-pressed="${state.nums.has(n)}">${n}${all ? '<span class="d"></span>' : ''}</button>`;
  };
  const cb = on => `<span class="cb ${on ? 'on' : ''}">${ICON.check}</span>`;
  const body = state.tab === 'nums'
    ? subject.parts.map((p, pi) => `
      <div class="sec"><b>${esc(p.name)}</b><button class="link" data-all="${pi}">${p.nums.every(n => state.nums.has(n)) ? 'Снять все' : 'Выбрать все'}</button></div>
      <div class="chips">${p.nums.map(chip).join('')}</div>`).join('')
    : `
      <div class="sec"><b>Темы</b><button class="link" data-alltopics="1">${state.topics.size === subject.topics.length ? 'Снять все' : 'Выбрать все'}</button></div>
      <div class="box">${subject.topics.map((t, i) => `
        <button class="opt" data-topic="${i}">${cb(state.topics.has(i))}<span class="lb">${i + 1}. ${esc(t.name)}<small>Номера: ${t.nums.join(', ')}</small></span></button>`).join('')}
      </div>`;
  const q = buildQueue();
  app.innerHTML = `<div class="screen">
    ${header(subject.name, ICON.back)}
    <div class="tabs"><button class="tab ${state.tab === 'nums' ? 'on' : ''}" data-tab="nums">Номера</button><button class="tab ${state.tab === 'topics' ? 'on' : ''}" data-tab="topics">Темы</button></div>
    ${body}
    <div class="box">
      <button class="opt" id="optShuffle"><span class="lb">Перемешать задания</span>${cb(state.shuffle)}</button>
      <button class="opt" id="optSkip"><span class="lb">Не включать задачи, которые уже решались</span>${cb(state.skipSolved)}</button>
    </div>
  </div>
  <div class="bottom"><div class="in">
    <div class="count">${selectedNums().length ? (q.length ? q.length + ' ' + plural(q.length, 'задание', 'задания', 'заданий') + ' в тренировке' : 'Все выбранные задания уже решены') : 'Выбери номера или темы'}</div>
    <button class="main" id="start" ${q.length ? '' : 'disabled'}>Начать тренировку</button>
  </div></div>`;
  bindBack(renderHome);
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; haptic('sel'); renderSubject(); });
  app.querySelectorAll('.chip').forEach(b => b.onclick = () => { const n = +b.dataset.n; state.nums.has(n) ? state.nums.delete(n) : state.nums.add(n); haptic('sel'); renderSubject(); });
  app.querySelectorAll('[data-all]').forEach(b => b.onclick = () => {
    const list = subject.parts[+b.dataset.all].nums; const all = list.every(n => state.nums.has(n));
    list.forEach(n => all ? state.nums.delete(n) : state.nums.add(n)); haptic('sel'); renderSubject();
  });
  app.querySelectorAll('[data-topic]').forEach(b => b.onclick = () => { const i = +b.dataset.topic; state.topics.has(i) ? state.topics.delete(i) : state.topics.add(i); haptic('sel'); renderSubject(); });
  const at = app.querySelector('[data-alltopics]'); if (at) at.onclick = () => { if (state.topics.size === subject.topics.length) state.topics.clear(); else subject.topics.forEach((_, i) => state.topics.add(i)); haptic('sel'); renderSubject(); };
  document.getElementById('optShuffle').onclick = () => { state.shuffle = !state.shuffle; haptic('sel'); renderSubject(); };
  document.getElementById('optSkip').onclick = () => { state.skipSolved = !state.skipSolved; haptic('sel'); renderSubject(); };
  document.getElementById('start').onclick = () => {
    state.queue = buildQueue(); state.pos = 0; state.results = [];
    if (state.queue.length) { haptic('sel'); renderTask(); }
  };
  scrollTo(0, 0);
}

/* ---------- Проверка ответа ---------- */
function norm(s) {
  return String(s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, '').replace(/,/g, '.').replace(/[−–—]/g, '-').replace(/[«»"']/g, '');
}
function isRight(user, task, num) {
  const mode = task.mode || num.mode;
  const variants = Array.isArray(task.a) ? task.a : [task.a];
  const u = norm(user);
  return variants.some(v => {
    const r = norm(v);
    if (mode === 'set') return u.split('').sort().join('') === r.split('').sort().join('');
    if (u === r) return true;
    const numRe = /^-?\d*\.?\d+$/;
    return numRe.test(u) && numRe.test(r) && Math.abs(parseFloat(u) - parseFloat(r)) < 1e-9;
  });
}
const firstAnswer = t => Array.isArray(t.a) ? t.a[0] : t.a;

/* ---------- Тренировка ---------- */
function acc(id, title, inner, open) {
  return `<div class="acc ${open ? 'open' : ''}" id="${id}"><button aria-expanded="${!!open}">${title}${ICON.down}</button><div class="body ${open ? '' : 'hidden'}">${inner}</div></div>`;
}
function renderTask() {
  const { n, i } = state.queue[state.pos];
  const t = byN(n), x = t.tasks[i], short = t.kind !== 'long';
  const total = state.queue.length, cur = state.pos + 1;
  const howHtml = `<ul>${t.how.map(h => `<li>${esc(h)}</li>`).join('')}</ul>${t.tip ? `<div class="tip">💡 ${esc(t.tip)}</div>` : ''}`;
  const solHtml = `<ol>${x.s.map(s => `<li>${esc(s)}</li>`).join('')}</ol><div class="final${short ? '' : ' long'}">${short ? 'Ответ: ' + esc(firstAnswer(x)) : esc(x.ans)}</div>`;
  const fmt = x.fmt || t.fmt;
  let lastAnswer = '';
  app.innerHTML = `<div class="screen">
    ${header(subject.name + ' · ' + cur + '/' + total, ICON.close)}
    <div class="prog"><div class="bar"><i style="width:${(cur - 1) / total * 100}%"></i></div><span>${cur}/${total}</span></div>
    <div class="card">
      <span class="badge">№${n} · ${esc(t.topic)}</span>
      <div class="q">${esc(x.q)}</div>
      ${short ? `${fmt ? `<div class="fmt">${esc(fmt)}</div>` : ''}<div class="ansrow"><input id="inp" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Введите ответ"><button class="btn2" id="check">Проверить</button></div><div id="fb"></div><button class="cur-btn hidden" id="curBtn">${ICON.chat} Разобрать с куратором</button>` : `<div class="fmt">Задание с развёрнутым ответом: напиши ответ на листе или в заметках, потом сверься с образцом.</div><button class="cur-btn" id="curBtn">${ICON.chat} Отправить ответ куратору на проверку</button>`}
    </div>
    ${acc('how', (short ? 'Как решать №' : 'Как выполнять №') + n, howHtml, false)}
    ${acc('sol', short ? 'Решение' : 'Образец ответа и критерии', solHtml, false)}
  </div>
  <div class="bottom"><div class="in"><div class="count"></div>
    <button class="main" id="next">${cur < total ? 'Дальше' : 'Завершить'}</button>
  </div></div>`;
  bindBack(() => renderSubject());
  ['how', 'sol'].forEach(id => {
    const el = document.getElementById(id);
    el.querySelector('button').onclick = () => {
      const open = el.classList.toggle('open');
      el.querySelector('.body').classList.toggle('hidden', !open);
      el.querySelector('button').setAttribute('aria-expanded', open);
      if (id === 'sol' && open && state.results[state.pos] === undefined) state.results[state.pos] = short ? 'skip' : 'seen';
      if (id === 'sol' && open && !short) markSolved(subject.id, n, i);
    };
  });
  if (short) {
    const inp = document.getElementById('inp'), fb = document.getElementById('fb');
    if (/^[\d\s.,−-]*$/.test(String(firstAnswer(x)))) inp.setAttribute('inputmode', 'decimal');
    const check = () => {
      if (!inp.value.trim()) { inp.focus(); return; }
      if (isRight(inp.value, x, t)) {
        inp.className = 'ok'; fb.className = 'fb ok'; fb.textContent = 'Верно! Отличная работа';
        if (state.results[state.pos] !== 'bad') state.results[state.pos] = 'ok';
        markSolved(subject.id, n, i); haptic('success');
      } else {
        inp.className = 'bad'; fb.className = 'fb bad'; fb.textContent = 'Неверно. Попробуй ещё раз или открой решение';
        state.results[state.pos] = 'bad'; haptic('error');
        lastAnswer = inp.value.trim();
        const cb = document.getElementById('curBtn'); if (cb) cb.classList.remove('hidden');
      }
    };
    document.getElementById('check').onclick = check;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
  }
  if (!curatorsFor(subject.id).length) document.getElementById('curBtn').remove();
  else document.getElementById('curBtn').onclick = () => { haptic('sel'); openCurators({ n, i, t, x, short, answer: lastAnswer }); };
  document.getElementById('next').onclick = () => {
    if (state.results[state.pos] === undefined) state.results[state.pos] = short ? 'skip' : 'seen';
    if (state.pos < total - 1) { state.pos++; renderTask(); } else renderResults();
  };
  scrollTo(0, 0);
}

/* ---------- Кураторы ---------- */
const CUR_KEY = 'ege_curator';
function curatorsFor(sid) {
  const all = window.CURATORS || [];
  return all.filter(c => c.subjects.includes('all') || c.subjects.includes(sid));
}
function buildMessage(ctx) {
  const max = 700;
  const q = ctx.x.q.length > max ? ctx.x.q.slice(0, max) + '…' : ctx.x.q;
  const lines = [
    'Здравствуйте! Помогите, пожалуйста, разобраться с заданием из тренажёра ЕГЭ.',
    'Предмет: ' + subject.name + ', задание №' + ctx.n + ' (вариант ' + (ctx.i + 1) + ')',
    '',
    q,
    ''
  ];
  if (ctx.short) lines.push('Мой ответ: ' + (ctx.answer || '—'));
  else lines.push('Мой ответ: (вставлю ниже)');
  return lines.join('\n');
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch (e) { return false; }
}
function openTelegram(username) {
  const url = 'https://t.me/' + username;
  if (inTG && tg.openTelegramLink) { try { tg.openTelegramLink(url); return; } catch (e) {} }
  window.open(url, '_blank');
}
function toast(text) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = text;
  document.body.appendChild(el); setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
}
function openCurators(ctx) {
  const list = curatorsFor(subject.id);
  const saved = store.get(CUR_KEY, {});
  const prev = saved[subject.id];
  const sheet = document.createElement('div');
  sheet.className = 'sheet-wrap';
  sheet.innerHTML = `<div class="sheet" role="dialog" aria-label="Выбор куратора">
    <div class="sheet-grip"></div>
    <div class="sheet-t">Выбери куратора</div>
    <div class="sheet-s">Куратор разберёт ошибку, объяснит решение и задаст вопросы, чтобы закрепить тему. Текст задания скопируется автоматически — просто вставь его в чат.</div>
    ${list.length ? list.map((c, k) => `
      <button class="cur ${c.username === prev ? 'on' : ''}" data-k="${k}">
        <span class="ava">${esc(c.name.trim().charAt(0).toUpperCase())}</span>
        <span class="info"><b>${esc(c.name)}</b>${c.about ? `<small>${esc(c.about)}</small>` : ''}</span>
        ${c.username === prev ? '<span class="tag">Твой куратор</span>' : ICON.chev}
      </button>`).join('') : '<div class="sheet-s">По этому предмету пока нет кураторов.</div>'}
    <button class="sheet-close" id="sheetClose">Отмена</button>
  </div>`;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('show'));
  const close = () => { sheet.classList.remove('show'); setTimeout(() => sheet.remove(), 250); };
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  sheet.querySelector('#sheetClose').onclick = close;
  sheet.querySelectorAll('.cur').forEach(b => b.onclick = async () => {
    const c = list[+b.dataset.k];
    saved[subject.id] = c.username; store.set(CUR_KEY, saved);
    const ok = await copyText(buildMessage(ctx));
    haptic('success');
    close();
    toast(ok ? 'Текст задания скопирован — вставь его в чат с куратором' : 'Открываю чат с куратором');
    setTimeout(() => openTelegram(c.username), 400);
  });
}

/* Кураторы с главной: просто открыть чат, без текста задания */
function openCuratorsDirect() {
  const ids = visibleSubjects().map(s => s.id);
  const names = id => (SUBJ.find(s => s.id === id) || {}).name || id;
  const list = (window.CURATORS || []).filter(c => c.subjects.includes('all') || c.subjects.some(id => ids.includes(id)));
  const sheet = document.createElement('div');
  sheet.className = 'sheet-wrap';
  sheet.innerHTML = `<div class="sheet" role="dialog" aria-label="Кураторы">
    <div class="sheet-grip"></div>
    <div class="sheet-t">Разобрать тему с куратором</div>
    <div class="sheet-s">Выбери куратора по предмету — откроется чат с ним в Telegram. Напиши, какую тему хочешь разобрать.</div>
    ${list.length ? list.map((c, k) => `
      <button class="cur" data-k="${k}">
        <span class="ava">${esc(c.name.trim().charAt(0).toUpperCase())}</span>
        <span class="info"><b>${esc(c.name)}</b><small>${c.subjects.includes('all') ? 'Все предметы' : esc(c.subjects.map(names).join(', '))}</small></span>
        ${ICON.chev}
      </button>`).join('') : '<div class="sheet-s">По твоим предметам пока нет кураторов.</div>'}
    <button class="sheet-close" id="sheetClose">Отмена</button>
  </div>`;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('show'));
  const close = () => { sheet.classList.remove('show'); setTimeout(() => sheet.remove(), 250); };
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  sheet.querySelector('#sheetClose').onclick = close;
  sheet.querySelectorAll('.cur').forEach(b => b.onclick = () => {
    const c = list[+b.dataset.k];
    haptic('success'); close();
    setTimeout(() => openTelegram(c.username), 250);
  });
}

/* ---------- Итоги ---------- */
function renderResults() {
  const items = state.queue.map((q, k) => ({ ...q, r: state.results[k] }));
  const shortItems = items.filter(x => byN(x.n).kind !== 'long');
  const ok = shortItems.filter(x => x.r === 'ok').length;
  const pct = shortItems.length ? Math.round(ok / shortItems.length * 100) : 100;
  const label = r => r === 'ok' ? ['ok', '✓', 'Верно'] : r === 'bad' ? ['bad', '✕', 'Ошибка'] : r === 'seen' ? ['sk', '✓', 'Разобрано'] : ['sk', '–', 'Пропущено'];
  app.innerHTML = `<div class="screen">
    ${header('Итоги тренировки', ICON.close)}
    <div class="card res">
      <div class="big">${shortItems.length ? ok + '/' + shortItems.length : '✓'}</div>
      <p>${shortItems.length ? 'верных ответов · ' + pct + '%' : 'Все задания разобраны'}</p>
    </div>
    <div class="rlist">${items.map(x => { const [c, s, l] = label(x.r); return `<div class="ritem"><span class="st ${c}">${s}</span><span style="flex:1">№${x.n} · вариант ${x.i + 1}</span><span style="color:var(--hint);font-size:13px">${l}</span></div>`; }).join('')}</div>
  </div>
  <div class="bottom"><div class="in"><div class="count"></div><button class="main" id="again">Ещё тренировка</button></div></div>`;
  bindBack(renderSubject);
  document.getElementById('again').onclick = renderSubject;
  haptic('success');
  scrollTo(0, 0);
}

loadFromCloud(() => { if (mySubjects && mySubjects.length) renderHome(); else renderPicker(false); });
