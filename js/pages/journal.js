// Журнал уроков: все отметки за период, правки администратора.
(function () {
  const { L, esc, $, $$, money, toast, modal, confirmBox, formData, options, busy, fmtShort, empty } = UI;
  const f = { from: null, to: null, teacher: '', cls: '', status: '' };

  async function render(root) {
    if (!f.from) { const t = Logic.today(); f.from = Logic.addDays(t, -30); f.to = t; }
    root.innerHTML = `<div class="loading">Загрузка…</div>`;
    const [lessons, classes, teachers, roster] = await Promise.all([
      DB.lessons(f.from, f.to), DB.classes(), DB.teachers(), DB.roster(),
    ]);
    const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
    const teacherName = Object.fromEntries(teachers.map((t) => [t.id, t.full_name]));
    const nameByEnr = Object.fromEntries(roster.map((r) => [r.enrollment_id, r.student_name]));

    const list = lessons.filter((l) =>
      (!f.teacher || l.teacher_id === f.teacher) &&
      (!f.cls || l.class_id === f.cls) &&
      (!f.status || (f.status === 'teacher' ? l.caused_by === 'teacher' && l.status !== 'done' : l.status === f.status)))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || ''));

    root.innerHTML = `
      <div class="page-head"><h1>Журнал уроков</h1></div>
      <div class="toolbar">
        <label class="inline">с <input type="date" id="j-from" value="${f.from}"></label>
        <label class="inline">по <input type="date" id="j-to" value="${f.to}"></label>
        <select id="j-teacher">${options(teachers.map((t) => [t.id, t.full_name]), f.teacher, { empty: 'Все учителя' })}</select>
        <select id="j-cls">${options(classes.map((c) => [c.id, c.name]), f.cls, { empty: 'Все занятия' })}</select>
        <select id="j-status">${options([
          ['done', 'Прошёл'], ['rescheduled', 'Перенесён'], ['cancelled', 'Отменён'], ['planned', 'Ожидает (перенос)'], ['teacher', 'По вине учителя'],
        ], f.status, { empty: 'Все статусы' })}</select>
      </div>
      <p class="muted small">Уроков: ${list.length}. Нажмите на урок, чтобы поправить оплату учителю, штраф или решение по пропуску.</p>
      ${list.length ? `<div class="table-wrap"><table class="table table-hover">
        <thead><tr><th>Дата</th><th>Занятие</th><th>Учитель</th><th>Статус</th><th>Ученики</th><th class="num">Учителю</th><th class="num">Штраф</th></tr></thead>
        <tbody>${list.map((l) => {
          const c = classById[l.class_id] || {};
          const paid = Logic.teacherPaid(l);
          const extra = l.status === 'rescheduled' ? `→ ${fmtShort(l.moved_to_date)}` : '';
          const why = l.caused_by ? `<div class="muted small">${L.caused[l.caused_by]}: ${esc(L.reason[l.reason] || '')}${l.reason_text ? ' — ' + esc(l.reason_text) : ''}</div>` : '';
          return `<tr data-open="${l.id}">
            <td class="nowrap">${fmtShort(l.date)} <span class="muted">${esc(l.time)}</span></td>
            <td>${esc(c.name || '')}</td>
            <td>${esc(teacherName[l.teacher_id] || '')}</td>
            <td><span class="badge badge-${l.status}">${L.status[l.status]}</span> ${extra}${why}</td>
            <td class="small">${(l.attendance || []).map((a) =>
              `<span class="${a.present ? 'ok-text' : 'bad-text'}">${a.present ? '✓' : '✕'} ${esc(nameByEnr[a.enrollment_id] || '')}${!a.present ? ` <span class="muted">(${a.decision ? L.decision[a.decision].toLowerCase() : 'ждёт решения'})</span>` : ''}</span>`).join('<br>')}</td>
            <td class="num ${paid ? '' : 'muted strike'}">${money(l.rate)}</td>
            <td class="num ${l.fine ? 'bad-text' : 'muted'}">${l.fine ? money(l.fine) : '—'}</td>
          </tr>`;
        }).join('')}</tbody></table></div>` : empty('За этот период уроков нет')}`;

    const re = () => render(root);
    $('#j-from', root).onchange = (e) => { f.from = e.target.value || f.from; re(); };
    $('#j-to', root).onchange = (e) => { f.to = e.target.value || f.to; re(); };
    $('#j-teacher', root).onchange = (e) => { f.teacher = e.target.value; re(); };
    $('#j-cls', root).onchange = (e) => { f.cls = e.target.value; re(); };
    $('#j-status', root).onchange = (e) => { f.status = e.target.value; re(); };
    $$('[data-open]', root).forEach((tr) => tr.onclick = () =>
      editLesson(lessons.find((l) => l.id === tr.dataset.open), { classById, teachers, nameByEnr }, re));
  }

  function editLesson(l, ctx, done) {
    const c = ctx.classById[l.class_id] || {};
    const paidSel = l.teacher_paid === null ? '' : String(l.teacher_paid);
    const m = modal(`${c.name || 'Урок'} · ${fmtShort(l.date)} ${l.time}`, `
      <form class="form">
        <p><span class="badge badge-${l.status}">${L.status[l.status]}</span>
          ${l.caused_by ? ` · из-за: ${L.caused[l.caused_by]} · ${esc(L.reason[l.reason] || '')} ${esc(l.reason_text || '')}` : ''}</p>
        <div class="row2">
          <div class="field"><label>Учитель, который вёл</label>
            <select name="teacher_id">${options(ctx.teachers.map((t) => [t.id, t.full_name]), l.teacher_id, { empty: '—' })}</select></div>
          <div class="field"><label>Оплата учителю за урок, ₸</label><input type="number" name="rate" min="0" step="500" value="${l.rate}"></div>
        </div>
        <div class="row2">
          <div class="field"><label>Платить учителю за этот урок?</label>
            <select name="teacher_paid">${options([['', `Как обычно (${l.status === 'done' ? 'да' : 'нет'})`], ['true', 'Да'], ['false', 'Нет']], paidSel)}</select></div>
          <div class="field"><label>Штраф учителю, ₸</label><input type="number" name="fine" min="0" step="500" value="${l.fine || 0}"></div>
        </div>
        ${(l.attendance || []).filter((a) => !a.present).map((a) => `
          <div class="field"><label>Пропуск: ${esc(ctx.nameByEnr[a.enrollment_id] || '')}</label>
            <select name="dec_${a.enrollment_id}">${options([['burned', 'Урок сгорает'], ['moved', 'Не сгорает (перенос)']], a.decision, { empty: 'Ещё не решили' })}</select></div>`).join('')}
        <div class="field"><label>Комментарий</label><input name="comment" value="${esc(l.comment || '')}"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-danger" data-del>Удалить отметку</button>
          <button type="button" class="btn" data-remark>Перенос / отмена…</button>
          <button type="button" class="btn" data-close>Отмена</button>
          <button type="submit" class="btn btn-primary">Сохранить</button>
        </div>
      </form>`);
    const form = $('form', m.el);
    form.onsubmit = (ev) => {
      ev.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const v = formData(form);
        await DB.update('lessons', l.id, {
          teacher_id: v.teacher_id || null,
          rate: v.rate || 0,
          teacher_paid: v.teacher_paid === '' ? null : v.teacher_paid === 'true',
          fine: v.fine || 0,
          comment: v.comment || null,
          reviewed: true,
        });
        for (const a of (l.attendance || []).filter((x) => !x.present)) {
          const d = v['dec_' + a.enrollment_id] || null;
          if (d !== a.decision) {
            DB.check(await DB.sb.from('attendance').update({ decision: d }).eq('lesson_id', l.id).eq('enrollment_id', a.enrollment_id));
          }
        }
        m.close(); toast('Сохранено'); done();
      });
    };
    // изменить саму отметку (прошёл / перенос / отмена) — в расписании на дату урока
    $('[data-remark]', m.el).onclick = () => { m.close(); TodayPage.setDate(l.date); location.hash = '#/today'; };
    $('[data-del]', m.el).onclick = async (ev) => {
      if (!(await confirmBox('Удалить отметку урока? Урок снова станет «не отмеченным», посещаемость удалится.'))) return;
      await busy(ev.target, async () => {
        DB.check(await DB.sb.from('lessons').delete().eq('origin_id', l.id).eq('status', 'planned'));
        await DB.remove('lessons', l.id);
        m.close(); toast('Удалено'); done();
      });
    };
  }

  window.JournalPage = { render };
})();
