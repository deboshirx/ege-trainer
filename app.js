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

/* ---------- Тема оформления: auto | light | dark ---------- */
const THEME_KEY = 'ege_theme';
const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme() {
  const mode = store.get(THEME_KEY, 'auto');
  const autoDark = inTG ? tg.colorScheme === 'dark' : !!(mql && mql.matches);
  const dark = mode === 'dark' || (mode === 'auto' && autoDark);
  document.documentElement.classList.toggle('dark', dark);
  if (inTG) {
    const bg = dark ? '#0F1115' : '#EEF2F8';
    try { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); } catch (e) {}
  }
}
applyTheme();
if (inTG) { try { tg.onEvent('themeChanged', applyTheme); } catch (e) {} }
if (mql && mql.addEventListener) mql.addEventListener('change', applyTheme);

/* ---------- Статистика: попытки, ошибки, дни занятий ---------- */
const STATS_KEY = 'ege_stats';
let stats = store.get(STATS_KEY, { attempts: {}, mistakes: {}, days: [] });
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function markDay() { const t = today(); if (!stats.days.includes(t)) { stats.days.push(t); if (stats.days.length > 400) stats.days.shift(); } }
function recordAttempt(sid, n, ok) {
  const a = stats.attempts[sid] || (stats.attempts[sid] = { ok: 0, bad: 0 });
  ok ? a.ok++ : a.bad++;
  if (!ok) { const m = stats.mistakes[sid] || (stats.mistakes[sid] = {}); m[n] = (m[n] || 0) + 1; }
  markDay(); store.set(STATS_KEY, stats);
}
function streak() {
  const set = new Set(stats.days); let d = new Date(), c = 0;
  const key = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  if (!set.has(key(d))) d.setDate(d.getDate() - 1);
  while (set.has(key(d))) { c++; d.setDate(d.getDate() - 1); }
  return c;
}
const K = (sid, n, i) => sid + ':' + n + '-' + i;
const markSolved = (sid, n, i) => { solved[K(sid, n, i)] = 1; store.set('ege_solved_v2', solved); markDay(); store.set(STATS_KEY, stats); };
const countTasks = s => s.data.reduce((a, t) => a + t.tasks.length, 0);
const countSolved = s => s.data.reduce((a, t) => a + t.tasks.filter((_, i) => solved[K(s.id, t.n, i)]).length, 0);

