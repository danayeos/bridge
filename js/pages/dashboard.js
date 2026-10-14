// Главная страница администратора: кому пора платить, долги, что нужно решить.
(function () {
  const { L, esc, $$, money, toast, busy, fmtDate, fmtShort, lessonsWord, empty } = UI;

  async function render(root) {
    root.innerHTML = `<div class="loading">Загрузка…</div>`;
    const t = Logic.today();
    const [mFrom, mTo] = Logic.monthRange(t.slice(0, 7));
    const [students, enrollments, classes, courses, teachers, stats, lessons, monthPays] = await Promise.all([
      DB.students(), DB.enrollments(), DB.classes(), DB.courses(), DB.teachers(), DB.stats(),
      DB.lessons(Logic.addDays(t, -90), t), DB.payments(mFrom, mTo),
    ]);
    const studentById = Object.fromEntries(students.map((s) => [s.id, s]));
    const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
    const courseName = Object.fromEntries(courses.map((c) => [c.id, c.name]));
    const teacherName = Object.fromEntries(teachers.map((x) => [x.id, x.full_name]));
    const statBy = Object.fromEntries(stats.map((s) => [s.enrollment_id, s]));
    const enrById = Object.fromEntries(enrollments.map((e) => [e.id, e]));

    const active = enrollments.filter((e) => e.active && studentById[e.student_id]?.active);
    const rows = active.map((e) => {
      const st = statBy[e.id] || { remaining: e.initial_lessons, last_payment: null };
      return { e, st, status: Logic.payStatus(e, st.remaining) };
    });
    const due = rows.filter((r) => r.status === 'due').sort((a, b) => a.st.remaining - b.st.remaining);
    const debt = rows.filter((r) => r.status === 'debt').sort((a, b) => a.st.remaining - b.st.remaining);

    // нужно решить
    const absences = [];
    const teacherFault = [];
    for (const l of lessons) {
      if (l.status === 'done' || l.status === 'cancelled') {
        for (const a of l.attendance || []) {
          if (!a.present && !a.decision && enrById[a.enrollment_id]) absences.push({ l, a });
        }
      }
      if ((l.status === 'rescheduled' || l.status === 'cancelled') && l.caused_by === 'teacher' && !l.reviewed) teacherFault.push(l);
    }

    const income = monthPays.reduce((s, p) => s + p.amount, 0);
    const monthLessons = lessons.filter((l) => l.date >= mFrom && l.status === 'done').length;

    const who = (e) => {
      const c = classById[e.class_id] || {};
      return `<div class="who"><b>${esc(studentById[e.student_id]?.full_name)}</b>
        <span class="muted small">${esc(courseName[c.course_id] || '')} · ${c.kind === 'group' ? esc(c.name || '') : 'индивидуально'}</span></div>`;
    };

    root.innerHTML = `
      <div class="page-head"><h1>Главная</h1><span class="muted">${fmtDate(t, true)}</span></div>

      <div class="tiles">
        <div class="tile"><div class="tile-label">Пора писать об оплате</div><div class="tile-value accent">${due.length}</div></div>
        <div class="tile"><div class="tile-label">Должники</div><div class="tile-value">${debt.length}</div></div>
        <div class="tile"><div class="tile-label">Оплаты за ${L.months[Number(t.slice(5, 7)) - 1].toLowerCase()}</div><div class="tile-value">${money(income)}</div></div>
        <div class="tile"><div class="tile-label">Уроков проведено в этом месяце</div><div class="tile-value">${monthLessons}</div></div>
      </div>

      <section class="section">
        <h2>🔔 Пора написать об оплате <span class="count">${due.length}</span></h2>
        <p class="muted small">Остался 1 урок или пакет закончился — напишите ученику в WhatsApp.</p>
        ${due.length ? `<div class="list">${due.map((r) => `
          <div class="list-row">
            ${who(r.e)}
            <div class="row-meta">
              <span class="badge badge-due">${r.st.remaining === 0 ? 'Уроки закончились' : `Остался ${r.st.remaining} ${lessonsWord(r.st.remaining)}`}</span>
              ${(() => { const u = r.st.remaining > 0 && Logic.paidUntil(classById[r.e.class_id], r.st.remaining, t); return u ? `<span class="small">последний оплаченный урок: <b>${fmtShort(u)}</b></span>` : ''; })()}
              <span class="muted small">${money(r.e.package_price)} / ${r.e.package_lessons} ур.${r.st.last_payment ? ' · посл. оплата ' + fmtDate(r.st.last_payment) : ''}</span>
            </div>
            <button class="btn btn-primary btn-sm" data-pay="${r.e.id}">Оплатил</button>
          </div>`).join('')}</div>` : empty('Пока никому не нужно платить')}
      </section>

      <section class="section">
        <h2>Долги <span class="count">${debt.length}</span></h2>
        <p class="muted small">Уроки идут, а оплаты ещё нет.</p>
        ${debt.length ? `<div class="list">${debt.map((r) => {
          const n = -r.st.remaining;
          const perLesson = r.e.package_lessons ? r.e.package_price / r.e.package_lessons : 0;
          return `
          <div class="list-row">
            ${who(r.e)}
            <div class="row-meta">
              <span class="badge badge-debt">Долг: ${n} ${lessonsWord(n)}</span>
              <span class="muted small">≈ ${money(n * perLesson)}</span>
            </div>
            <button class="btn btn-primary btn-sm" data-pay="${r.e.id}">Оплатил</button>
          </div>`;
        }).join('')}</div>` : empty('Должников нет')}
      </section>

      <section class="section">
        <h2>Пропуски: сгорает или нет? <span class="count">${absences.length}</span></h2>
        ${absences.length ? `<div class="list">${absences.map(({ l, a }) => {
          const e = enrById[a.enrollment_id];
          return `
          <div class="list-row">
            ${who(e)}
            <div class="row-meta">
              <span>${fmtShort(l.date)} ${esc(l.time)}</span>
              <span class="muted small">${l.status === 'cancelled' ? `Отменил ученик · ${esc(L.reason[l.reason] || '')}${l.reason_text ? ': ' + esc(l.reason_text) : ''}` : 'Не пришёл(ла) на урок'}</span>
            </div>
            <div class="btn-group">
              <button class="btn btn-sm btn-danger" data-decide="burned" data-l="${l.id}" data-e="${a.enrollment_id}">Сгорает</button>
              <button class="btn btn-sm" data-decide="moved" data-l="${l.id}" data-e="${a.enrollment_id}">Перенос</button>
            </div>
          </div>`;
        }).join('')}</div>` : empty('Нерешённых пропусков нет')}
      </section>

      <section class="section">
        <h2>Переносы и отмены по вине учителя <span class="count">${teacherFault.length}</span></h2>
        ${teacherFault.length ? `<div class="list">${teacherFault.map((l) => {
          const c = classById[l.class_id] || {};
          return `
          <div class="list-row">
            <div class="who"><b>${esc(teacherName[l.teacher_id] || 'Учитель')}</b>
              <span class="muted small">${esc(c.name || '')}</span></div>
            <div class="row-meta">
              <span>${fmtShort(l.date)} ${esc(l.time)} · ${l.status === 'rescheduled' ? `перенос на ${fmtShort(l.moved_to_date)}` : 'отмена'}</span>
              <span class="muted small">${esc(L.reason[l.reason] || '')}${l.reason_text ? ': ' + esc(l.reason_text) : ''}</span>
            </div>
            <div class="btn-group">
              <input type="number" class="input-sm" min="0" step="500" placeholder="Штраф ₸" data-fine="${l.id}">
              <button class="btn btn-sm btn-primary" data-review="${l.id}">Готово</button>
            </div>
          </div>`;
        }).join('')}</div>` : empty('Всё проверено')}
      </section>`;

    $$('[data-pay]', root).forEach((b) => b.onclick = () => {
      const e = enrById[b.dataset.pay];
      StudentsPage.payModal(e, studentById[e.student_id], classById[e.class_id], () => render(root));
    });
    $$('[data-decide]', root).forEach((b) => b.onclick = () => busy(b, async () => {
      DB.check(await DB.sb.from('attendance').update({ decision: b.dataset.decide })
        .eq('lesson_id', b.dataset.l).eq('enrollment_id', b.dataset.e));
      toast(b.dataset.decide === 'burned' ? 'Урок сгорел' : 'Урок не сгорает');
      render(root);
    }));
    $$('[data-review]', root).forEach((b) => b.onclick = () => busy(b, async () => {
      const input = root.querySelector(`[data-fine="${b.dataset.review}"]`);
      await DB.update('lessons', b.dataset.review, { fine: Number(input.value) || 0, reviewed: true });
      toast('Сохранено');
      render(root);
    }));
  }

  window.DashboardPage = { render };
})();
