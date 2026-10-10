/* Список кураторов.
   Чтобы добавить куратора, скопируйте блок { … } и поменяйте данные:
   - name     — имя, которое увидит ученик;
   - username — ник в Telegram без @ (именно в этот чат откроется переписка);
   - subjects — id предметов: 'math-profile', 'math-base', 'russian', 'social', 'history',
                'biology', 'chemistry', 'physics', 'literature', или 'all' — все предметы;
   - about    — короткое описание (необязательно). */
window.CURATORS = [
  { name: 'Куратор по математике и русскому', username: 'gortopss1', subjects: ['math-profile', 'russian'], about: 'Профильная математика и русский язык' },
  { name: 'Куратор по химии и биологии', username: 'beaty052', subjects: ['chemistry', 'biology'], about: 'Химия и биология' }
];