let subject = null;
const byN = n => subject.data.find(t => t.n === n);
const state = { tab: 'nums', nums: new Set(), topics: new Set(), shuffle: false, skipSolved: false, queue: [], pos: 0, results: [], answers: [], title: 'Тренировка' };

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
  cards: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  bm: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>',
  share: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5l7 7-7 7"/><path d="M21 12H11a7 7 0 0 0-7 7"/></svg>',
  alert: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M12 8v5M12 16.5v.5"/></svg>',
  dice: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>',
  bolt: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
  redo: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
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
function renderMainTab() {
  currentTab = 'home';
  const list = visibleSubjects();
  const total = list.reduce((a, s) => a + countTasks(s), 0);
  const done = list.reduce((a, s) => a + countSolved(s), 0);
  const pct = total ? Math.round(done / total * 100) : 0;
  app.innerHTML = `<div class="screen with-tabs">
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
  app.insertAdjacentHTML('beforeend', tabbar('home')); bindTabbar();
  setBack(null);
  app.querySelectorAll('.tile').forEach(b => b.onclick = () => { haptic('sel'); openSubject(b.dataset.id); });
  document.getElementById('homeCur').onclick = () => { haptic('sel'); openCuratorsDirect(); };
  document.getElementById('edit').onclick = () => { haptic('sel'); renderPicker(true); };
  scrollTo(0, 0);
}

/* ---------- Нижние вкладки ---------- */
let currentTab = 'home';
const TABS = [
  { id: 'home', name: 'Главная', icon: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>' },
  { id: 'solve', name: 'Решать', icon: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>' },
  { id: 'progress', name: 'Прогресс', icon: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>' },
  { id: 'settings', name: 'Настройки', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>' }
];
function tabbar(active) {
  return `<nav class="tabbar" aria-label="Разделы"><div class="in">${TABS.map(t => `
    <button class="tb-btn ${t.id === active ? 'on' : ''}" data-tab-id="${t.id}" aria-current="${t.id === active ? 'page' : 'false'}">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${t.icon}</svg>
      <span>${t.name}</span>
    </button>`).join('')}</div></nav>`;
}
function bindTabbar() {
  app.querySelectorAll('.tb-btn').forEach(b => b.onclick = () => {
    if (currentTab === b.dataset.tabId) return;
    currentTab = b.dataset.tabId; haptic('sel'); renderHome();
  });
}
function renderHome() {
  if (currentTab === 'solve') return renderSolveTab();
  if (currentTab === 'progress') return renderProgressTab();
  if (currentTab === 'settings') return renderSettingsTab();
  return renderMainTab();
}

/* ---------- Вкладка «Решать» ---------- */
function renderSolveTab() {
  const list = visibleSubjects();
  app.innerHTML = `<div class="screen with-tabs">
    <div class="page-t">Что решаем сегодня?</div>
    <div class="page-s">Выбери предмет — дальше выберешь номера или темы.</div>
    <div class="box" style="margin-top:0">
      ${list.map(s => {
        const t = countTasks(s), d = countSolved(s), p = t ? Math.round(d / t * 100) : 0;
        return `<button class="opt solve-row" data-id="${s.id}">
          <span class="ic-sm">${esc(s.short)}</span>
          <span class="lb">${esc(s.name)}<small>${d} из ${t} ${plural(t, 'задания', 'заданий', 'заданий')} решено · ${p}%</small></span>
          ${ICON.chev}
        </button>`;
      }).join('')}
    </div>
  </div>` + tabbar('solve');
  bindTabbar(); setBack(null);
  app.querySelectorAll('.solve-row').forEach(b => b.onclick = () => { haptic('sel'); openSubject(b.dataset.id); });
  scrollTo(0, 0);
}

/* ---------- Вкладка «Прогресс» ---------- */
function renderProgressTab() {
  const list = visibleSubjects();
  const total = list.reduce((a, s) => a + countTasks(s), 0);
  const done = list.reduce((a, s) => a + countSolved(s), 0);
  let ok = 0, bad = 0;
  list.forEach(s => { const a = stats.attempts[s.id]; if (a) { ok += a.ok; bad += a.bad; } });
  const acc = ok + bad ? Math.round(ok / (ok + bad) * 100) : 0;
  const weak = [];
  list.forEach(s => {
    const m = stats.mistakes[s.id] || {};
    Object.keys(m).forEach(n => {
      const t = s.data.find(x => x.n === +n);
      if (t && !t.tasks.every((_, i) => solved[K(s.id, t.n, i)])) weak.push({ s, t, c: m[n] });
    });
  });
  weak.sort((a, b) => b.c - a.c);
  const st = streak();
  app.innerHTML = `<div class="screen with-tabs">
    <div class="page-t">Мой прогресс</div>
    <div class="stats">
      <div class="stat"><b>${done}</b><span>решено заданий</span></div>
      <div class="stat"><b>${acc}%</b><span>верных ответов</span></div>
      <div class="stat"><b>${st}</b><span>${plural(st, 'день', 'дня', 'дней')} подряд</span></div>
    </div>
    <div class="sec"><b>По предметам</b></div>
    <div class="box prog-box">
      ${list.map(s => {
        const t = countTasks(s), d = countSolved(s), p = t ? Math.round(d / t * 100) : 0;
        const full = s.data.filter(x => x.tasks.every((_, i) => solved[K(s.id, x.n, i)])).length;
        return `<div class="prow">
          <div class="pr-top"><span>${esc(s.name)}</span><b>${p}%</b></div>
          <div class="pbar"><i style="width:${p}%"></i></div>
          <div class="pr-sub">${d} из ${t} заданий · ${full} из ${s.data.length} номеров закрыто</div>
        </div>`;
      }).join('')}
    </div>
    <div class="sec"><b>Над чем поработать</b></div>
    ${weak.length ? `<div class="box">${weak.slice(0, 8).map(w => `
      <button class="opt weak-row" data-id="${w.s.id}" data-n="${w.t.n}">
        <span class="ic-sm">№${w.t.n}</span>
        <span class="lb">${esc(w.t.topic)}<small>${esc(w.s.name)} · ${w.c} ${plural(w.c, 'ошибка', 'ошибки', 'ошибок')}</small></span>
        ${ICON.chev}
      </button>`).join('')}</div>`
      : `<div class="card empty-card">Здесь появятся номера, в которых были ошибки. Пока всё отлично — продолжай решать!</div>`}
  </div>` + tabbar('progress');
  bindTabbar(); setBack(null);
  app.querySelectorAll('.weak-row').forEach(b => b.onclick = () => {
    haptic('sel');
    openSubject(b.dataset.id);
    state.tab = 'nums'; state.nums = new Set([+b.dataset.n]); renderSubject();
  });
  scrollTo(0, 0);
}

/* ---------- Вкладка «Настройки» ---------- */
function renderSettingsTab() {
  const mode = store.get(THEME_KEY, 'auto');
  const radio = on => `<span class="radio ${on ? 'on' : ''}"></span>`;
  app.innerHTML = `<div class="screen with-tabs">
    <div class="page-t">Настройки</div>
    <div class="sec"><b>Оформление</b></div>
    <div class="box">
      <button class="opt theme-opt" data-mode="auto"><span class="lb">Как в Telegram<small>Тема меняется вместе с приложением</small></span>${radio(mode === 'auto')}</button>
      <button class="opt theme-opt" data-mode="light"><span class="lb">Светлая тема</span>${radio(mode === 'light')}</button>
      <button class="opt theme-opt" data-mode="dark"><span class="lb">Тёмная тема</span>${radio(mode === 'dark')}</button>
    </div>
    <div class="sec"><b>Учёба</b></div>
    <div class="box">
      <button class="opt" id="setSubjects"><span class="lb">Мои предметы<small>${visibleSubjects().map(s => s.name).join(', ')}</small></span>${ICON.chev}</button>
      <button class="opt" id="setCurator"><span class="lb">Написать куратору<small>Разобрать тему, которая непонятна</small></span>${ICON.chev}</button>
    </div>
    <div class="sec"><b>Данные</b></div>
    <div class="box">
      <button class="opt" id="resetProgress"><span class="lb danger">Сбросить прогресс<small>Решённые задания и статистика будут удалены</small></span></button>
    </div>
  </div>` + tabbar('settings');
  bindTabbar(); setBack(null);
  app.querySelectorAll('.theme-opt').forEach(b => b.onclick = () => { store.set(THEME_KEY, b.dataset.mode); applyTheme(); haptic('sel'); renderSettingsTab(); });
  document.getElementById('setSubjects').onclick = () => { haptic('sel'); renderPicker(true); };
  document.getElementById('setCurator').onclick = () => { haptic('sel'); openCuratorsDirect(); };
  document.getElementById('resetProgress').onclick = () => {
    const doReset = () => {
      solved = {}; stats = { attempts: {}, mistakes: {}, days: [] };
      store.set('ege_solved_v2', solved); store.set(STATS_KEY, stats);
      haptic('success'); toast('Прогресс сброшен'); renderSettingsTab();
    };
    if (inTG && tg.showConfirm && tg.isVersionAtLeast && tg.isVersionAtLeast('6.2')) {
      try { tg.showConfirm('Сбросить весь прогресс? Это действие нельзя отменить.', ok => { if (ok) doReset(); }); return; } catch (e) {}
    }
    if (window.confirm('Сбросить весь прогресс? Это действие нельзя отменить.')) doReset();
  };
  scrollTo(0, 0);
}

function openSubject(id) {
  if (!subject || subject.id !== id) {
    subject = SUBJ.find(s => s.id === id);
    state.tab = 'nums'; state.nums = new Set(); state.topics = new Set();
  }
  renderSubject();
}

/* ---------- Избранное и ошибки ---------- */
let bookmarks = store.get('ege_bm', {});
let wrong = store.get('ege_wrong', {});
const isBm = (n, i) => !!bookmarks[K(subject.id, n, i)];
function toggleBm(n, i) { const k = K(subject.id, n, i); bookmarks[k] ? delete bookmarks[k] : bookmarks[k] = 1; store.set('ege_bm', bookmarks); return !!bookmarks[k]; }
function setWrong(n, i, on) { const k = K(subject.id, n, i); on ? wrong[k] = 1 : delete wrong[k]; store.set('ege_wrong', wrong); }
const listBy = obj => { const q = []; subject.data.forEach(t => t.tasks.forEach((_, i) => { if (obj[K(subject.id, t.n, i)]) q.push({ n: t.n, i }); })); return q; };
function taskId(n, i) { let h = 5381; const s = K(subject.id, n, i); for (let k = 0; k < s.length; k++) h = ((h << 5) + h + s.charCodeAt(k)) >>> 0; return 10000 + h % 90000; }

/* ---------- Предмет: номера / темы / пробники / игры ---------- */
function selectedNums() {
  if (state.tab === 'nums') return [...state.nums].sort((a, b) => a - b);
  const s = new Set(); state.topics.forEach(i => subject.topics[i].nums.forEach(n => s.add(n)));
  return [...s].sort((a, b) => a - b);
}
function buildQueue() {
  let q = [];
  selectedNums().forEach(n => { const t = byN(n); if (t) t.tasks.forEach((_, i) => { if (!(state.skipSolved && solved[K(subject.id, n, i)])) q.push({ n, i }); }); });
  if (state.shuffle) shuffle(q);
  return q;
}
function shuffle(q) { for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; } return q; }
const variantCount = () => Math.max(1, ...subject.data.map(t => t.tasks.length));
const variantQueue = k => subject.data.slice().sort((a, b) => a.n - b.n).map(t => ({ n: t.n, i: k < 0 ? Math.floor(Math.random() * t.tasks.length) : k % t.tasks.length }));
function startSession(queue, title) {
  state.queue = queue; state.pos = 0; state.results = []; state.answers = []; state.title = title || 'Тренировка';
  if (queue.length) { haptic('sel'); renderTask(); }
}
const lrow = (id, icon, label, sub) => `<button class="lrow" id="${id}"><span class="lic">${icon}</span><span class="lb">${label}${sub ? `<small>${sub}</small>` : ''}</span>${ICON.chev}</button>`;

function renderSubject() {
  const SUBJ_TABS = [['nums', 'Номера'], ['topics', 'Темы'], ['variants', 'Пробники'], ['games', 'Игры']];
  const chip = n => {
    const t = byN(n); const all = t && t.tasks.every((_, i) => solved[K(subject.id, n, i)]);
    return `<button class="chip ${state.nums.has(n) ? 'on' : ''}" data-n="${n}" aria-pressed="${state.nums.has(n)}">${n}${all ? '<span class="d"></span>' : ''}</button>`;
  };
  const cb = on => `<span class="cb ${on ? 'on' : ''}">${ICON.check}</span>`;
  const bmN = listBy(bookmarks).length, wrN = listBy(wrong).length;
  const pick = state.tab === 'nums' || state.tab === 'topics';
  let body = '';
  if (state.tab === 'nums') {
    body = `<div class="lbox">${lrow('goCards', ICON.cards, 'Карточки для запоминания')}${bmN ? lrow('goBm', ICON.bm, 'Избранные задания', bmN + ' ' + plural(bmN, 'задание', 'задания', 'заданий')) : ''}</div>`
      + subject.parts.map((p, pi) => `
      <div class="sec"><b>${esc(p.name)}</b><button class="link" data-all="${pi}">${p.nums.every(n => state.nums.has(n)) ? 'Снять все' : 'Выбрать все'}</button></div>
      <div class="chips">${p.nums.map(chip).join('')}</div>`).join('');
  } else if (state.tab === 'topics') {
    body = `
      <div class="sec" style="margin-top:6px"><b>Темы</b><button class="link" data-alltopics="1">${state.topics.size === subject.topics.length ? 'Снять все' : 'Выбрать все'}</button></div>
      <div class="box" style="margin-top:0">${subject.topics.map((t, i) => `
        <button class="opt" data-topic="${i}">${cb(state.topics.has(i))}<span class="lb">${i + 1}. ${esc(t.name)}<small>Номера: ${t.nums.join(', ')}</small></span></button>`).join('')}
      </div>`;
  } else if (state.tab === 'variants') {
    const vc = variantCount(), total = subject.data.length;
    body = `<div class="page-s" style="margin-top:4px">Полный вариант: все номера экзамена по порядку, как на настоящем ЕГЭ. В конце — сколько баллов первой части ты набрал.</div>
      <div class="lbox">${lrow('goRandom', ICON.dice, 'Случайный вариант', 'Задания на каждый номер выбираются случайно')}</div>
      <div class="vlist">${Array.from({ length: vc }, (_, k) => {
        const q = variantQueue(k), done = q.filter(x => solved[K(subject.id, x.n, x.i)]).length;
        return `<button class="var" data-var="${k}"><span class="vn">${k + 1}</span><span class="lb"><b>Вариант ${k + 1}</b><small>${total} ${plural(total, 'задание', 'задания', 'заданий')} · решено ${done}</small><span class="pbar"><i style="width:${done / total * 100}%"></i></span></span>${ICON.chev}</button>`;
      }).join('')}</div>`;
  } else {
    const shortN = subject.data.filter(t => t.kind !== 'long').reduce((a, t) => a + t.tasks.length, 0);
    body = `<div class="games">
      <button class="game" id="goCards"><span class="gic">${ICON.cards}</span><b>Карточки для запоминания</b><small>Правила и подсказки по каждому номеру. Переворачивай и проверяй себя.</small></button>
      <button class="game" id="goBlitz"><span class="gic">${ICON.bolt}</span><b>Блиц</b><small>10 случайных заданий с кратким ответом подряд${shortN ? '' : ' (нет заданий)'}</small></button>
      <button class="game" id="goWrong" ${wrN ? '' : 'disabled'}><span class="gic">${ICON.redo}</span><b>Работа над ошибками</b><small>${wrN ? wrN + ' ' + plural(wrN, 'задание', 'задания', 'заданий') + ', где была ошибка' : 'Здесь появятся задания, в которых ты ошибся'}</small></button>
      <button class="game" id="goBm" ${bmN ? '' : 'disabled'}><span class="gic">${ICON.bm}</span><b>Избранное</b><small>${bmN ? bmN + ' ' + plural(bmN, 'задание', 'задания', 'заданий') : 'Сохраняй задания закладкой во время тренировки'}</small></button>
    </div>`;
  }
  const q = pick ? buildQueue() : [];
  app.innerHTML = `<div class="screen">
    ${header(subject.name, ICON.back)}
    <div class="tabs">${SUBJ_TABS.map(([k, l]) => `<button class="tab ${state.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
    ${body}
    ${pick ? `<div class="box">
      <button class="opt" id="optShuffle"><span class="lb">Перемешать задания</span>${cb(state.shuffle)}</button>
      <button class="opt" id="optSkip"><span class="lb">Не включать задачи, которые уже решались</span>${cb(state.skipSolved)}</button>
    </div>` : ''}
  </div>
  ${pick ? `<div class="bottom"><div class="in">
    <div class="count">${selectedNums().length ? (q.length ? q.length + ' ' + plural(q.length, 'задание', 'задания', 'заданий') + ' в тренировке' : 'Все выбранные задания уже решены') : 'Выбери номера или темы'}</div>
    <button class="main" id="start" ${q.length ? '' : 'disabled'}>Начать тренировку</button>
  </div></div>` : ''}`;
  bindBack(renderHome);
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; haptic('sel'); renderSubject(); });
  app.querySelectorAll('.chip').forEach(b => b.onclick = () => { const n = +b.dataset.n; state.nums.has(n) ? state.nums.delete(n) : state.nums.add(n); haptic('sel'); renderSubject(); });
  app.querySelectorAll('[data-all]').forEach(b => b.onclick = () => {
    const list = subject.parts[+b.dataset.all].nums; const all = list.every(n => state.nums.has(n));
    list.forEach(n => all ? state.nums.delete(n) : state.nums.add(n)); haptic('sel'); renderSubject();
  });
  app.querySelectorAll('[data-topic]').forEach(b => b.onclick = () => { const i = +b.dataset.topic; state.topics.has(i) ? state.topics.delete(i) : state.topics.add(i); haptic('sel'); renderSubject(); });
  const at = app.querySelector('[data-alltopics]'); if (at) at.onclick = () => { if (state.topics.size === subject.topics.length) state.topics.clear(); else subject.topics.forEach((_, i) => state.topics.add(i)); haptic('sel'); renderSubject(); };
  app.querySelectorAll('[data-var]').forEach(b => b.onclick = () => startSession(variantQueue(+b.dataset.var), 'Вариант ' + (+b.dataset.var + 1)));
  on('optShuffle', () => { state.shuffle = !state.shuffle; haptic('sel'); renderSubject(); });
  on('optSkip', () => { state.skipSolved = !state.skipSolved; haptic('sel'); renderSubject(); });
  on('start', () => startSession(buildQueue(), 'Тренировка'));
  on('goCards', () => { haptic('sel'); renderCards(subject.data.slice().sort((a, b) => a.n - b.n).map(t => t.n), 0, [], 0); });
  on('goBm', () => startSession(listBy(bookmarks), 'Избранное'));
  on('goWrong', () => startSession(shuffle(listBy(wrong)), 'Работа над ошибками'));
  on('goRandom', () => startSession(variantQueue(-1), 'Случайный вариант'));
  on('goBlitz', () => {
    const all = []; subject.data.forEach(t => { if (t.kind !== 'long') t.tasks.forEach((_, i) => all.push({ n: t.n, i })); });
    startSession(shuffle(all).slice(0, 10), 'Блиц');
  });
  scrollTo(0, 0);
}

