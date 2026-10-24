// Группы учителя и таблица посещаемости (как в Excel): ученики × уроки месяца.
(function () {
  const { L, esc, $, $$, modal, schedText, empty } = UI;

  async function render(root, ctx) {
    root.innerHTML = `<div class="loading">Загрузка…</div>`;
    const [classes, courses, roster] = await Promise.all([DB.classes(), DB.courses(), DB.roster()]);
    const courseName = Object.fromEntries(courses.map((c) => [c.id, c.name]));
    const mine = classes.filter((c) => c.active && (ctx.role === 'admin' || c.teacher_id === ctx.teacher?.id))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'group' ? -1 : 1));

    root.innerHTML = `
      <div class="page-head"><h1>Мои группы и ученики</h1></div>
      <p class="muted small">Нажмите на группу, чтобы открыть таблицу посещаемости по месяцам.</p>
      <div class="cards">
        ${mine.length ? mine.map((c) => {
          const st = roster.filter((r) => r.class_id === c.id && r.active);
          return `
          <button class="card card-btn" data-open="${c.id}">
            <div class="lesson-top">
              <div class="lesson-main">
                <div class="lesson-name">${esc(c.name)}</div>
                <div class="muted small">${esc(courseName[c.course_id] || '')} · ${L.kind[c.kind]} · ${c.mode === 'online' ? '🎥 онлайн' : '🏫 офлайн'}</div>
              </div>
              <span class="badge">${st.length} уч.</span>
            </div>
            <div class="small">🗓 ${schedText(c.schedule)}</div>
            <div class="students-line">${st.length ? st.map((r) => `<span class="st">${esc(r.student_name)}</span>`).join('') : '<span class="muted small">Нет учеников</span>'}</div>
          </button>`;
        }).join('') : empty('У вас пока нет групп. Администратор добавит вас в занятия.')}
      </div>`;
    $$('[data-open]', root).forEach((b) => b.onclick = () => openMatrix(b.dataset.open, ctx.role === 'admin'));
  }

  // ---------- Таблица посещаемости ----------
  // onChange — обновить страницу под окном (после изменений)
  async function openMatrix(classId, isAdmin, onChange) {
    const [classes, courses, roster] = await Promise.all([DB.classes(), DB.courses(), DB.roster()]);
    const c = classes.find((x) => x.id === classId);
    if (!c) return;
    const teachers = isAdmin ? await DB.teachers() : [];
    const info = {
      classById: { [c.id]: c },
      courseName: Object.fromEntries(courses.map((x) => [x.id, x.name])),
      teacherName: Object.fromEntries(teachers.map((x) => [x.id, x.full_name])),
      roster, isAdmin,
    };
    const starts = Logic.classStarts(roster);
    let month = Logic.today().slice(0, 7);
    const m = modal(`Посещаемость · ${c.name}`, `<div data-mx><div class="loading">Загрузка…</div></div>
      ${isAdmin ? `<div class="form-actions mx-actions">
        ${c.kind === 'group' ? '<button class="btn btn-primary" data-add-st>+ Добавить ученика</button>' : ''}
        <button class="btn" data-cal>📅 Календарь</button>
        <button class="btn" data-settings>⚙ Настройки</button>
      </div>` : ''}`, { wide: true });
    if (isAdmin) {
      const reopen = () => { onChange && onChange(); openMatrix(classId, isAdmin, onChange); };
      $('[data-cal]', m.el).onclick = () => { m.close(); CalendarPage.open(classId, onChange); };
      $('[data-settings]', m.el).onclick = () => {
        const ctx = { classes, courses, teachers, courseName: info.courseName, teacherName: info.teacherName };
        m.close(); ClassesPage.editClass(c, ctx, reopen);
      };
      const add = $('[data-add-st]', m.el);
      if (add) add.onclick = () => { m.close(); StudentsPage.addToClass(classId, reopen); };
    }
    m.el.querySelector('.modal').classList.add('modal-xwide');
    const box = $('[data-mx]', m.el);

    async function draw() {
      const [from, to] = Logic.monthRange(month);
      const t = Logic.today();
      const lessons = (await DB.lessons(from, to)).filter((l) => l.class_id === classId);
      const slots = [];
      for (let d = from; d <= to; d = Logic.addDays(d, 1)) {
        slots.push(...Logic.lessonsForDate(d, [c], lessons.filter((l) => l.date === d), starts));
      }
      // ученики, которые были в группе в этом месяце
      const students = roster.filter((r) => r.class_id === classId && r.start_date <= to &&
        (r.active || lessons.some((l) => (l.attendance || []).some((a) => a.enrollment_id === r.enrollment_id))));

      const cell = (s, r) => {
        const l = s.lesson;
        if (s.date < r.start_date) return '<td class="mx-na"></td>';
        if (!l) return s.date < t ? '<td class="mx-q" title="Не отмечен">?</td>' : '<td></td>';
        if (l.status === 'rescheduled') return '<td class="mx-moved" title="Перенос">↷</td>';
        if (l.status === 'planned') return s.date < t ? '<td class="mx-q" title="Не отмечен">?</td>' : '<td></td>';
        if (l.status === 'cancelled' && !l.caused_by) return '<td class="mx-none" title="Урока не было">—</td>';
        const a = (l.attendance || []).find((x) => x.enrollment_id === r.enrollment_id);
        if (l.status === 'cancelled') return `<td class="mx-cancel" title="Отмена">отм</td>`;
        if (!a) return '<td></td>';
        return a.present ? '<td class="mx-yes" title="Был(а)">✓</td>'
          : `<td class="mx-no" title="Не был(а)${a.decision ? ' · ' + L.decision[a.decision].toLowerCase() : ''}">✕</td>`;
      };
      const totals = (r) => {
        let yes = 0, no = 0;
        for (const s of slots) {
          const a = (s.lesson?.attendance || []).find((x) => x.enrollment_id === r.enrollment_id);
          if (!a || s.lesson.status !== 'done') continue;
          a.present ? yes++ : no++;
        }
        return { yes, no, pct: yes + no ? Math.round((yes / (yes + no)) * 100) : null };
      };

      box.innerHTML = `
        <div class="cal-head">
          <button class="btn btn-sm" data-month="-1" aria-label="Предыдущий месяц">←</button>
          <b>${L.months[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}</b>
          <button class="btn btn-sm" data-month="1" aria-label="Следующий месяц">→</button>
        </div>
        ${!slots.length || !students.length ? empty(!students.length ? 'В этом месяце учеников не было' : 'В этом месяце уроков нет') : `
        <div class="mx-wrap">
          <table class="mx">
            <thead><tr>
              <th class="mx-name">Ученик</th>
              ${slots.map((s, i) => `<th><button class="mx-day ${s.date === t ? 'mx-today' : ''}" data-slot="${i}" title="Отметить урок">${L.days[Logic.weekday(s.date)]}<br>${s.date.slice(8)}.${s.date.slice(5, 7)}</button></th>`).join('')}
              <th class="mx-sum">Был</th><th class="mx-sum">Пропуск</th><th class="mx-sum">%</th>
            </tr></thead>
            <tbody>${students.map((r) => {
              const tt = totals(r);
              return `<tr>
                <td class="mx-name">${esc(r.student_name)}${r.active ? '' : ' <span class="muted small">(не ходит)</span>'}</td>
                ${slots.map((s) => cell(s, r)).join('')}
                <td class="mx-sum">${tt.yes}</td><td class="mx-sum ${tt.no ? 'bad-text' : ''}">${tt.no}</td>
                <td class="mx-sum">${tt.pct === null ? '—' : tt.pct + '%'}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
        <p class="muted small">✓ был · ✕ не был · ↷ перенос · отм — отмена · — урока не было · ? не отмечен.
          Нажмите на дату вверху, чтобы отметить или изменить урок.</p>`}`;

      $$('[data-month]', box).forEach((b) => b.onclick = () => {
        const [y, mm] = month.split('-').map(Number);
        const d = new Date(y, mm - 1 + Number(b.dataset.month), 1);
        month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        draw();
      });
      $$('[data-slot]', box).forEach((b) => b.onclick = () => TodayPage.openMark(slots[Number(b.dataset.slot)], info, () => { onChange && onChange(); draw(); }));
    }
    draw();
  }

  window.GroupsPage = { render, openMatrix };
})();
