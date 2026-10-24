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
    $('#add-st', root).onclick = () => editStudent(null, (s) => openStudent(s.id, () => render(root), { addCourse: true }));
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
      enrById: Object.fromEntries(enrollments.map((e) => [e.id, e])),
    };
    // курсы, которые оплачиваются одной оплатой (уроки у каждого курса свои)
    const root = (e) => (e.pay_with && ctx.enrById[e.pay_with] ? e.pay_with : e.id);
    ctx.shared = (e) => enrollments.filter((x) => root(x) === root(e) && (x.active || x.id === e.id));
    ctx.courseOf = (e) => ctx.courseName[(ctx.classById[e.class_id] || {}).course_id] || '';
    ctx.status = (e) => Logic.payStatus(e, ctx.remaining(e));
    return ctx;
  }

  function supportTerm(e) {
    const until = Logic.supportUntil(e);
    const term = (Logic.SUPPORT_TERMS.find(([v]) => v === Logic.supportMonths(e)) || [0, ''])[1];
    return until ? `${term.toLowerCase()}, до ${fmtDate(until)}` : 'до конца (до поступления)';
  }

  function statusBadge(e, ctx) {
    const r = ctx.remaining(e);
    const st = ctx.status(e);
    if (st === 'support') {
      const until = Logic.supportUntil(e);
      return `<span class="badge badge-support">Сопровождение${until ? ` до ${fmtDate(until)}` : ''} · прошло ${ctx.stat(e).used_lessons} ур.</span>`;
    }
    if (st === 'debt') return `<span class="badge badge-debt">Долг ${-r} ${lessonsWord(-r)}</span>`;
    // прогресс внутри текущего пакета: «прошло 5 из 8»
    const pk = Logic.packProgress(r, e.package_lessons);
    const text = `прошло ${pk.done} из ${pk.size} · осталось ${pk.left}${pk.ahead ? ` (+${pk.ahead} ${pk.ahead === 1 ? 'пакет' : 'пакета'} оплачено)` : ''}`;
    return `<span class="badge ${st === 'due' ? 'badge-due' : 'badge-ok'}">${text}</span>`;
  }

  function row(s, ctx) {
    const ens = ctx.enrOf(s.id).filter((e) => e.active);
    return `
      <button class="list-row list-row-btn" data-open="${s.id}">
        <div class="who"><b>${esc(s.full_name)}</b>${s.note ? `<span class="muted small">${esc(s.note)}</span>` : ''}</div>
        <div class="enr-chips">
          ${ens.length ? ens.map((e) => `<span class="enr-chip"><span>${esc(ctx.courseOf(e))}</span> ${statusBadge(e, ctx)}</span>`).join('') : '<span class="badge badge-due">Нет курса — нажмите, чтобы добавить</span>'}
        </div>
      </button>`;
  }

  // ---------- карточка ученика ----------
  async function openStudent(id, onChange, opts = {}) {
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
        const together = ctx.shared(e);    // курсы, которые оплачиваются одной оплатой
        const ePays = pays.filter((p) => p.enrollment_id === e.id);
        const eAtt = att.filter((a) => a.enrollment_id === e.id && a.lessons && ['done', 'cancelled'].includes(a.lessons.status));
        return `
        <div class="enr-card ${e.active ? '' : 'is-off'}">
          <div class="enr-head">
            <div>
              <div class="enr-title">${esc(ctx.courseName[c.course_id] || '')}${c.kind === 'group' ? ' — ' + esc(c.name || '') : ''}</div>
              <div class="muted small">${L.kind[c.kind] || ''} · ${L.mode[c.mode] || ''} · ${esc(ctx.teacherName[c.teacher_id] || 'без учителя')} · ${schedText(c.schedule)}</div>
              <div class="muted small">${e.plan === 'support' ? `Сопровождение · ${supportTerm(e)}` : `${money(e.package_price)} за ${e.package_lessons} ур.`} · с ${fmtDate(e.start_date)}${e.active ? '' : ' · <b>не ходит</b>'}</div>
              ${together.length > 1 ? `<div class="shared-note">💳 Одна оплата за ${together.map((x) => esc(ctx.courseOf(x))).join(' + ')} · уроки у каждого курса свои</div>` : ''}
            </div>
            ${statusBadge(e, ctx)}
          </div>
          ${e.plan === 'support' ? (() => {
            // сопровождение одной оплатой за несколько курсов — оплата общая
            const supPays = pays.filter((p) => together.some((x) => x.id === p.enrollment_id));
            const paidAll = supPays.reduce((x, p) => x + p.amount, 0);
            return `
          <div class="enr-nums">
            <div><span>Срок</span><b>${Logic.supportUntil(e) ? 'до ' + fmtDate(Logic.supportUntil(e)) : 'до конца'}</b></div>
            <div><span>Оплачено${together.length > 1 ? ' (за все курсы)' : ''}</span><b>${money(paidAll)}</b></div>
            <div><span>Прошло уроков</span><b>${st.used_lessons}</b></div>
          </div>
          ${(() => {
            const until = Logic.supportUntil(e);
            const paid = paidAll;
            if (until && until < Logic.today()) return `<div class="pay-hint warn">Срок сопровождения закончился ${fmtDate(until)}. Если продлили — измените срок в «Настройках».</div>`;
            if (!paid && e.package_price) return `<div class="pay-hint warn">Оплата за сопровождение (${money(e.package_price)}) ещё не записана — нажмите «Внести оплату».</div>`;
            return `<div class="pay-hint">Всё оплачено${together.length > 1 ? ` (одной оплатой за ${together.map((x) => esc(ctx.courseOf(x))).join(' + ')})` : ''} — больше платить не нужно.</div>`;
          })()}`;
          })() : `
          ${(() => {
            // показываем текущий пакет («прошло 6 из 12»), а не сумму за всё время
            const pk = Logic.packProgress(st.remaining, e.package_lessons);
            return `
          <div class="enr-nums">
            <div><span>Пакет</span><b>${pk.size} ур.</b></div>
            <div><span>Прошло</span><b>${pk.done}</b></div>
            <div><span>Осталось</span><b>${pk.left}</b></div>
          </div>
          <div class="muted small">${pk.ahead ? `Оплачено ещё ${pk.ahead} ${pk.ahead === 1 ? 'пакет' : 'пакета'} вперёд (всего осталось ${st.remaining} ${lessonsWord(st.remaining)}). ` : ''}За всё время: оплачено ${st.paid_lessons} ${lessonsWord(st.paid_lessons)}, прошло ${st.used_lessons}.</div>`;
          })()}`}
          ${e.plan === 'support' || !e.active ? '' : (() => {
            if (st.remaining < 0) return `<div class="pay-hint bad">Уроки идут без оплаты: долг ${-st.remaining} ${lessonsWord(-st.remaining)}. Когда оплатит — нажмите «+ Оплата», долг вычтется из нового пакета.</div>`;
            if (st.remaining === 0) return `<div class="pay-hint warn">Оплаченные уроки закончились — пора оплатить следующий пакет.</div>`;
            const until = Logic.paidUntil(c, st.remaining, Logic.today());
            return `<div class="pay-hint">${until ? `По расписанию оплаченных уроков хватит примерно до <b>${fmtDate(until, true)}</b> — это последний оплаченный урок.` : `Осталось ${st.remaining} ${lessonsWord(st.remaining)}.`}</div>`;
          })()}
          <div class="btn-group">
            ${e.plan !== 'support' ? `<button class="btn btn-sm btn-primary" data-pay="${e.id}">+ Оплата</button>`
              : !pays.some((p) => together.some((x) => x.id === p.enrollment_id)) ? `<button class="btn btn-sm btn-primary" data-pay="${e.id}">Внести оплату</button>` : ''}
            <button class="btn btn-sm" data-enr-edit="${e.id}">Настройки</button>
            <button class="btn btn-sm" data-cal="${e.class_id}">📅 Календарь</button>
          </div>
          <details>
            <summary>Оплаты (${ePays.length})</summary>
            ${ePays.length ? `<table class="table"><tbody>${ePays.map((p) => `
              <tr><td>${fmtDate(p.paid_at)}</td><td>${money(p.amount)}${p.bundle_id ? `<div class="muted small">из общей оплаты ${money(pays.filter((x) => x.bundle_id === p.bundle_id).reduce((n, x) => n + x.amount, 0))}</div>` : ''}</td><td>+${p.lessons} ур.</td><td class="muted">${esc(p.note || '')}</td>
              <td class="nowrap"><button class="icon-btn" data-edit-pay="${p.id}" title="Изменить">✎</button><button class="icon-btn" data-del-pay="${p.id}" title="Удалить">🗑</button></td></tr>`).join('')}</tbody></table>` : empty('Оплат пока нет')}
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
    // календарь: после закрытия карточка открывается заново с новыми цифрами
    $$('[data-cal]', m.el).forEach((b) => b.onclick = () => { m.close(); CalendarPage.open(b.dataset.cal, onChange, { onClose: () => openStudent(id, onChange) }); });
    $$('[data-edit-pay]', m.el).forEach((b) => b.onclick = () => {
      const p = pays.find((x) => x.id === b.dataset.editPay);
      const e = ens.find((x) => x.id === p.enrollment_id);
      payModal(e, s, ctx.classById[e.class_id], reopen, p);
    });
    $$('[data-del-pay]', m.el).forEach((b) => b.onclick = async () => {
      const p = pays.find((x) => x.id === b.dataset.delPay);
      if (!(await confirmBox(p.bundle_id ? 'Это общая оплата за несколько курсов. Удалить её целиком (у всех курсов)?' : 'Удалить эту оплату?'))) return;
      await busy(b, async () => {
        if (p.bundle_id) DB.check(await DB.sb.from('payments').delete().eq('bundle_id', p.bundle_id));
        else await DB.remove('payments', p.id);
        toast('Оплата удалена'); reopen();
      });
    });
    // новый ученик — сразу предлагаем добавить курс
    if (opts.addCourse) editEnrollment(null, s, ctx, reopen);
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
      await busy(del, async () => {
        // индивидуальные занятия ученика удаляем вместе с ним (если в них больше никого нет)
        const [enrs, classes] = await Promise.all([DB.enrollments(), DB.classes()]);
        const mine = new Set(enrs.filter((x) => x.student_id === s.id).map((x) => x.class_id));
        const solo = classes.filter((c) => c.kind === 'individual' && mine.has(c.id) &&
          !enrs.some((x) => x.class_id === c.id && x.student_id !== s.id));
        await DB.remove('students', s.id);
        if (solo.length) DB.check(await DB.sb.from('classes').delete().in('id', solo.map((c) => c.id)));
        m.close(); toast('Удалено'); location.hash = '#/students'; done(null);
      });
    };
  }

  // Курс ученика: либо в существующую группу, либо новые индивидуальные уроки
  // opts.classId — сразу в эту группу (кнопка «+ Добавить ученика» в группе)
  function editEnrollment(e, s, ctx, done, opts = {}) {
    const groups = ctx.classes.filter((c) => c.active && (c.kind === 'group' || (e && c.id === e.class_id)));
    const preset = opts.classId && ctx.classById[opts.classId];
    // с какими курсами ученика можно сделать общую оплату: только с «главными» (у которых оплата своя)
    const others = ctx.enrOf(s.id).filter((x) => x.id !== e?.id && !x.pay_with);
    const isMain = e && ctx.enrollments.some((x) => x.pay_with === e.id);
    const payOpts = others.map((x) => [x.id, `${ctx.courseOf(x)}${ctx.classById[x.class_id]?.kind === 'group' ? ' — ' + ctx.classById[x.class_id].name : ''}`]);
    const m = modal(e ? 'Настройки курса' : preset ? `Добавить в группу «${preset.name}»` : 'Добавить курс', `
      <form class="form">
        ${preset ? `<p><b>${esc(s.full_name)}</b> → ${esc(ctx.courseName[preset.course_id] || '')} — ${esc(preset.name)} (${schedText(preset.schedule)})</p>
          <input type="hidden" name="kind" value="group"><input type="hidden" name="class_id" value="${preset.id}">` : e ? '' : `
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

        <div class="field"><label>Дата первого урока</label><input type="date" name="start_date" value="${e?.start_date || Logic.today()}">
          <span class="muted small">С этой даты ученик появляется на уроках и уроки начинают считаться.</span></div>
        <label class="check"><input type="checkbox" name="backfill" checked> Уроки, которые уже отмечены «прошёл» с этой даты, засчитать ученику («был»)</label>
        <h4>Оплата</h4>
        ${isMain ? `<p class="muted small">💳 С этим курсом оплачиваются вместе: ${ctx.enrollments.filter((x) => x.pay_with === e.id).map((x) => esc(ctx.courseOf(x))).join(', ')}.
          При «+ Оплата» сразу вносится одна оплата за все эти курсы.</p>` : payOpts.length ? `
        <div class="field"><label>Как платит за этот курс</label>
          <select name="pay_with">${options(payOpts.map(([id, t]) => [id, `Одной оплатой с курсом: ${t}`]), e?.pay_with || '', { empty: 'Отдельная оплата' })}</select>
          <span class="muted small">Ученик платит один раз за оба курса, но уроки у каждого курса считаются отдельно (например, по 12 уроков на каждый курс).</span></div>` : ''}
        <div data-own-pay>
        <div class="seg">
          <label><input type="radio" name="plan" value="package" ${!e || e.plan === 'package' ? 'checked' : ''}><span>Пакет уроков</span></label>
          <label><input type="radio" name="plan" value="support" ${e?.plan === 'support' ? 'checked' : ''}><span>Сопровождение</span></label>
        </div>
        <div data-plan="support">
          <p class="pay-hint" data-sup-linked hidden>Сопровождение уже оплачено вместе с выбранным выше курсом — цену и оплату здесь указывать не нужно.</p>
          <div class="field" data-sup-pay><label>Цена сопровождения за всё, ₸</label>
            <input type="number" name="sup_price" min="0" step="10000" value="${e?.plan === 'support' ? e.package_price || '' : ''}" placeholder="4000000"></div>
          <div class="field"><label>На какой срок</label>
            <div class="seg seg-wrap">${Logic.SUPPORT_TERMS.map(([v, t]) => `
              <label><input type="radio" name="sup_months" value="${v}" ${(e?.plan === 'support' ? Logic.supportMonths(e) : 24) === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}
            </div>
            <span class="muted small">Срок считается от «даты первого урока». Ученик платит один раз — напоминаний об оплате и долгов не будет.</span></div>
          ${e ? '' : `
          <label class="check" data-sup-pay><input type="checkbox" name="sup_paid" checked> Оплата получена — записать её сразу</label>
          <div class="field" data-sup-date><label>Дата оплаты</label><input type="date" name="sup_paid_at" value="${Logic.today()}"></div>`}
        </div>
        <div data-plan="package">
        <div class="row2">
          <div class="field"><label>Уроков в пакете</label>
            <input type="number" name="package_lessons" min="1" value="${e && e.plan !== 'support' ? e.package_lessons : 8}" list="pkg-sizes"></div>
          <div class="field"><label>Цена пакета, ₸</label>
            <input type="number" name="package_price" min="0" step="1000" value="${e?.package_price ?? ''}" placeholder="80000"></div>
        </div>
        <datalist id="pkg-sizes"><option value="8"><option value="12"></datalist>
        <details ${e?.initial_lessons ? 'open' : ''}>
          <summary>Не хочу вносить старые оплаты и уроки</summary>
          <div class="field" style="margin-top:8px"><label>Сколько оплаченных уроков у ученика осталось на сегодня</label>
            <input type="number" name="initial_lessons" value="${e?.initial_lessons ?? 0}">
            <span class="muted small">Например: оплатил 8, прошло 5 — напишите <b>3</b>, а «Дату первого урока» поставьте сегодняшнюю.
              Если вы вносите все старые оплаты и прошлые уроки — оставьте <b>0</b>.</span></div>
        </details>
        </div>
        </div>
        ${e ? `<label class="check"><input type="checkbox" name="active" ${e.active ? 'checked' : ''}> Ходит на этот курс</label>` : ''}
        <div class="form-actions">
          ${e ? `<button type="button" class="btn btn-danger" data-del>Удалить курс</button>` : ''}
          <button type="button" class="btn" data-close>Отмена</button>
          <button type="submit" class="btn btn-primary">Сохранить</button>
        </div>
      </form>`, { wide: !e });

    const form = $('form', m.el);
    const payWith = form.querySelector('[name=pay_with]');
    // пакет или сопровождение — показываем только нужные поля
    const syncPlan = () => {
      const plan = form.querySelector('[name=plan]:checked').value;
      $$('[data-plan]', form).forEach((p) => p.hidden = p.dataset.plan !== plan);
      // сопровождение, оплаченное вместе с другим курсом: цену и оплату не спрашиваем
      const linked = plan === 'support' && !!payWith?.value;
      $$('[data-sup-pay]', form).forEach((p) => p.hidden = linked);
      $('[data-sup-linked]', form).hidden = !linked;
      const paid = form.querySelector('[name=sup_paid]');
      if (paid) $('[data-sup-date]', form).hidden = linked || !paid.checked;
    };
    $$('[name=plan], [name=sup_paid], [name=pay_with]', form).forEach((r) => r.onchange = syncPlan);
    syncPlan();
    if (!e && !preset) {
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
        if (f.plan === 'support') {
          const linked = !!f.pay_with;
          if (!linked && !f.sup_price && f.sup_price !== 0) throw new Error('Укажите цену сопровождения');
          enr.package_price = linked ? 0 : f.sup_price;
          enr.package_lessons = Logic.encodeSupport(f.sup_months); // срок сопровождения (см. Logic.supportMonths)
          enr.initial_lessons = 0;
        }
        if (payWith) enr.pay_with = f.pay_with || null;
        let filled = 0;
        if (e) {
          enr.active = f.active;
          await DB.update('enrollments', e.id, enr);
          if (f.backfill) filled = await backfill(e.id, e.class_id, enr.start_date);
        } else {
          let classId = f.class_id;
          if (f.kind === 'individual') {
            const cls = ClassesPage.readClass(form, { kind: 'individual', defaultName: s.full_name });
            classId = (await DB.insert('classes', cls)).id;
          } else if (!classId) {
            throw new Error('Выберите группу');
          }
          const ne = await DB.insert('enrollments', { ...enr, student_id: s.id, class_id: classId });
          // сопровождение оплачивается один раз — сразу записываем оплату
          if (f.plan === 'support' && f.sup_paid && enr.package_price && !f.pay_with) {
            await DB.insert('payments', { enrollment_id: ne.id, amount: enr.package_price, lessons: 0, paid_at: f.sup_paid_at || Logic.today(), note: 'Сопровождение' });
          }
          if (f.backfill) filled = await backfill(ne.id, classId, enr.start_date);
        }
        m.close(); toast(filled ? `Сохранено. Засчитано уже отмеченных уроков: ${filled}` : 'Сохранено'); done();
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

  // Ученик добавлен в занятие, где уроки уже отмечены: ставим ему «был» на прошедших уроках с даты первого урока
  async function backfill(enrollmentId, classId, from) {
    const t = Logic.today();
    if (!from || from > t) return 0;
    const ls = (await DB.lessons(from, t)).filter((l) => l.class_id === classId && l.status === 'done' &&
      !(l.attendance || []).some((a) => a.enrollment_id === enrollmentId));
    if (ls.length) {
      DB.check(await DB.sb.from('attendance').upsert(ls.map((l) => ({ lesson_id: l.id, enrollment_id: enrollmentId, present: true })),
        { onConflict: 'lesson_id,enrollment_id' }));
    }
    return ls.length;
  }

  // ---------- оплата ----------
  // p — существующая оплата (изменить) или пусто (новая).
  // Если курсы ученика оплачиваются одной оплатой — одна сумма, а уроки у каждого курса свои.
  async function payModal(e, s, c, done, p) {
    const [enrollments, classes, courses] = await Promise.all([DB.enrollments(), DB.classes(), DB.courses()]);
    const enrById = Object.fromEntries(enrollments.map((x) => [x.id, x]));
    const classById = Object.fromEntries(classes.map((x) => [x.id, x]));
    const courseName = Object.fromEntries(courses.map((x) => [x.id, x.name]));
    const root = (x) => (x.pay_with && enrById[x.pay_with] ? x.pay_with : x.id);
    // строки оплаты (при изменении) и курсы, которые она покрывает
    const old = p?.bundle_id ? DB.check(await DB.sb.from('payments').select('*').eq('bundle_id', p.bundle_id)) : p ? [p] : [];
    const members = p ? old.map((x) => enrById[x.enrollment_id]).filter(Boolean)
      : [e, ...enrollments.filter((x) => x.id !== e.id && root(x) === root(e) && x.active)];
    // сопровождение за несколько курсов — одна строка оплаты (уроки там не считаются)
    if (!p && e.plan === 'support') members.splice(1);
    const multi = members.length > 1;
    const oldOf = (x) => old.find((o) => o.enrollment_id === x.id);
    const title = (x) => { const k = classById[x.class_id] || {}; return `${courseName[k.course_id] || ''}${k.kind === 'group' ? ' — ' + k.name : ''}`; };
    const priceSum = members.reduce((n, x) => n + (x.package_price || 0), 0);

    const m = modal(p ? 'Изменить оплату' : 'Новая оплата', `
      <form class="form">
        <p><b>${esc(s?.full_name || '')}</b> · ${multi ? `одна оплата за ${members.length} курса` : esc(c?.name || '')}</p>
        <div class="row2">
          <div class="field"><label>Дата оплаты</label><input type="date" name="paid_at" value="${p ? p.paid_at : Logic.today()}" required></div>
          <div class="field"><label>Сумма${multi ? ' за все курсы' : ''}, ₸</label><input type="number" name="amount" min="0" step="1000" value="${p ? old.reduce((n, x) => n + x.amount, 0) : priceSum || ''}" required></div>
        </div>
        ${members.map((x) => x.plan === 'support' ? `
        <p class="muted small">${multi ? `<b>${esc(title(x))}</b>: сопровождение — ` : 'Сопровождение: '}уроки не считаются, оплата просто сохранится для отчёта «Деньги».</p>
        <input type="hidden" data-les="${x.id}" value="0">` : `
        <div class="field"><label>${multi ? `Уроков по курсу «${esc(title(x))}»` : 'Сколько уроков оплачено'}</label>
          <input type="number" data-les="${x.id}" min="0" value="${oldOf(x) ? oldOf(x).lessons : x.package_lessons}" required></div>`).join('')}
        ${members.some((x) => x.plan !== 'support') ? `
        <div class="quick">
          ${[[1, '1 пакет'], [3, '3 мес.'], [6, '6 мес.'], [24, '2 года']].map(([k, t]) =>
            `<button type="button" class="chip" data-mult="${k}">${t}</button>`).join('')}
        </div>
        <span class="muted small">Если остались уроки с прошлого пакета, они сохранятся и прибавятся.${multi ? ' Уроки у каждого курса считаются отдельно.' : ''}</span>` : ''}
        <div class="field"><label>Заметка</label><input name="note" value="${esc(p?.note || '')}" placeholder="Необязательно"></div>
        <div class="form-actions">
          <button type="button" class="btn" data-close>Отмена</button>
          <button type="submit" class="btn btn-primary">Сохранить оплату</button>
        </div>
      </form>`);
    const form = $('form', m.el);
    const les = (x) => form.querySelector(`[data-les="${x.id}"]`);
    $$('[data-mult]', form).forEach((b) => b.onclick = () => {
      const k = Number(b.dataset.mult);
      members.forEach((x) => { if (x.plan !== 'support') les(x).value = x.package_lessons * k; });
      form.amount.value = priceSum * k;
    });
    form.onsubmit = (ev) => {
      ev.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const f = formData(form);
        const total = f.amount || 0;
        const lessons = members.map((x) => Number(les(x).value) || 0);
        // сумму делим между курсами по их цене за урок (для отчёта по курсам); в сумме — ровно total
        const w = members.map((x, i) => (x.plan === 'support' ? 0 : (x.package_price || 0) / (x.package_lessons || 1)) * lessons[i]);
        const wSum = w.reduce((a, b) => a + b, 0);
        const amounts = members.map((x, i) => (wSum ? Math.round((total * w[i]) / wSum) : i === 0 ? total : 0));
        amounts[0] += total - amounts.reduce((a, b) => a + b, 0);
        const base = { paid_at: f.paid_at, note: f.note || null };
        if (p) {
          for (let i = 0; i < members.length; i++) {
            await DB.update('payments', oldOf(members[i]).id, { ...base, amount: amounts[i], lessons: lessons[i] });
          }
        } else {
          const first = await DB.insert('payments', { ...base, amount: amounts[0], lessons: lessons[0], enrollment_id: members[0].id });
          if (multi) {
            await DB.update('payments', first.id, { bundle_id: first.id });
            for (let i = 1; i < members.length; i++) {
              await DB.insert('payments', { ...base, amount: amounts[i], lessons: lessons[i], enrollment_id: members[i].id, bundle_id: first.id });
            }
          }
        }
        m.close(); toast('Оплата сохранена'); done();
      });
    };
  }

  // ---------- «+ Добавить ученика» в группу: уже учащегося или нового ----------
  async function addToClass(classId, done) {
    const [students, enrollments, classes, courses, teachers, stats] = await Promise.all([
      DB.students(), DB.enrollments(), DB.classes(), DB.courses(), DB.teachers(), DB.stats(),
    ]);
    const ctx = makeCtx({ students, enrollments, classes, courses, teachers, stats });
    const c = ctx.classById[classId];
    if (!c) return;
    const inside = new Set(enrollments.filter((e) => e.class_id === classId).map((e) => e.student_id));
    const list = students.filter((s) => s.active && !inside.has(s.id)).sort((a, b) => a.full_name.localeCompare(b.full_name));
    const label = (s) => {
      const names = ctx.enrOf(s.id).filter((e) => e.active).map((e) => ctx.courseOf(e));
      return `${s.full_name}${names.length ? ` (уже учится: ${names.join(', ')})` : ''}`;
    };
    const m = modal(`Добавить ученика в «${c.name}»`, `
      <form class="form">
        <div class="seg">
          <label><input type="radio" name="who" value="old" checked><span>Уже учится у нас</span></label>
          <label><input type="radio" name="who" value="new"><span>Новый ученик</span></label>
        </div>
        <div data-who="old">
          <div class="field"><label>Поиск</label><input type="search" data-q placeholder="Начните вводить имя"></div>
          <div class="field"><label>Ученик</label>
            <select name="student_id" size="8" class="pick-list">${options(list.map((s) => [s.id, label(s)]), '')}</select>
            ${list.length ? '' : '<span class="muted small">Все ученики уже в этой группе.</span>'}</div>
        </div>
        <div data-who="new" hidden>
          <div class="field"><label>Имя и фамилия</label><input name="full_name"></div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn" data-close>Отмена</button>
          <button type="submit" class="btn btn-primary">Дальше</button>
        </div>
      </form>`);
    const form = $('form', m.el);
    const sel = form.student_id;
    $$('[name=who]', form).forEach((r) => r.onchange = () =>
      $$('[data-who]', form).forEach((p) => p.hidden = p.dataset.who !== r.value));
    $('[data-q]', form).oninput = (ev) => {
      const q = ev.target.value.toLowerCase();
      [...sel.options].forEach((o) => o.hidden = !o.textContent.toLowerCase().includes(q));
    };
    form.onsubmit = (ev) => {
      ev.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const who = form.querySelector('[name=who]:checked').value;
        let s;
        if (who === 'old') {
          s = students.find((x) => x.id === sel.value);
          if (!s) throw new Error('Выберите ученика из списка');
        } else {
          const name = form.full_name.value.trim();
          if (!name) throw new Error('Напишите имя ученика');
          s = await DB.insert('students', { full_name: name });
          ctx.students.push(s);
        }
        m.close();
        editEnrollment(null, s, ctx, done, { classId });
      });
    };
  }

  window.StudentsPage = { render, openStudent, payModal, addToClass };
})();