/* ---------- Карточки для запоминания ---------- */
function renderCards(list, idx, again, known) {
  if (idx >= list.length) {
    app.innerHTML = `<div class="screen">
      ${header('Карточки', ICON.close)}
      <div class="card res"><div class="big">${known}/${list.length}</div><p>карточек ты уже знаешь</p></div>
      ${again.length ? `<div class="page-s" style="text-align:center;margin-top:14px">Осталось повторить: №${again.join(', №')}</div>` : ''}
    </div>
    <div class="bottom"><div class="in"><div class="count"></div>
      ${again.length ? '<button class="main" id="rep">Повторить сложные</button>' : '<button class="main" id="fin">Готово</button>'}
    </div></div>`;
    bindBack(renderSubject);
    const r = document.getElementById('rep'); if (r) r.onclick = () => renderCards(again, 0, [], 0);
    const f = document.getElementById('fin'); if (f) f.onclick = renderSubject;
    haptic('success'); return;
  }
  const t = byN(list[idx]);
  app.innerHTML = `<div class="screen">
    ${header('Карточки', ICON.close)}
    <div class="prog"><div class="bar"><i style="width:${idx / list.length * 100}%"></i></div><span>${idx + 1}/${list.length}</span></div>
    <button class="flash" id="flash" aria-label="Перевернуть карточку">
      <span class="face front"><span class="fn">№${t.n}</span><span class="ft">${esc(t.topic)}</span><span class="fh">Вспомни, как решается этот номер, и нажми, чтобы проверить</span></span>
      <span class="face back"><span class="ft">№${t.n} · ${esc(t.topic)}</span><ul>${t.how.map(h => `<li>${esc(h)}</li>`).join('')}</ul>${t.tip ? `<span class="tip">💡 ${esc(t.tip)}</span>` : ''}</span>
    </button>
  </div>
  <div class="bottom"><div class="in"><div class="count">Нажми на карточку, чтобы перевернуть</div>
    <div class="two"><button class="ghost" id="no">Повторить</button><button class="main" id="yes">Знаю</button></div>
  </div></div>`;
  bindBack(renderSubject);
  const fl = document.getElementById('flash');
  fl.onclick = () => { fl.classList.toggle('flip'); haptic('sel'); };
  document.getElementById('no').onclick = () => renderCards(list, idx + 1, again.concat(t.n), known);
  document.getElementById('yes').onclick = () => renderCards(list, idx + 1, again, known + 1);
  scrollTo(0, 0);
}

