// Проверка данных: node tools/validate.js
// - у каждого предмета есть все номера из parts, без дублей
// - у каждого номера есть how, tasks; у коротких — ответ и решение; у длинных — образец
// - каждый правильный ответ принимается функцией проверки из app.js
const fs = require('fs');
const path = require('path');
global.window = { SUBJECTS: [] };
const dir = path.join(__dirname, '..', 'subjects');
fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(f => require(path.join(dir, f)));
const xdir = path.join(__dirname, '..', 'extra');
if (fs.existsSync(xdir)) fs.readdirSync(xdir).filter(f => f.endsWith('.js')).sort().forEach(f => require(path.join(xdir, f)));
require(path.join(__dirname, '..', 'pictures.js'));
require(path.join(__dirname, '..', 'figures.js'));

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const normSrc = appSrc.match(/function norm\(s\) \{[\s\S]*?\n\}/)[0];
const isRightSrc = appSrc.match(/function isRight\(user, task, num\) \{[\s\S]*?\n\}/)[0];
const { isRight } = new Function(normSrc + '\n' + isRightSrc + '\nreturn { isRight };')();

const EXPECT = { 'math-profile': 19, 'math-base': 21, russian: 27, social: 25, history: 21, biology: 28, chemistry: 34, physics: 26, literature: 11 };
let errors = 0, total = 0;
const seenQ = new Set();
const err = m => { errors++; console.log('  ✗ ' + m); };
for (const s of window.SUBJECTS) {
  const nums = s.data.map(t => t.n);
  console.log(`${s.name}: ${s.data.length} номеров, ${s.data.reduce((a, t) => a + t.tasks.length, 0)} заданий`);
  if (EXPECT[s.id] && s.data.length !== EXPECT[s.id]) err(`ожидалось ${EXPECT[s.id]} номеров`);
  const partNums = s.parts.flatMap(p => p.nums);
  for (let n = 1; n <= (EXPECT[s.id] || nums.length); n++) {
    if (!nums.includes(n)) err(`нет номера ${n}`);
    if (!partNums.includes(n)) err(`номер ${n} не входит ни в одну часть`);
  }
  if (new Set(nums).size !== nums.length) err('дубли номеров');
  s.topics.forEach(t => t.nums.forEach(n => { if (!nums.includes(n)) err(`тема «${t.name}» ссылается на несуществующий номер ${n}`); }));
  for (const t of s.data) {
    if (!t.topic || !t.how || !t.how.length) err(`№${t.n}: нет темы или блока «как решать»`);
    if (!t.tasks.length) err(`№${t.n}: нет заданий`);
    t.tasks.forEach((x, i) => {
      total++;
      const id = `№${t.n} вариант ${i + 1}`;
      if (!x.q || !x.s || !x.s.length) err(`${id}: нет условия или решения`);
      const qk = s.id + '|' + t.n + '|' + x.q; if (seenQ.has(qk)) err(`${id}: повторяет другое задание`); seenQ.add(qk);
      if (x.fig) { try { const svg = window.FIG.render(x.fig); if (!/<svg/.test(svg) || /NaN|undefined/.test(svg)) err(`${id}: рисунок не построился`); } catch (e) { err(`${id}: ошибка рисунка ${e.message}`); } }
      if ((x.q.match(/\$/g) || []).length % 2) err(`${id}: непарный $ в формуле`);
      if (t.kind === 'long') { if (!x.ans) err(`${id}: нет образца ответа`); return; }
      if (x.a === undefined || x.a === '') { err(`${id}: нет ответа`); return; }
      (Array.isArray(x.a) ? x.a : [x.a]).forEach(v => { if (!isRight(v, x, t)) err(`${id}: ответ «${v}» не принимается`); });
      const mode = x.mode || t.mode;
      if (mode === 'set') {
        const v = String(Array.isArray(x.a) ? x.a[0] : x.a);
        if (!isRight(v.split('').reverse().join(''), x, t)) err(`${id}: set-ответ не принимается в другом порядке`);
      }
    });
  }
}
console.log(`\nВсего заданий: ${total}. Ошибок: ${errors}`);
process.exit(errors ? 1 : 0);
