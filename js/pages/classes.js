// Группы и индивидуальные занятия: расписание, учитель, оплата учителю.
(function () {
  const { L, esc, $, $$, money, toast, modal, confirmBox, options, busy, schedText, empty } = UI;
  let tab = 'group';

  async function render(root) {
    root.innerHTML = `<div class="loading">Загрузка…</div>`;
    const [classes, courses, teachers, roster] = await Promise.all([DB.classes(), DB.courses(), DB.teachers(), DB.roster()]);
    const ctx = {
      classes, courses, teachers,
      courseName: Object.fromEntries(courses.map((c) => [c.id, c.name])),
      teacherName: Object.fromEntries(teachers.map((t) => [t.id, t.full_name])),
    };
    // индивидуальные занятия, где не осталось ни одного ученика
    const orphans = classes.filter((c) => c.kind === 'individual' && !roster.some((r) => r.class_id === c.id));
    const list = classes.filter((c) => c.kind === tab).sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));

    root.innerHTML = `
      <div class="page-head">
        <h1>Группы и расписание</h1>
        <div class="btn-group">
          <button class="btn" id="bulk">Внести прошлые уроки</button>
          <button class="btn btn-primary" id="add-cls">+ Новая группа</button>
        </div>
      </div>
      <div class="tabs">
        <button class="tab ${tab === 'group' ? 'active' : ''}" data-tab="group">Группы</button>
        <button class="tab ${tab === 'individual' ? 'active' : ''}" data-tab="individual">Индивидуальные</button>
      </div>
      ${tab === 'individual' ? `<p class="muted small">Индивидуальные занятия создаются в карточке ученика («Добавить курс»). Здесь можно поменять расписание, учителя и оплату учителю.</p>
        ${orphans.length ? `<div class="alert">Занятий без учеников: <b>${orphans.length}</b> (ученика или курс удалили). <button class="btn btn-sm btn-danger" id="del-orphans">Удалить их</button></div>` : ''}` : ''}
      <div class="cards">
        ${list.length ? list.map((c) => {
          const st = roster.filter((r) => r.class_id === c.id && r.active);
          return `
          <button class="card card-btn ${c.active ? '' : 'is-off'}" data-edit="${c.id}">
            <div class="lesson-top">
              <div class="lesson-main">
                <div class="lesson-name">${esc(c.name)}</div>
                <div class="muted small">${esc(ctx.courseName[c.course_id] || '')} · ${L.mode[c.mode]} · ${esc(ctx.teacherName[c.teacher_id] || 'без учителя')}</div>
              </div>
              ${c.active ? '' : '<span class="badge">Архив</span>'}
            </div>
            <div class="small">🗓 ${schedText(c.schedule)}</div>
            <div class="small muted">Учителю за урок: ${money(c.teacher_rate)}</div>
            <div class="students-line">${st.length ? st.map((r) => `<span class="st">${esc(r.student_name)}</span>`).join('') : '<span class="muted small">Нет учеников</span>'}</div>
          </button>`;
        }).join('') : empty(tab === 'group' ? 'Групп пока нет' : 'Индивидуальных занятий пока нет')}
      </div>`;

    $$('[data-tab]', root).forEach((b) => b.onclick = () => { tab = b.dataset.tab; render(root); });
    $('#bulk', root).onclick = () => bulkMark(null);
    const delOrphans = $('#del-orphans', root);
    if (delOrphans) delOrphans.onclick = async () => {
      if (!(await confirmBox(`Удалить ${orphans.length} занятий без учеников вместе с их уроками?`))) return;
      await busy(delOrphans, async () => {
        DB.check(await DB.sb.from('classes').delete().in('id', orphans.map((c) => c.id)));
        toast('Удалено'); render(root);
      });
    };
    $('#add-cls', root).onclick = () => editClass(null, ctx, () => render(root));
    $$('[data-edit]', root).forEach((b) => b.onclick = () => editClass(classes.find((c) => c.id === b.dataset.edit), ctx, () => render(root)));
  }

  // Поля занятия (используются и в карточке ученика)
  function classFields(c, ctx, { individual = false } = {}) {
    const t = Logic.today();
    const cur = Logic.currentSchedule(c?.schedule, t);
    const sched = cur.length ? cur : [{ day: 1, time: '16:00' }];
    const past = (c?.schedule || []).filter((s) => s.to && s.to < t);
    return `
      <div class="field"><label>${individual ? 'Название <span class="muted small">(необязательно)</span>' : 'Название группы'}</label>
        <input name="cls_name" value="${esc(c?.name || '')}" ${individual ? 'placeholder="Например: Ясина — математика"' : 'placeholder="Например: IELTS вечер" required'}></div>
      <div class="row2">
        <div class="field"><label>Курс</label>
          <select name="cls_course" required>${options(ctx.courses.map((x) => [x.id, x.name]), c?.course_id, { empty: 'Выберите…' })}</select></div>
        <div class="field"><label>Учитель</label>
          <select name="cls_teacher">${options(ctx.teachers.filter((t) => t.active || t.id === c?.teacher_id).map((t) => [t.id, t.full_name]), c?.teacher_id, { empty: 'Не выбран' })}</select></div>
      </div>
      <div class="row2">
        <div class="field"><label>Формат</label>
          <div class="seg">
            <label><input type="radio" name="cls_mode" value="offline" ${c?.mode !== 'online' ? 'checked' : ''}><span>Офлайн</span></label>
            <label><input type="radio" name="cls_mode" value="online" ${c?.mode === 'online' ? 'checked' : ''}><span>Онлайн</span></label>
          </div></div>
        <div class="field"><label>Учителю за 1 урок, ₸</label>
          <input type="number" name="cls_rate" min="0" step="500" value="${c?.teacher_rate ?? ''}" placeholder="5000"></div>
      </div>
      ${c && (c.rate_history || []).length ? `<div class="muted small">История ставок: ${rateHistoryText(c.rate_history)}</div>` : ''}
      ${c ? `
      <div class="field sched-from" data-rate-when hidden><label>Ставка изменилась — что случилось?</label>
        <div class="seg">
          <label><input type="radio" name="cls_rate_mode" value="change" checked><span>Повысили / понизили с даты</span></label>
          <label><input type="radio" name="cls_rate_mode" value="fix"><span>Исправляю ошибку</span></label>
        </div>
        <div data-rate-hint="change">
          <label class="small">С какой даты новая ставка?</label>
          <input type="date" name="cls_rate_from" value="${Logic.today()}">
          <span class="muted small">Уроки до этой даты — по старой ставке, с этой даты — по новой.</span>
        </div>
        <span class="muted small" data-rate-hint="fix" hidden>Новая ставка будет для <b>всех</b> уроков этого занятия, и прошлых тоже.</span>
      </div>` : ''}
      <div class="field"><label>Расписание</label>
        <div class="sched" data-sched>${sched.map(schedRow).join('')}</div>
        <button type="button" class="btn btn-sm btn-ghost" data-add-slot>+ Добавить день</button>
        ${past.length ? `<span class="muted small">Раньше: ${past.map((s) => `${L.days[s.day]} ${esc(s.time)}${s.from ? ' с ' + UI.fmtDate(s.from) : ''} до ${UI.fmtDate(s.to)}`).join('; ')}</span>` : ''}
      </div>
      ${c ? `
      <div class="field sched-from"><label>Если меняете расписание — что случилось?</label>
        <div class="seg">
          <label><input type="radio" name="cls_sched_mode" value="fix" checked><span>Исправляю ошибку</span></label>
          <label><input type="radio" name="cls_sched_mode" value="change"><span>Расписание поменялось</span></label>
        </div>
        <span class="muted small" data-mode-hint="fix">Расписание будет считаться таким <b>с самого начала</b> (и для прошлых уроков).</span>
        <div data-mode-hint="change" hidden>
          <label class="small">С какой даты новое расписание?</label>
          <input type="date" name="cls_sched_from" value="${t}">
          <span class="muted small">До этой даты уроки считаются по старому расписанию, с этой — по новому.</span>
        </div></div>` : ''}`;
  }

  function rateHistoryText(h) {
    return [...h].sort((a, b) => a.from.localeCompare(b.from))
      .map((x) => `${money(x.rate)} ${x.from <= '2000-01-01' ? 'сначала' : 'с ' + UI.fmtDate(x.from)}`).join(' → ');
  }

  // Ставка на дату по истории
  function rateOn(h, d, fallback) {
    const hit = [...h].filter((x) => x.from <= d).sort((a, b) => b.from.localeCompare(a.from))[0];
    return hit ? hit.rate : fallback;
  }

  function schedRow(s) {
    return `
      <div class="sched-row">
        <select data-day>${options(L.daysFull.slice(1).map((d, i) => [i + 1, d]), s.day)}</select>
        <input type="time" data-time value="${esc(s.time)}">
        <button type="button" class="icon-btn" data-del-slot aria-label="Убрать">✕</button>
      </div>`;
  }

  function bindSchedule(form) {
    const box = $('[data-sched]', form);
    if (!box) return;
    $('[data-add-slot]', form).onclick = () => {
      const last = $$('.sched-row', box).pop();
      box.insertAdjacentHTML('beforeend', schedRow({ day: 3, time: last ? $('[data-time]', last).value : '16:00' }));
    };
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-del-slot]')) e.target.closest('.sched-row').remove();
    });
  }

  function readClass(form, { kind, defaultName = '' }) {
    const f = UI.formData(form);
    if (!f.cls_course) throw new Error('Выберите курс');
    const schedule = $$('.sched-row', form)
      .map((r) => ({ day: Number($('[data-day]', r).value), time: $('[data-time]', r).value }))
      .filter((s) => s.time);
    const courseName = form.querySelector('[name=cls_course] option:checked')?.textContent || '';
    return {
      name: f.cls_name || (defaultName ? `${defaultName} — ${courseName}` : courseName),
      course_id: Number(f.cls_course),
      teacher_id: f.cls_teacher || null,
      mode: f.cls_mode || 'offline',
      teacher_rate: f.cls_rate || 0,
      schedule,
      kind,
    };
  }

  function editClass(c, ctx, done) {
    const m = modal(c ? c.name : 'Новая группа', `
      <form class="form">
        ${classFields(c, ctx, { individual: c?.kind === 'individual' })}
        ${c ? `<label class="check"><input type="checkbox" name="cls_active" ${c.active ? 'checked' : ''}> Занятие идёт (снимите, чтобы убрать в архив)</label>` : ''}
        ${c ? `<p class="muted small">Новая ставка учителю действует для новых отметок. Старые уроки можно поправить в «Журнале».</p>` : ''}
        <div class="form-actions">
          ${c ? `<button type="button" class="btn btn-danger" data-del>Удалить</button>` : ''}
          ${c ? `<button type="button" class="btn" data-cal>📅 Календарь</button>` : ''}
          ${c ? `<button type="button" class="btn" data-bulk>Прошлые уроки</button>` : ''}
          <button type="button" class="btn" data-close>Отмена</button>
          <button type="submit" class="btn btn-primary">Сохранить</button>
        </div>
      </form>`, { wide: true });
    const form = $('form', m.el);
    bindSchedule(form);
    $$('[name=cls_sched_mode]', form).forEach((r) => r.onchange = () =>
      $$('[data-mode-hint]', form).forEach((h) => h.hidden = h.dataset.modeHint !== r.value));
    const rateInput = form.querySelector('[name=cls_rate]');
    const rateWhen = $('[data-rate-when]', form);
    if (c && rateWhen) {
      rateInput.oninput = () => { rateWhen.hidden = Number(rateInput.value || 0) === c.teacher_rate; };
      $$('[name=cls_rate_mode]', form).forEach((r) => r.onchange = () =>
        $$('[data-rate-hint]', form).forEach((h) => h.hidden = h.dataset.rateHint !== r.value));
    }
    const cal = $('[data-cal]', m.el);
    if (cal) cal.onclick = () => { m.close(); CalendarPage.open(c.id, done); };
    const bulk = $('[data-bulk]', m.el);
    if (bulk) bulk.onclick = () => { m.close(); bulkMark(c.id, done); };
    form.onsubmit = (ev) => {
      ev.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const row = readClass(form, { kind: c ? c.kind : 'group' });
        if (c) {
          row.active = form.cls_active.checked;
          // «исправляю ошибку» — новое расписание действует всегда; «поменялось» — с выбранной даты
          if (form.querySelector('[name=cls_sched_mode]:checked').value === 'change') {
            row.schedule = Logic.mergeSchedule(c.schedule, row.schedule, form.cls_sched_from.value || Logic.today());
          }
        }
        let rateFrom = null; // с какой даты пересчитать ставку у уже отмеченных уроков
        if (c && row.teacher_rate !== c.teacher_rate) {
          if (form.querySelector('[name=cls_rate_mode]:checked').value === 'fix') {
            if ((c.rate_history || []).length) row.rate_history = [];
            rateFrom = '2000-01-01';
          } else {
            rateFrom = form.cls_rate_from.value || Logic.today();
            const base = (c.rate_history || []).length ? c.rate_history : [{ from: '2000-01-01', rate: c.teacher_rate }];
            row.rate_history = [...base.filter((x) => x.from < rateFrom), { from: rateFrom, rate: row.teacher_rate }];
            row.teacher_rate = rateOn(row.rate_history, Logic.today(), row.teacher_rate);
          }
        }
        c ? await DB.update('classes', c.id, row) : await DB.insert('classes', row);
        if (rateFrom) {
          const newRate = row.rate_history ? rateOn(row.rate_history, rateFrom, row.teacher_rate) : row.teacher_rate;
          DB.check(await DB.sb.from('lessons').update({ rate: newRate }).eq('class_id', c.id).gte('date', rateFrom));
        }
        m.close(); toast('Сохранено'); done();
      });
    };
    const del = $('[data-del]', m.el);
    if (del) del.onclick = async () => {
      if (!(await confirmBox('Удалить занятие вместе со всеми уроками, учениками в нём и их оплатами? Обычно лучше убрать в архив.'))) return;
      await busy(del, async () => { await DB.remove('classes', c.id); m.close(); toast('Удалено'); done(); });
    };
  }

  // ---------- Внести прошлые уроки разом (для старых данных) ----------
  // onlyClassId — только одно занятие; иначе все активные
  async function bulkMark(onlyClassId, done) {
    const [classes, roster] = await Promise.all([DB.classes(), DB.roster()]);
    const list = classes.filter((c) => c.active && (!onlyClassId || c.id === onlyClassId));
    const starts = Logic.classStarts(roster);
    const yesterday = Logic.addDays(Logic.today(), -1);
    const earliest = list.map((c) => starts[c.id]).filter(Boolean).sort()[0] || Logic.addDays(yesterday, -30);
    let from = earliest < yesterday ? earliest : yesterday;
    let to = yesterday;

    const m = modal(onlyClassId ? `Прошлые уроки · ${list[0]?.name || ''}` : 'Внести прошлые уроки', `
      <div class="form">
        <p class="muted small">Отметьте уроки, которые прошли. Все ученики будут отмечены как «был».
          Пропуски, переносы и отмены потом поправьте в «Расписании» (выберите дату) или в «Журнале».</p>
        <div class="row2">
          <div class="field"><label>С</label><input type="date" name="from" value="${from}"></div>
          <div class="field"><label>По</label><input type="date" name="to" value="${to}"></div>
        </div>
        <div data-list><div class="loading">Загрузка…</div></div>
        <div class="form-actions">
          <button type="button" class="btn" data-close>Закрыть</button>
          <button type="button" class="btn btn-primary" data-save disabled>Сохранить</button>
        </div>
      </div>`, { wide: true });

    let slots = [];
    const box = $('[data-list]', m.el);
    const saveBtn = $('[data-save]', m.el);
    const classById = Object.fromEntries(classes.map((c) => [c.id, c]));

    async function load() {
      box.innerHTML = `<div class="loading">Загрузка…</div>`;
      if (from > to) { box.innerHTML = empty('Дата «с» позже даты «по»'); return; }
      const lessons = await DB.lessons(from, to);
      slots = [];
      for (let d = from; d <= to; d = Logic.addDays(d, 1)) {
        for (const s of Logic.lessonsForDate(d, list, lessons.filter((l) => l.date === d), starts)) {
          if (!classById[s.class_id] || (onlyClassId && s.class_id !== onlyClassId)) continue;
          slots.push({ ...s, students: Logic.rosterFor(s.class_id, d, roster) });
        }
      }
      const todo = slots.filter((s) => !s.lesson);
      saveBtn.disabled = !todo.length;
      saveBtn.textContent = `Отметить как прошедшие (${todo.length})`;
      if (!slots.length) { box.innerHTML = empty('В этот период по расписанию уроков нет. Проверьте расписание и дату начала у учеников.'); return; }
      box.innerHTML = `
        ${todo.length ? `<label class="check"><input type="checkbox" data-all checked> <b>Выбрать все</b></label>` : ''}
        <div class="bulk-list">${slots.map((s, i) => `
          <label class="bulk-row ${s.lesson ? 'is-off' : ''}">
            <input type="checkbox" data-i="${i}" ${s.lesson ? 'disabled' : 'checked'}>
            <span class="nowrap">${UI.fmtShort(s.date)} ${esc(s.time)}</span>
            <span>${esc(classById[s.class_id].name)}</span>
            <span class="muted small">${s.lesson ? 'уже отмечен: ' + L.status[s.lesson.status].toLowerCase() : s.students.map((r) => esc(r.student_name)).join(', ') || 'нет учеников'}</span>
          </label>`).join('')}</div>`;
      const all = $('[data-all]', box);
      const count = () => {
        const n = $$('[data-i]:checked', box).length;
        saveBtn.textContent = `Отметить как прошедшие (${n})`;
        saveBtn.disabled = !n;
      };
      if (all) all.onchange = () => { $$('[data-i]:not(:disabled)', box).forEach((c) => c.checked = all.checked); count(); };
      $$('[data-i]', box).forEach((c) => c.onchange = count);
    }

    $('[name=from]', m.el).onchange = (e) => { if (e.target.value) { from = e.target.value; load(); } };
    $('[name=to]', m.el).onchange = (e) => { if (e.target.value) { to = e.target.value; load(); } };
    saveBtn.onclick = async () => {
      await busy(saveBtn, async () => {
        const chosen = $$('[data-i]:checked', box).map((c) => slots[Number(c.dataset.i)]).filter((s) => !s.lesson);
        for (let k = 0; k < chosen.length; k += 200) {
          const part = chosen.slice(k, k + 200);
          const rows = DB.check(await DB.sb.from('lessons')
            .insert(part.map((s) => ({ class_id: s.class_id, date: s.date, time: s.time, status: 'done' })))
            .select('id, class_id, date, time'));
          const att = [];
          for (const l of rows) {
            for (const r of Logic.rosterFor(l.class_id, l.date, roster)) att.push({ lesson_id: l.id, enrollment_id: r.enrollment_id, present: true });
          }
          if (att.length) DB.check(await DB.sb.from('attendance').insert(att));
        }
        toast(`Отмечено уроков: ${chosen.length}`);
        done && done();
      });
      load();
    };
    load();
  }

  window.ClassesPage = { render, classFields, bindSchedule, readClass, bulkMark, editClass };
})();
