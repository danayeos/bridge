// Ученики: список, карточка ученика, курсы ученика, оплаты.
(function () {
  const { L, esc, $, $$, money, toast, modal, confirmBox, formData, options, busy, fmtDate, fmtShort, schedText, lessonsWord, empty } = UI;
  let filter = { q: '', status: '' };

  async function render(root) {
    root.innerHTML = `<div class="loading">Загрузка…</div>`;
    const [students, enrollments, classes, courses, teachers, stats] = await Promise.all([
      DB.students(), DB.enrollments(), DB.classes(), DB.courses(), DB.teachers(), DB.stats(),
    ]);
    const ctx = makeCtx({ students, enrollments, classes, courses, teachers, stats });

    const draw = () => {
      const q = filter.q.toLowerCase();
      const list = students.filter((s) => {
        if (q && !s.full_name.toLowerCase().includes(q)) return false;
        const ens = ctx.enrOf(s.id);
        if (filter.status === 'inactive') return !s.active;
        if (!s.active) return false;
        if (filter.status) return ens.some((e) => e.active && ctx.status(e) === filter.status);
        return true;
      });
      $('#st-list', root).innerHTML = list.length ? list.map((s) => row(s, ctx)).join('') : empty('Учеников не найдено');
      $$('[data-open]', root).forEach((el) => el.onclick = () => openStudent(el.dataset.open, () => render(root)));
    };

    root.innerHTML = `
      <div class="page-head">
        <h1>Ученики</h1>
        <button class="btn btn-primary" id="add-st">+ Новый ученик</button>
      </div>
      <div class="toolbar">
        <input type="search" id="st-q" placeholder="Поиск по имени" value="${esc(filter.q)}">
        <select id="st-status">${options([
          ['due', 'Пора платить'], ['debt', 'Должники'], ['ok', 'Оплачено'], ['support', 'Сопровождение'], ['inactive', 'Архив'],
        ], filter.status, { empty: 'Все активные' })}</select>
      </div>
      <div class="list" id="st-list"></div>`;
    $('#st-q', root).oninput = (e) => { filter.q = e.target.value; draw(); };
    $('#st-status', root).onchange = (e) => { filter.status = e.target.value; draw(); };
    $('#add-st', root).onclick = () => editStudent(null, (s) => openStudent(s.id, () => render(root)));
    draw();
  }

  function makeCtx({ students, enrollments, classes, courses, teachers, stats }) {
    const statBy = Object.fromEntries(stats.map((s) => [s.enrollment_id, s]));
    const ctx = {
      students, enrollments, classes, courses, teachers,
      classById: Object.fromEntries(classes.map((c) => [c.id, c])),
      courseName: Object.fromEntries(courses.map((c) => [c.id, c.name])),
      teacherName: Object.fromEntries(teachers.map((t) => [t.id, t.full_name])),
      remaining: (e) => (statBy[e.id] ? statBy[e.id].remaining : e.initial_lessons),
      stat: (e) => statBy[e.id] || { paid_lessons: e.initial_lessons, used_lessons: 0, remaining: e.initial_lessons },
      enrOf: (sid) => enrollments.filter((e) => e.student_id === sid),
    };
    ctx.status = (e) => Logic.payStatus(e, ctx.remaining(e));
    return ctx;
  }

  function statusBadge(e, ctx) {
    const r = ctx.remaining(e);
    const st = ctx.status(e);
    if (st === 'support') return `<span class="badge badge-support">Сопровождение · ${r} ур.</span>`;
    if (st === 'debt') return `<span class="badge badge-debt">Долг ${-r} ${lessonsWord(-r)}</span>`;
    // прогресс внутри текущего пакета: «прошло 5 из 8»
    const pkg = e.package_lessons;
    const prog = r >= 0 && r <= pkg ? `прошло ${pkg - r} из ${pkg} · ` : '';
    if (st === 'due') return `<span class="badge badge-due">${prog}осталось ${r}</span>`;
    return `<span class="badge badge-ok">${prog}осталось ${r}</span>`;
  }

  function row(s, ctx) {
    const ens = ctx.enrOf(s.id).filter((e) => e.active);
    return `
      <button class="list-row list-row-btn" data-open="${s.id}">
        <div class="who"><b>${esc(s.full_name)}</b>${s.note ? `<span class="muted small">${esc(s.note)}</span>` : ''}</div>
        <div class="enr-chips">
          ${ens.length ? ens.map((e) => {
            const c = ctx.classById[e.class_id] || {};
            return `<span class="enr-chip"><span>${esc(ctx.courseName[c.course_id] || '')}</span> ${statusBadge(e, ctx)}</span>`;
          }).join('') : '<span class="muted small">Нет курсов</span>'}
        </div>
      </button>`;
  }

  // ---------- карточка ученика ----------
  async function openStudent(id, onChange) {
    const [students, enrollments, classes, courses, teachers, stats] = await Promise.all([
      DB.students(), DB.enrollments(), DB.classes(), DB.courses(), DB.teachers(), DB.stats(),
    ]);
    const ctx = makeCtx({ students, enrollments, classes, courses, teachers, stats });
    const s = students.find((x) => x.id === id);
    if (!s) return;
    const ens = ctx.enrOf(id);
    const ids = ens.map((e) => e.id);
    const [pays, att] = ids.length ? await Promise.all([DB.paymentsOf(ids), DB.attendanceOf(ids)]) : [[], []];
    att.sort((a, b) => (b.lessons?.date || '').localeCompare(a.lessons?.date || ''));

    const m = modal(s.full_name, `
      <div class="student-head">
        ${s.note ? `<p class="muted">${esc(s.note)}</p>` : ''}
        ${!s.active ? `<span class="badge">В архиве</span>` : ''}
        <div class="btn-group">
          <button class="btn btn-sm" data-edit>Изменить</button>
          <button class="btn btn-sm btn-primary" data-enroll>+ Добавить курс</button>
        </div>
      </div>

      ${ens.length ? ens.map((e) => {
        const c = ctx.classById[e.class_id] || {};
        const st = ctx.stat(e);
        const ePays = pays.filter((p) => p.enrollment_id === e.id);
        const eAtt = att.filter((a) => a.enrollment_id === e.id && a.lessons && ['done', 'cancelled'].includes(a.lessons.status));
        return `
        <div class="enr-card ${e.active ? '' : 'is-off'}">
          <div class="enr-head">
            <div>
              <div class="enr-title">${esc(ctx.courseName[c.course_id] || '')}${c.kind === 'group' ? ' — ' + esc(c.name || '') : ''}</div>
              <div class="muted small">${L.kind[c.kind] || ''} · ${L.mode[c.mode] || ''} · ${esc(ctx.teacherName[c.teacher_id] || 'без учителя')} · ${schedText(c.schedule)}</div>
              <div class="muted small">${e.plan === 'support' ? 'Сопровождение' : `${money(e.package_price)} за ${e.package_lessons} ур.`} · с ${fmtDate(e.start_date)}${e.active ? '' : ' · <b>не ходит</b>'}</div>
            </div>
            ${statusBadge(e, ctx)}
          </div>
          <div class="enr-nums">
            <div><span>Оплачено уроков</span><b>${st.paid_lessons}</b></div>
            <div><span>Прошло</span><b>${st.used_lessons}</b></div>
            <div><span>Осталось</span><b>${st.remaining}</b></div>
          </div>
          <div class="btn-group">
            <button class="btn btn-sm btn-primary" data-pay="${e.id}">+ Оплата</button>
            <button class="btn btn-sm" data-enr-edit="${e.id}">Настройки</button>
          </div>
          <details>
            <summary>Оплаты (${ePays.length})</summary>
            ${ePays.length ? `<table class="table"><tbody>${ePays.map((p) => `
              <tr><td>${fmtDate(p.paid_at)}</td><td>${money(p.amount)}</td><td>+${p.lessons} ур.</td><td class="muted">${esc(p.note || '')}</td>
              <td><button class="icon-btn" data-del-pay="${p.id}" title="Удалить">🗑</button></td></tr>`).join('')}</tbody></table>` : empty('Оплат пока нет')}
          </details>
          <details>
            <summary>Посещаемость (${eAtt.length})</summary>
            ${eAtt.length ? `<table class="table"><tbody>${eAtt.map((a) => `
              <tr><td>${fmtShort(a.lessons.date)}</td>
              <td>${a.present ? '<span class="ok-text">Был(а)</span>' : '<span class="bad-text">Не был(а)</span>'}</td>
              <td>${a.present ? '' : a.decision ? L.decision[a.decision] : '<span class="muted">ждёт решения</span>'}</td>
              <td class="muted">${a.lessons.status === 'cancelled' ? 'отмена' : ''}</td></tr>`).join('')}</tbody></table>` : empty('Уроков пока не было')}
          </details>
        </div>`;
      }).join('') : empty('У ученика пока нет курсов. Нажмите «Добавить курс».')}
    `, { wide: true });

    const reopen = () => { m.close(); onChange && onChange(); openStudent(id, onChange); };
    $('[data-edit]', m.el).onclick = () => editStudent(s, reopen);
    $('[data-enroll]', m.el).onclick = () => editEnrollment(null, s, ctx, reopen);
    $$('[data-pay]', m.el).forEach((b) => b.onclick = () => {
      const e = ens.find((x) => x.id === b.dataset.pay);
      payModal(e, s, ctx.classById[e.class_id], reopen);
    });
    $$('[data-enr-edit]', m.el).forEach((b) => b.onclick = () => editEnrollment(ens.find((x) => x.id === b.dataset.enrEdit), s, ctx, reopen));
    $$('[data-del-pay]', m.el).forEach((b) => b.onclick = async () => {
      if (!(await confirmBox('Удалить эту оплату?'))) return;
      await busy(b, async () => { await DB.remove('payments', b.dataset.delPay); toast('Оплата удалена'); reopen(); });
    });
  }

  function editStudent(s, done) {
    const m = modal(s ? 'Изменить ученика' : 'Новый ученик', `
      <form class="form">
        <div class="field"><label>Имя и фамилия</label><input name="full_name" required value="${esc(s?.full_name || '')}"></div>
        <div class="field"><label>Заметка</label><input name="note" value="${esc(s?.note || '')}" placeholder="Например: 11 класс, готовится в NU"></div>
        ${s ? `<label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Активный (снимите галочку, чтобы убрать в архив)</label>` : ''}
        <div class="form-actions">
          ${s ? `<button type="button" class="btn btn-danger" data-del>Удалить</button>` : ''}
          <button type="button" class="btn" data-close>Отмена</button>
          <button type="submit" class="btn btn-primary">Сохранить</button>
        </div>
      </form>`);
    const form = $('form', m.el);
    form.onsubmit = (ev) => {
      ev.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const f = formData(form);
        const row = s ? await DB.update('students', s.id, f) : await DB.insert('students', f);
        m.close(); toast('Сохранено'); done(row);
      });
    };
    const del = $('[data-del]', m.el);
    if (del) del.onclick = async () => {
      if (!(await confirmBox(`Удалить ученика «${s.full_name}» вместе с оплатами и посещаемостью? Лучше убрать в архив.`))) return;
      await busy(del, async () => { await DB.remove('students', s.id); m.close(); toast('Удалено'); location.hash = '#/students'; done(null); });
    };
  }

  // Курс ученика: либо в существующую группу, либо новые индивидуальные уроки
  function editEnrollment(e, s, ctx, done) {
    const groups = ctx.classes.filter((c) => c.active && (c.kind === 'group' || (e && c.id === e.class_id)));
    const m = modal(e ? 'Настройки курса' : 'Добавить курс', `
      <form class="form">
        ${e ? '' : `
        <div class="seg">
          <label><input type="radio" name="kind" value="individual" checked><span>Индивидуально</span></label>
          <label><input type="radio" name="kind" value="group"><span>В группу</span></label>
        </div>
        <div data-k="group">
          <div class="field"><label>Группа</label>
            <select name="class_id">${options(groups.map((c) => [c.id, `${ctx.courseName[c.course_id]} — ${c.name} (${schedText(c.schedule)})`]), '', { empty: groups.length ? 'Выберите группу…' : 'Сначала создайте группу во вкладке «Группы»' })}</select>
          </div>
        </div>
        <div data-k="individual">
          ${ClassesPage.classFields(null, ctx, { individual: true })}
        </div>`}

        <h4>Оплата</h4>
        <div class="seg">
          <label><input type="radio" name="plan" value="package" ${!e || e.plan === 'package' ? 'checked' : ''}><span>Пакет уроков</span></label>
          <label><input type="radio" name="plan" value="support" ${e?.plan === 'support' ? 'checked' : ''}><span>Сопровождение</span></label>
        </div>
        <div class="row2">
          <div class="field"><label>Уроков в пакете</label>
            <input type="number" name="package_lessons" min="1" value="${e?.package_lessons ?? 8}" list="pkg-sizes"></div>
          <div class="field"><label>Цена пакета, ₸</label>
            <input type="number" name="package_price" min="0" step="1000" value="${e?.package_price ?? ''}" placeholder="80000"></div>
        </div>
        <datalist id="pkg-sizes"><option value="8"><option value="12"></datalist>
        <div class="row2">
          <div class="field"><label>Начало занятий</label><input type="date" name="start_date" value="${e?.start_date || Logic.today()}"></div>
          <div class="field"><label>Уже оплачено уроков <span class="muted small">(остаток на сегодня)</span></label>
            <input type="number" name="initial_lessons" value="${e?.initial_lessons ?? 0}"></div>
        </div>
        ${e ? `<label class="check"><input type="checkbox" name="active" ${e.active ? 'checked' : ''}> Ходит на этот курс</label>` : ''}
        <div class="form-actions">
          ${e ? `<button type="button" class="btn btn-danger" data-del>Удалить курс</button>` : ''}
          <button type="button" class="btn" data-close>Отмена</button>
          <button type="submit" class="btn btn-primary">Сохранить</button>
        </div>
      </form>`, { wide: !e });

    const form = $('form', m.el);
    if (!e) {
      const sync = () => {
        const k = form.querySelector('[name=kind]:checked').value;
        $$('[data-k]', form).forEach((p) => {
          p.hidden = p.dataset.k !== k;
          $$('input, select', p).forEach((i) => i.disabled = p.hidden);
        });
      };
      $$('[name=kind]', form).forEach((r) => r.onchange = sync);
      sync();
      ClassesPage.bindSchedule(form);
    }

    form.onsubmit = (ev) => {
      ev.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const f = formData(form);
        const enr = {
          plan: f.plan,
          package_lessons: f.package_lessons || 8,
          package_price: f.package_price || 0,
          start_date: f.start_date || Logic.today(),
          initial_lessons: f.initial_lessons || 0,
        };
        if (e) {
          enr.active = f.active;
          await DB.update('enrollments', e.id, enr);
        } else {
          let classId = f.class_id;
          if (f.kind === 'individual') {
            const cls = ClassesPage.readClass(form, { kind: 'individual', defaultName: s.full_name });
            classId = (await DB.insert('classes', cls)).id;
          } else if (!classId) {
            throw new Error('Выберите группу');
          }
          await DB.insert('enrollments', { ...enr, student_id: s.id, class_id: classId });
        }
        m.close(); toast('Сохранено'); done();
      });
    };
    const del = $('[data-del]', m.el);
    if (del) del.onclick = async () => {
      if (!(await confirmBox('Удалить курс у ученика вместе с оплатами и посещаемостью? Если ученик просто перестал ходить — снимите галочку «Ходит на этот курс».'))) return;
      await busy(del, async () => {
        await DB.remove('enrollments', e.id);
        const c = ctx.classById[e.class_id];
        // у индивидуальных занятий убираем и само занятие, если в нём никого не осталось
        if (c && c.kind === 'individual' && !ctx.enrollments.some((x) => x.class_id === c.id && x.id !== e.id)) {
          await DB.remove('classes', c.id);
        }
        m.close(); toast('Удалено'); done();
      });
    };
  }

  // ---------- оплата ----------
  function payModal(e, s, c, done) {
    const m = modal('Новая оплата', `
      <form class="form">
        <p><b>${esc(s?.full_name || '')}</b> · ${esc(c?.name || '')}</p>
        <div class="row2">
          <div class="field"><label>Дата оплаты</label><input type="date" name="paid_at" value="${Logic.today()}" required></div>
          <div class="field"><label>Сумма, ₸</label><input type="number" name="amount" min="0" step="1000" value="${e.package_price || ''}" required></div>
        </div>
        <div class="field"><label>Сколько уроков оплачено</label>
          <input type="number" name="lessons" min="0" value="${e.package_lessons}" required>
          <div class="quick">
            ${[[1, '1 пакет'], [3, '3 мес.'], [6, '6 мес.'], [24, '2 года']].map(([k, t]) =>
              `<button type="button" class="chip" data-mult="${k}">${t}</button>`).join('')}
          </div>
          <span class="muted small">Если остались уроки с прошлого пакета, они сохранятся и прибавятся.</span>
        </div>
        <div class="field"><label>Заметка</label><input name="note" placeholder="Необязательно"></div>
        <div class="form-actions">
          <button type="button" class="btn" data-close>Отмена</button>
          <button type="submit" class="btn btn-primary">Сохранить оплату</button>
        </div>
      </form>`);
    const form = $('form', m.el);
    $$('[data-mult]', form).forEach((b) => b.onclick = () => {
      const k = Number(b.dataset.mult);
      form.lessons.value = e.package_lessons * k;
      form.amount.value = (e.package_price || 0) * k;
    });
    form.onsubmit = (ev) => {
      ev.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const f = formData(form);
        await DB.insert('payments', { enrollment_id: e.id, paid_at: f.paid_at, amount: f.amount || 0, lessons: f.lessons || 0, note: f.note || null });
        m.close(); toast('Оплата сохранена'); done();
      });
    };
  }

  window.StudentsPage = { render, openStudent, payModal };
})();