/* ---------- Текст задания: таблицы, списки, формулы ---------- */
const CAPS = /^[A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9 ,.\-–—()«»/]*$/;
const LET = /^([А-Е])\)\s*(.*)$/, NUMRE = /^(\d{1,2})\)\s*(.*)$/;
function renderQ(text, t, x) {
  const figHtml = x && x.fig && window.FIG ? window.FIG.render(x.fig) : '';
  const L = String(text).split('\n');
  const isCaps = s => s.trim().length > 2 && CAPS.test(s.trim()) && /[А-ЯЁA-Z]{3}/.test(s);
  const cols = (x && x.cols) || (t && t.cols) || null;
  let out = '', para = [];
  const flush = () => { if (para.length) { out += `<p>${para.map(esc).join('<br>')}</p>`; para = []; } };
  const cell = s => esc(s);
  let k = 0;
  const skipBlank = j => { while (j < L.length && !L[j].trim()) j++; return j; };
  while (k < L.length) {
    const line = L[k];
    // таблица соответствия: [ЗАГОЛОВОК] А) … Б) … [пусто] [ЗАГОЛОВОК] 1) … 2) …
    let j = k, lh = '';
    if (isCaps(line) && LET.test((L[skipBlank(k + 1)] || '').trim())) { lh = line.trim(); j = skipBlank(k + 1); }
    if (LET.test((L[j] || '').trim())) {
      const left = []; while (j < L.length && LET.test(L[j].trim())) { left.push(L[j].trim()); j++; }
      let m = skipBlank(j), rh = '';
      if (m < L.length && isCaps(L[m]) && NUMRE.test((L[skipBlank(m + 1)] || '').trim())) { rh = L[m].trim(); m = skipBlank(m + 1); }
      const right = []; while (m < L.length && NUMRE.test(L[m].trim())) { right.push(L[m].trim()); m++; }
      if (left.length >= 2 && right.length >= 2) {
        flush();
        const H = [lh || (cols && cols[0]) || '', rh || (cols && cols[1]) || ''];
        const rows = Math.max(left.length, right.length);
        out += `<div class="tbl-wrap"><table class="mtbl">${H[0] || H[1] ? `<thead><tr><th>${esc(H[0])}</th><th>${esc(H[1])}</th></tr></thead>` : ''}<tbody>${Array.from({ length: rows }, (_, r) => `<tr><td>${cell(left[r] || '')}</td><td>${cell(right[r] || '')}</td></tr>`).join('')}</tbody></table></div>`;
        k = m; continue;
      }
    }
    // таблица «A — B» (2+ строк подряд)
    if (/ — /.test(line) && !NUMRE.test(line.trim()) && / — /.test(L[k + 1] || '') && !NUMRE.test((L[k + 1] || '').trim())) {
      const rows = []; while (k < L.length && / — /.test(L[k]) && !NUMRE.test(L[k].trim())) { rows.push(L[k].split(' — ')); k++; }
      flush();
      const [h, ...rest] = rows;
      out += `<div class="tbl-wrap"><table class="mtbl"><thead><tr>${h.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rest.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      continue;
    }
    // список вариантов 1) 2) 3)
    if (NUMRE.test(line.trim()) && NUMRE.test((L[k + 1] || '').trim())) {
      flush();
      const items = []; while (k < L.length && NUMRE.test(L[k].trim())) { items.push(L[k].trim()); k++; }
      out += `<div class="olist">${items.map(s => { const mm = s.match(NUMRE); return `<div class="oi"><span class="on">${mm[1]})</span><span>${esc(mm[2])}</span></div>`; }).join('')}</div>`;
      continue;
    }
    if (line.trim() === '{fig}') { flush(); out += figHtml; k++; continue; }
    if (!line.trim()) flush(); else para.push(line);
    k++;
  }
  flush();
  return /\{fig\}/.test(text) ? out : out + figHtml;
}
function typeset(el) {
  if (!el) return;
  if (window.renderMathInElement) {
    try { window.renderMathInElement(el, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false }); } catch (e) {}
  } else if (/\$/.test(el.textContent)) {
    window.addEventListener('load', () => typeset(document.getElementById('qbox')), { once: true });
  }
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
function leaveTask() {
  const { n } = state.queue[state.pos];
  if (state.results[state.pos] === undefined) state.results[state.pos] = byN(n).kind === 'long' ? 'seen' : 'skip';
}
function goTo(pos) {
  leaveTask();
  if (pos >= state.queue.length) return renderResults();
  state.pos = pos; renderTask();
}
function renderTask() {
  const { n, i } = state.queue[state.pos];
  const t = byN(n), x = t.tasks[i], short = t.kind !== 'long';
  const total = state.queue.length, cur = state.pos + 1, last = cur === total;
  const st = state.answers[state.pos] || (state.answers[state.pos] = { v: '', checked: '', ok: false });
  const howHtml = `<ul>${t.how.map(h => `<li>${esc(h)}</li>`).join('')}</ul>${t.tip ? `<div class="tip">💡 ${esc(t.tip)}</div>` : ''}`;
  const solHtml = `<ol>${x.s.map(s => `<li>${esc(s)}</li>`).join('')}</ol><div class="final${short ? '' : ' long'}">${short ? 'Ответ: ' + esc(firstAnswer(x)) : esc(x.ans)}</div>`;
  const fmt = x.fmt || t.fmt;
  const hasCur = curatorsFor(subject.id).length > 0;
  const stripBtn = (q, k) => {
    const r = state.results[k];
    return `<button class="sn ${k === state.pos ? 'now' : r === 'ok' || r === 'seen' ? 'ok' : r === 'bad' ? 'bad' : ''}" data-pos="${k}" aria-label="Задание ${k + 1}">${k + 1}</button>`;
  };
  app.innerHTML = `<div class="screen train">
    ${header(state.title || 'Тренировка', ICON.close)}
    <div class="strip" id="strip">${state.queue.map(stripBtn).join('')}</div>
    <div class="card tcard">
      <div class="kim">Задание №${n} по КИМ <span class="kid">#${taskId(n, i)}</span></div>
      <div class="ktopic">${esc(t.topic)}${t.pts ? ` · ${t.pts} ${plural(t.pts, 'балл', 'балла', 'баллов')}` : ''}</div>
      <div class="q" id="qbox">${renderQ(x.q, t, x)}</div>
      ${short ? `
        ${fmt ? `<div class="fmt">${esc(fmt)}</div>` : ''}
        <input class="ans" id="inp" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Введи ответ" enterkeyhint="done">
        <div id="fb"></div>
        <button class="act" id="act"></button>` : `
        <div class="fmt">Задание с развёрнутым ответом: запиши решение на листе или в заметках, потом сверься с образцом и критериями.</div>
        <button class="act ghost-b" id="showSol">Показать образец ответа</button>
        <button class="act primary" id="nextL">${last ? 'Завершить тренировку' : 'Следующее задание'}</button>`}
      <div class="tools">
        ${hasCur ? `<button class="ti" id="tCur" aria-label="Разобрать с куратором">${ICON.chat}</button>` : ''}
        <button class="ti ${isBm(n, i) ? 'on' : ''}" id="tBm" aria-label="В избранное">${ICON.bm}</button>
        <button class="ti" id="tShare" aria-label="Поделиться">${ICON.share}</button>
      </div>
    </div>
    <button class="report" id="report">${ICON.alert}<span>Сообщить об ошибке в условии или решении задания</span></button>
    ${acc('how', (short ? 'Как решать №' : 'Как выполнять №') + n, howHtml, false)}
    ${acc('sol', short ? 'Решение' : 'Образец ответа и критерии', solHtml, false)}
  </div>`;
  bindBack(() => { leaveTask(); renderSubject(); });
  typeset(document.getElementById('qbox'));
  const strip = document.getElementById('strip');
  const curBtn = strip.querySelector('.sn.now'); if (curBtn) strip.scrollLeft = curBtn.offsetLeft - strip.clientWidth / 2 + curBtn.offsetWidth / 2;
  strip.querySelectorAll('[data-pos]').forEach(b => b.onclick = () => { const p = +b.dataset.pos; if (p !== state.pos) { haptic('sel'); goTo(p); } });
  const openAcc = (id, open) => {
    const el = document.getElementById(id);
    el.classList.toggle('open', open); el.querySelector('.body').classList.toggle('hidden', !open);
    el.querySelector('button').setAttribute('aria-expanded', open);
    if (id === 'sol' && open) { if (state.results[state.pos] === undefined) state.results[state.pos] = short ? 'skip' : 'seen'; if (!short) markSolved(subject.id, n, i); }
  };
  ['how', 'sol'].forEach(id => { const el = document.getElementById(id); el.querySelector('button').onclick = () => openAcc(id, !el.classList.contains('open')); });
  const next = () => { haptic('sel'); goTo(state.pos + 1); };
  if (short) {
    const inp = document.getElementById('inp'), fb = document.getElementById('fb'), act = document.getElementById('act');
    if (/^[\d\s.,−-]*$/.test(String(firstAnswer(x)))) inp.setAttribute('inputmode', 'decimal');
    inp.value = st.v;
    const paint = () => {
      const v = inp.value.trim();
      inp.className = 'ans' + (st.ok ? ' ok' : st.checked && st.checked === v ? ' bad' : '');
      if (st.ok) fb.innerHTML = '<div class="fb ok">Верно! Отличная работа</div>';
      else if (st.checked && st.checked === v) fb.innerHTML = '<div class="fb bad">Неверно. Исправь ответ или открой решение ниже</div>';
      else fb.innerHTML = '';
      let mode;
      if (st.ok) mode = 'next'; else if (v && v !== st.checked) mode = 'check'; else if (st.checked) mode = 'next'; else mode = 'skip';
      act.dataset.mode = mode;
      act.className = 'act ' + (mode === 'skip' ? 'ghost-b' : 'primary');
      act.textContent = mode === 'check' ? 'Ответить' : mode === 'skip' ? (last ? 'Пропустить и завершить' : 'Пропустить задание') : (last ? 'Завершить тренировку' : 'Следующее задание');
    };
    const check = () => {
      const v = inp.value.trim(); if (!v) { inp.focus(); return; }
      st.checked = v; st.v = v;
      if (isRight(v, x, t)) {
        st.ok = true; if (state.results[state.pos] !== 'bad') state.results[state.pos] = 'ok';
        recordAttempt(subject.id, n, true); markSolved(subject.id, n, i); setWrong(n, i, false); haptic('success');
      } else {
        state.results[state.pos] = 'bad'; recordAttempt(subject.id, n, false); setWrong(n, i, true); haptic('error');
      }
      paint();
    };
    inp.addEventListener('input', () => { if (!st.ok) { st.v = inp.value; paint(); } });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); act.dataset.mode === 'check' ? check() : act.dataset.mode === 'next' ? next() : null; } });
    act.onclick = () => { const m = act.dataset.mode; if (m === 'check') check(); else next(); };
    if (st.ok) inp.readOnly = true;
    paint();
  } else {
    document.getElementById('showSol').onclick = () => { openAcc('sol', true); document.getElementById('sol').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    document.getElementById('nextL').onclick = next;
  }
  const tc = document.getElementById('tCur');
  if (tc) tc.onclick = () => { haptic('sel'); openCurators({ n, i, t, x, short, answer: st.checked || st.v }); };
  document.getElementById('tBm').onclick = e => { const on = toggleBm(n, i); e.currentTarget.classList.toggle('on', on); haptic('sel'); toast(on ? 'Задание добавлено в избранное' : 'Задание убрано из избранного'); };
  document.getElementById('tShare').onclick = () => shareTask(n, i, x);
  document.getElementById('report').onclick = () => { haptic('sel'); openCurators({ n, i, t, x, short, answer: st.checked || st.v, report: true }); };
  scrollTo(0, 0);
}
async function shareTask(n, i, x) {
  const text = `Задание №${n} ЕГЭ · ${subject.name} (#${taskId(n, i)})\n\n${x.q.replace(/\$/g, '').replace(/\n?\{fig\}/g, '')}\n\nРешаю в тренажёре ЕГЭ`;
  if (inTG && tg.openTelegramLink) { try { tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(text)); return; } catch (e) {} }
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  const ok = await copyText(text); toast(ok ? 'Текст задания скопирован' : 'Не удалось поделиться');
}

/* ---------- Кураторы ---------- */
const CUR_KEY = 'ege_curator';
function curatorsFor(sid) {
  const all = window.CURATORS || [];
  return all.filter(c => c.subjects.includes('all') || c.subjects.includes(sid));
}
function buildMessage(ctx) {
  const max = 700;
  const qq = ctx.x.q.replace(/\n?\{fig\}/g, '');
  const q = qq.length > max ? qq.slice(0, max) + '…' : qq;
  const lines = [
    ctx.report ? 'Здравствуйте! Кажется, в задании тренажёра ЕГЭ ошибка в условии или решении.' : 'Здравствуйте! Помогите, пожалуйста, разобраться с заданием из тренажёра ЕГЭ.',
    'Предмет: ' + subject.name + ', задание №' + ctx.n + ' (#' + taskId(ctx.n, ctx.i) + ')',
    '',
    q,
    ''
  ];
  if (ctx.report) lines.push('Что не так: (опишу ниже)');
  else if (ctx.short) lines.push('Мой ответ: ' + (ctx.answer || '—'));
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
  let list = curatorsFor(subject.id);
  if (!list.length && ctx.report) list = window.CURATORS || [];
  const saved = store.get(CUR_KEY, {});
  const prev = saved[subject.id];
  const sheet = document.createElement('div');
  sheet.className = 'sheet-wrap';
  sheet.innerHTML = `<div class="sheet" role="dialog" aria-label="Выбор куратора">
    <div class="sheet-grip"></div>
    <div class="sheet-t">${ctx.report ? 'Сообщить об ошибке' : 'Выбери куратора'}</div>
    <div class="sheet-s">${ctx.report ? 'Напиши куратору, что не так в задании, — мы исправим. Номер задания скопируется автоматически, просто вставь его в чат.' : 'Куратор разберёт ошибку, объяснит решение и задаст вопросы, чтобы закрепить тему. Текст задания скопируется автоматически — просто вставь его в чат.'}</div>
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
    toast(ok ? (ctx.report ? 'Номер задания скопирован — вставь его в чат и опиши ошибку' : 'Текст задания скопирован — вставь его в чат с куратором') : 'Открываю чат с куратором');
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
        <span class="info"><b>${esc(c.name)}</b>${c.about ? `<small>${esc(c.about)}</small>` : ''}<small class="subj-l">${c.subjects.includes('all') ? 'Все предметы' : esc(c.subjects.map(names).join(', '))}</small></span>
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

/* ---------- Доступ по заявке ---------- */
const ACCESS_API = 'https://egebot.p-rotpa.workers.dev/check';
const ACCESS_KEY = 'ege_access';
function checkAccess(done) {
  if (!inTG || !tg.initData) return done(false, 'browser');
  const uid = tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id;
  const cached = store.get(ACCESS_KEY, null);
  fetch(ACCESS_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: tg.initData }) })
    .then(r => r.text())
    .then(t => {
      let res;
      try { res = JSON.parse(t); } catch (e) { return done(true, 'not-configured'); } // проверка на сервере ещё не включена
      if (res.ok) store.set(ACCESS_KEY, { uid, at: Date.now() }); else store.set(ACCESS_KEY, null);
      done(!!res.ok, res.status);
    })
    .catch(() => done(!!(cached && cached.uid === uid), 'offline'));
}
function renderLoading() {
  app.innerHTML = `<div class="screen center-screen"><div class="spinner" aria-label="Загрузка"></div></div>`;
}
function renderLocked(status) {
  const T = {
    pending: ['Заявка на рассмотрении ⏳', 'Мы получили твою заявку. Как только доступ откроют, бот пришлёт сообщение — после этого заходи в тренажёр.'],
    rejected: ['Доступ не открыт', 'К сожалению, доступ к тренажёру пока не одобрен. Если это ошибка — напиши нам.'],
    browser: ['Открой тренажёр в Telegram', 'Тренажёр работает только внутри Telegram-бота. Открой бота и нажми /start, чтобы отправить заявку.'],
    offline: ['Нет соединения', 'Не удалось проверить доступ. Проверь интернет и открой тренажёр ещё раз.']
  };
  const [title, text] = T[status] || ['Доступ по заявке', 'Чтобы пользоваться тренажёром, отправь заявку: вернись в бота и нажми /start. Мы откроем доступ после проверки.'];
  app.innerHTML = `<div class="screen center-screen">
    <div class="lock-ic"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>
    <div class="page-t" style="text-align:center">${esc(title)}</div>
    <div class="page-s" style="text-align:center">${esc(text)}</div>
    ${inTG ? '<button class="main" id="toBot" style="max-width:320px">Вернуться в бота</button>' : ''}
  </div>`;
  setBack(null);
  const b = document.getElementById('toBot'); if (b) b.onclick = () => { try { tg.close(); } catch (e) {} };
}

/* ---------- Итоги ---------- */
function renderResults() {
  const items = state.queue.map((q, k) => ({ ...q, k, r: state.results[k] }));
  const shortItems = items.filter(x => byN(x.n).kind !== 'long');
  const ok = shortItems.filter(x => x.r === 'ok').length;
  const pct = shortItems.length ? Math.round(ok / shortItems.length * 100) : 100;
  const label = r => r === 'ok' ? ['ok', '✓', 'Верно'] : r === 'bad' ? ['bad', '✕', 'Ошибка'] : r === 'seen' ? ['sk', '✓', 'Разобрано'] : ['sk', '–', 'Пропущено'];
  const bad = items.filter(x => x.r === 'bad');
  app.innerHTML = `<div class="screen">
    ${header('Итоги: ' + (state.title || 'тренировка').toLowerCase(), ICON.close)}
    <div class="card res">
      <div class="big">${shortItems.length ? ok + '/' + shortItems.length : '✓'}</div>
      <p>${shortItems.length ? 'верных ответов · ' + pct + '%' : 'Все задания разобраны'}</p>
    </div>
    <div class="rlist">${items.map(x => { const [c, s, l] = label(x.r); return `<button class="ritem" data-k="${x.k}"><span class="st ${c}">${s}</span><span style="flex:1;text-align:left">${x.k + 1}. Задание №${x.n} <span style="color:var(--hint)">#${taskId(x.n, x.i)}</span></span><span style="color:var(--hint);font-size:13px">${l}</span></button>`; }).join('')}</div>
  </div>
  <div class="bottom"><div class="in"><div class="count"></div>
    ${bad.length ? `<div class="two"><button class="ghost" id="fix">Ошибки (${bad.length})</button><button class="main" id="again">Готово</button></div>` : '<button class="main" id="again">Готово</button>'}
  </div></div>`;
  bindBack(renderSubject);
  document.getElementById('again').onclick = renderSubject;
  const f = document.getElementById('fix'); if (f) f.onclick = () => startSession(bad.map(x => ({ n: x.n, i: x.i })), 'Работа над ошибками');
  app.querySelectorAll('.ritem[data-k]').forEach(b => b.onclick = () => { state.pos = +b.dataset.k; renderTask(); });
  haptic('success');
  scrollTo(0, 0);
}

renderLoading();
checkAccess((ok, status) => {
  if (!ok) return renderLocked(status);
  loadFromCloud(() => { if (mySubjects && mySubjects.length) renderHome(); else renderPicker(false); });
});
