// Расписание на день + отметка уроков. Используется и учителем, и администратором.
(function () {
  const { L, esc, $, $$, toast, modal, formData, options, busy, fmtDate, fmtShort, empty } = UI;
  let currentDate = Logic.today();
  let teacherFilter = ''; // только для администратора

  async function render(root, ctx) {
    root.innerHTML = `<div class="loading">Загрузка…</div>`;
    const isAdmin = ctx.role === 'admin';
    const [classes, courses, teachers, roster] = await Promise.all([
      DB.classes(), DB.courses(), isAdmin ? DB.teachers() : Promise.resolve(ctx.teacher ? [ctx.teacher] : []), DB.roster(),
    ]);
    const myClasses = isAdmin
      ? classes.filter((c) => !teacherFilter || c.teacher_id === teacherFilter)
      : classes.filter((c) => ctx.teacher && c.teacher_id === ctx.teacher.id);
    const t = Logic.today();
    const [dayLessons, recent] = await Promise.all([
      DB.lessons(currentDate, currentDate),
      DB.lessons(Logic.addDays(t, -14), Logic.addDays(t, -1)),
    ]);
    const classIds = new Set(myClasses.map((c) => c.id));
    const starts = Logic.classStarts(roster);
    const slots = Logic.lessonsForDate(currentDate, myClasses, dayLessons.filter((l) => classIds.has(l.class_id)), starts);

    // неотмеченные уроки за 2 недели
    const unmarked = [];
    for (let d = Logic.addDays(t, -14); d < t; d = Logic.addDays(d, 1)) {
      for (const s of Logic.lessonsForDate(d, myClasses, recent.filter((l) => l.date === d && classIds.has(l.class_id)), starts)) {
        if (!s.lesson || s.lesson.status === 'planned') unmarked.push(s);
      }
    }

    const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
    const courseName = Object.fromEntries(courses.map((c) => [c.id, c.name]));
    const teacherName = Object.fromEntries(teachers.map((x) => [x.id, x.full_name]));
    const info = { classById, courseName, teacherName, roster, isAdmin };

    root.innerHTML = `
      <div class="page-head">
        <h1>${isAdmin ? 'Расписание' : 'Мои уроки'}</h1>
        ${isAdmin ? `<select id="t-filter" class="input-sm">${options(teachers.map((x) => [x.id, x.full_name]), teacherFilter, { empty: 'Все учителя' })}</select>` : ''}
      </div>
      ${unmarked.length ? `
        <div class="alert">
          <b>Не отмечено уроков: ${unmarked.length}</b>
          <div class="chips">${unmarked.slice(0, 12).map((s) => `
            <button class="chip chip-link" data-go="${s.date}">${fmtShort(s.date)} ${esc(s.time)} · ${esc(classById[s.class_id]?.name || '')}</button>`).join('')}
          </div>
        </div>` : ''}
      <div class="day-nav">
        <button class="btn" data-shift="-1" aria-label="Предыдущий день">←</button>
        <div class="day-title">
          <input type="date" id="day-input" value="${currentDate}">
          <span>${L.daysFull[Logic.weekday(currentDate)]}${currentDate === t ? ' · сегодня' : ''}</span>
        </div>
        <button class="btn" data-shift="1" aria-label="Следующий день">→</button>
        ${currentDate !== t ? `<button class="btn btn-ghost" data-today>Сегодня</button>` : ''}
      </div>
      <div class="cards">
        ${slots.length ? slots.map((s, i) => slotCard(s, i, info)).join('') : empty('В этот день уроков нет')}
      </div>`;

    $$('[data-shift]', root).forEach((b) => b.onclick = () => { currentDate = Logic.addDays(currentDate, Number(b.dataset.shift)); render(root, ctx); });
    const tf = $('#t-filter', root);
    if (tf) tf.onchange = () => { teacherFilter = tf.value; render(root, ctx); };
    $('#day-input', root).onchange = (e) => { if (e.target.value) { currentDate = e.target.value; render(root, ctx); } };
    const todayBtn = $('[data-today]', root);
    if (todayBtn) todayBtn.onclick = () => { currentDate = t; render(root, ctx); };
    $$('[data-go]', root).forEach((b) => b.onclick = () => { currentDate = b.dataset.go; render(root, ctx); });
    $$('[data-mark]', root).forEach((b) => b.onclick = () =>
      openMark(slots[Number(b.dataset.mark)], info, () => render(root, ctx)));
  }

  function slotCard(s, i, info) {
    const c = info.classById[s.class_id] || {};
    const l = s.lesson;
    const students = Logic.rosterFor(s.class_id, s.date, info.roster);
    const att = l && l.attendance ? Object.fromEntries(l.attendance.map((a) => [a.enrollment_id, a])) : {};
    const past = s.date < Logic.today();
    const status = l ? l.status : null;
    const marked = status && status !== 'planned';

    let detail = '';
    if (status === 'rescheduled') {
      detail = `На ${fmtShort(l.moved_to_date)} ${esc(l.moved_to_time || '')} · из-за: ${L.caused[l.caused_by] || '—'} · ${esc(L.reason[l.reason] || '')}${l.reason_text ? ': ' + esc(l.reason_text) : ''}`;
    } else if (status === 'cancelled' && !l.caused_by) {
      detail = 'Урока не было' + (l.comment ? ': ' + esc(l.comment) : '');
    } else if (status === 'cancelled') {
      detail = `Из-за: ${L.caused[l.caused_by] || '—'} · ${esc(L.reason[l.reason] || '')}${l.reason_text ? ': ' + esc(l.reason_text) : ''}`;
    } else if (status === 'planned' && l.origin_id) {
      detail = 'Перенесённый урок';
    }

    return `
      <div class="card lesson-card ${marked ? 'is-' + status : past ? 'is-unmarked' : ''}">
        <div class="lesson-top">
          <div class="lesson-time">${esc(s.time || '—')}</div>
          <div class="lesson-main">
            <div class="lesson-name">${esc(c.name || 'Занятие')}</div>
            <div class="muted small">${esc(info.courseName[c.course_id] || '')} · ${L.kind[c.kind] || ''} · ${L.mode[c.mode] || ''}${info.isAdmin && c.teacher_id ? ' · ' + esc(info.teacherName[c.teacher_id] || '') : ''}</div>
          </div>
          ${status ? `<span class="badge badge-${status}">${UI.lessonStatus(l)}</span>` : past ? `<span class="badge badge-warn">Не отмечен</span>` : ''}
        </div>
        ${detail ? `<div class="lesson-detail">${detail}</div>` : ''}
        <div class="students-line">
          ${students.length ? students.map((r) => {
            const a = att[r.enrollment_id];
            const cls = !a ? '' : a.present ? 'st-present' : 'st-absent';
            const mark = !a ? '' : a.present ? '✓ ' : '✕ ';
            return `<span class="st ${cls}">${mark}${esc(r.student_name)}</span>`;
          }).join('') : '<span class="muted small">Нет учеников</span>'}
        </div>
        <div class="lesson-actions">
          <button class="btn ${marked ? '' : 'btn-primary'}" data-mark="${i}">${marked ? 'Изменить' : 'Отметить'}</button>
        </div>
      </div>`;
  }

  function openMark(slot, info, done) {
    const c = info.classById[slot.class_id] || {};
    const l = slot.lesson;
    const students = Logic.rosterFor(slot.class_id, slot.date, info.roster);
    const att = l && l.attendance ? Object.fromEntries(l.attendance.map((a) => [a.enrollment_id, a.present])) : {};
    const initial = !l || l.status === 'planned' ? 'done' : l.status === 'cancelled' && !l.caused_by ? 'none' : l.status;

    const reasonBlock = (prefix) => `
      <div class="field">
        <label>Из-за кого?</label>
        <div class="seg">
          ${['student', 'teacher'].map((v) => `
            <label><input type="radio" name="${prefix}caused_by" value="${v}" ${l && l.caused_by === v ? 'checked' : ''}><span>${L.caused[v]}</span></label>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>Причина</label>
        <select name="${prefix}reason">${options(Object.entries(L.reason), l?.reason, { empty: 'Выберите…' })}</select>
      </div>
      <div class="field">
        <label>Комментарий к причине</label>
        <input name="${prefix}reason_text" value="${esc(l?.reason_text || '')}" placeholder="Необязательно">
      </div>`;

    const m = modal(`${c.name || 'Урок'} · ${fmtDate(slot.date, true)} ${slot.time || ''}`, `
      <form class="form" id="mark-form">
        <div class="seg seg-big">
          ${[['done', 'Урок прошёл'], ['rescheduled', 'Перенос'], ['cancelled', 'Отмена'], ['none', 'Урока не было']].map(([v, t]) => `
            <label><input type="radio" name="status" value="${v}" ${initial === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}
        </div>

        <div data-part="done">
          <div class="field">
            <label>Кто был на уроке? <span class="muted small">(нажмите, чтобы отметить отсутствие)</span></label>
            ${students.length ? `<div class="att-list">
              ${students.map((r) => `
                <label class="att-item">
                  <input type="checkbox" name="att_${r.enrollment_id}" ${att[r.enrollment_id] === false ? '' : 'checked'}>
                  <span class="att-box"></span>
                  <span>${esc(r.student_name)}</span>
                </label>`).join('')}
            </div>` : `<div class="muted">В этом занятии нет учеников</div>`}
          </div>
        </div>

        <div data-part="rescheduled">
          <div class="row2">
            <div class="field"><label>Новая дата</label><input type="date" name="moved_to_date" value="${esc(l?.moved_to_date || '')}"></div>
            <div class="field"><label>Время</label><input type="time" name="moved_to_time" value="${esc(l?.moved_to_time || slot.time || '')}"></div>
          </div>
          ${reasonBlock('r_')}
        </div>

        <div data-part="cancelled">
          ${reasonBlock('c_')}
          <p class="muted small">Если отменил ученик — администратор решит, сгорает урок или нет.</p>
        </div>

        <div data-part="none">
          <p class="muted small">Например, расписание тогда было другим, праздник или каникулы. Урок не считается ни ученику, ни учителю.</p>
        </div>

        <div class="field">
          <label>Комментарий</label>
          <input name="comment" value="${esc(l?.comment || '')}" placeholder="Необязательно">
        </div>
        <div class="form-actions">
          ${l && info.isAdmin ? '<button type="button" class="btn btn-danger" data-unmark>Удалить отметку</button>' : ''}
          <button type="button" class="btn" data-close>Отмена</button>
          <button type="submit" class="btn btn-primary">Сохранить</button>
        </div>
      </form>`);

    const form = $('#mark-form', m.el);
    const sync = () => {
      const st = form.querySelector('[name=status]:checked').value;
      $$('[data-part]', form).forEach((p) => p.hidden = p.dataset.part !== st);
    };
    $$('[name=status]', form).forEach((r) => r.onchange = sync);
    sync();

    const unmark = $('[data-unmark]', m.el);
    if (unmark) unmark.onclick = () => busy(unmark, async () => {
      DB.check(await DB.sb.from('lessons').delete().eq('origin_id', l.id).eq('status', 'planned'));
      await DB.remove('lessons', l.id);
      m.close(); toast('Отметка удалена'); done();
    });

    form.onsubmit = (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      busy(btn, async () => {
        const f = formData(form);
        const data = { status: f.status, comment: f.comment };
        if (f.status === 'none') {
          data.status = 'cancelled';
        } else if (f.status === 'done') {
          data.attendance = students.map((r) => ({ enrollment_id: r.enrollment_id, present: !!f['att_' + r.enrollment_id] }));
        } else {
          const p = f.status === 'rescheduled' ? 'r_' : 'c_';
          data.caused_by = f[p + 'caused_by'];
          data.reason = f[p + 'reason'];
          data.reason_text = f[p + 'reason_text'];
          if (!data.caused_by) throw new Error('Укажите, из-за кого');
          if (!data.reason) throw new Error('Укажите причину');
          if (data.reason === 'other' && !data.reason_text) throw new Error('Напишите причину в комментарии');
          if (f.status === 'rescheduled') {
            if (!f.moved_to_date) throw new Error('Укажите новую дату');
            data.moved_to_date = f.moved_to_date;
            data.moved_to_time = f.moved_to_time;
          }
          // отмена по вине ученика: урок может сгореть — отмечаем всех как отсутствующих
          if (f.status === 'cancelled' && data.caused_by === 'student') {
            data.attendance = students.map((r) => ({ enrollment_id: r.enrollment_id, present: false }));
          }
        }
        await DB.saveLesson(slot, data);
        m.close();
        toast('Сохранено');
        done();
      });
    };
  }

  window.TodayPage = { render, openMark, setDate: (d) => { currentDate = d; } };
})();
