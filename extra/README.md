Дополнительные задания (прототипы). Каждый файл добавляет задания к уже существующему предмету:

```js
(function () {
  const S = window.SUBJECTS.find(s => s.id === 'chemistry');
  const ADD = { 7: [ { q, a, s }, ... ], 8: [...] };
  Object.keys(ADD).forEach(n => S.data.find(t => t.n === +n).tasks.push(...ADD[n]));
})();
```
Файлы подключаются в index.html после subjects/*.js и до pictures.js.
