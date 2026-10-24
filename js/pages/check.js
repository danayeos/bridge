// Проверка данных: ищет ошибки и странности в базе и предлагает исправить их одной кнопкой.
(function () {
  const { esc, $$, toast, busy, confirmBox, fmtShort, fmtDate, lessonsWord, empty } = UI;

  const norm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  const firstWord = (s) => norm(s).split(/[\s—-]+/)[0] || '';

  async function load() {
    const t = Logic.today();
    const [students, enrollments, classes, courses, teachers, stats, roster, lessons, profiles] = await Promise.all([
      DB.students(), DB.enrollments(), DB.classes(), DB.courses(), DB.teachers(), DB.stats(), DB.roster(),
      DB.lessons('2000-01-01', Logic.addDays(t, 400)), DB.profiles(),
    ]);
    return { t, students, enrollments, classes, courses, teachers, stats, roster, lessons, profiles };
  }

  // Каждая проблема: { level: 'err' | 'warn' | 'info', group, text, fix?: {label, run}, open?: {label, run} }
  function analyze(d) {
    const out = [];
    const courseName = Object.fromEntries(d.courses.map((c) => [c.id, c.name]));
    const classById = Object.fromEntries(d.classes.map((c) => [c.id, c]));
    const studentById = Object.fromEntries(d.students.map((s) => [s.id, s]));
    const enrById = Object.fromEntries(d.enrollments.map((e) => [e.id, e]));
    const statBy = Object.fromEntries(d.stats.map((s) => [s.enrollment_id, s]));
    const enrOfClass = (cid) => d.enrollments.filter((e) => e.class_id === cid);
    const sName = (e) => studentById[e.student_id]?.full_name || '?';
    const cTitle = (c) => `«${c.name}»${c.kind === 'individual' ? ' (индив.)' : c.kind === 'intensive' ? ' (интенсив)' : ''}`;
    const openClass = (c) => ({ label: 'Открыть занятие', run: (done) => ClassesPage.editClass(c, ctxFor(d), done) });
    const openCal = (c) => ({ label: '📅 Календарь', run: (done) => CalendarPage.open(c.id, done) });
    const openStudent = (sid) => ({ label: 'Открыть ученика', run: (done) => StudentsPage.openStudent(sid, done) });

    // ---------- индивидуальные занятия ----------
    for (const c of d.classes.filter((x) => x.kind === 'individual')) {
      const ens = enrOfClass(c.id);
      const course = courseName[c.course_id] || '';
      if (!ens.length) {
        out.push({ level: 'warn', group: 'Индивидуальные занятия', text: `Занятие ${cTitle(c)} без ученика (ученика или курс удалили).`,
          fix: { label: 'Удалить занятие', run: async () => DB.remove('classes', c.id) } });
        continue;
      }
      if (ens.length > 1) {
        out.push({ level: 'err', group: 'Индивидуальные занятия',
          text: `В индивидуальном занятии ${cTitle(c)} сразу ${ens.length} ученика: ${ens.map((e) => esc(sName(e))).join(', ')}. Если они занимаются вдвоём — сделайте его группой. Если ученика добавили сюда по ошибке — откройте ученика и удалите у него этот курс.`,
          fix: { label: 'Они занимаются вместе — сделать группой', run: async () => DB.update('classes', c.id, { kind: 'group' }) },
          open: openStudent(ens[ens.length - 1].student_id) });
        continue;
      }
      const s = studentById[ens[0].student_id];
      if (s && !norm(c.name).includes(firstWord(s.full_name))) {
        const good = `${s.full_name} — ${course}`;
        out.push({ level: 'err', group: 'Индивидуальные занятия', rename: { id: c.id, name: good },
          text: `Занятие называется ${cTitle(c)}, а в нём учится <b>${esc(s.full_name)}</b>. Из-за этого в календаре, расписании и у учителя видно чужое имя.`,
          fix: { label: `Переименовать в «${good}»`, run: async () => DB.update('classes', c.id, { name: good }) } });
      }
    }

    // ---------- занятия ----------
    for (const c of d.classes.filter((x) => x.active)) {
      const activeEns = enrOfClass(c.id).filter((e) => e.active && studentById[e.student_id]?.active);
      if (!activeEns.length) continue;
      if (!Logic.currentSchedule(c.schedule, d.t).length) {
        out.push({ level: 'warn', group: 'Занятия', text: `У занятия ${cTitle(c)} нет расписания на сегодня — уроки не появляются в «Уроках дня» и в календаре.`, open: openClass(c) });
      }
      if (!c.teacher_id) out.push({ level: 'warn', group: 'Занятия', text: `У занятия ${cTitle(c)} не выбран учитель — никто не сможет отметить уроки, зарплата не посчитается.`, open: openClass(c) });
      if (!c.teacher_rate) out.push({ level: 'info', group: 'Занятия', text: `У занятия ${cTitle(c)} не указана оплата учителю за урок (0 ₸).`, open: openClass(c) });
    }
    for (const c of d.classes.filter((x) => x.active && x.kind === 'intensive' && (!x.end_date || x.end_date >= d.t))) {
      if (!c.teacher_id) out.push({ level: 'warn', group: 'Занятия', text: `У интенсива ${cTitle(c)} не выбран учитель.` });
      if (!Logic.currentSchedule(c.schedule, d.t).length) out.push({ level: 'warn', group: 'Занятия', text: `У интенсива ${cTitle(c)} нет расписания.` });
    }
    for (const c of d.classes.filter((x) => !x.active)) {
      const still = enrOfClass(c.id).filter((e) => e.active && studentById[e.student_id]?.active);
      if (still.length) out.push({ level: 'warn', group: 'Занятия',
        text: `Занятие ${cTitle(c)} в архиве, но ${still.map((e) => esc(sName(e))).join(', ')} числятся как ходящие (и могут попадать в напоминания об оплате).`,
        fix: { label: 'Отметить, что они больше не ходят', run: async () => { for (const e of still) await DB.update('enrollments', e.id, { active: false }); } },
        open: openClass(c) });
    }

    // ---------- ученики ----------
    const byName = {};
    for (const s of d.students) (byName[norm(s.full_name)] ||= []).push(s);
    for (const list of Object.values(byName).filter((l) => l.length > 1)) {
      out.push({ level: 'warn', group: 'Ученики', text: `Ученик «${esc(list[0].full_name)}» записан ${list.length} раза — возможно, это дубликат. Оставьте одного, у другого удалите или уберите в архив.`,
        open: openStudent(list[1].id) });
    }
    for (const s of d.students.filter((x) => x.active)) {
      const ens = d.enrollments.filter((e) => e.student_id === s.id);
      if (!ens.length) out.push({ level: 'warn', group: 'Ученики', text: `У ученика <b>${esc(s.full_name)}</b> нет ни одного курса.`, open: openStudent(s.id) });
      else if (!ens.some((e) => e.active && classById[e.class_id]?.active)) out.push({ level: 'info', group: 'Ученики',
        text: `<b>${esc(s.full_name)}</b> больше не ходит ни на один курс, но не в архиве.`,
        fix: { label: 'Убрать в архив', run: async () => DB.update('students', s.id, { active: false }) } });
    }

    // ---------- оплаты ----------
    for (const e of d.enrollments) {
      if (!e.pay_with) continue;
      const p = enrById[e.pay_with];
      if (!p || p.student_id !== e.student_id || p.pay_with) {
        out.push({ level: 'err', group: 'Оплаты', text: `У ученика <b>${esc(sName(e))}</b> курс связан «одной оплатой» с неправильным курсом.`,
          fix: { label: 'Сделать оплату отдельной', run: async () => DB.update('enrollments', e.id, { pay_with: null }) } });
      }
    }
    for (const e of d.enrollments.filter((x) => x.active && x.plan === 'package' && studentById[x.student_id]?.active)) {
      const r = statBy[e.id]?.remaining ?? e.initial_lessons;
      if (r <= -3) out.push({ level: 'warn', group: 'Оплаты',
        text: `<b>${esc(sName(e))}</b> (${esc(courseName[classById[e.class_id]?.course_id] || '')}): долг ${-r} ${lessonsWord(-r)}. Возможно, не внесена оплата или неверный «остаток уроков».`,
        open: openStudent(e.student_id) });
      if (!e.package_price && !e.pay_with) out.push({ level: 'info', group: 'Оплаты',
        text: `<b>${esc(sName(e))}</b> (${esc(courseName[classById[e.class_id]?.course_id] || '')}): не указана цена пакета.`, open: openStudent(e.student_id) });
    }

    // ---------- уроки ----------
    const byOrigin = new Set(d.lessons.filter((l) => l.origin_id).map((l) => l.origin_id));
    const starts = Logic.classStarts(d.roster);
    for (const l of d.lessons) {
      const c = classById[l.class_id];
      if (!c) continue;
      const when = `${fmtShort(l.date)} ${l.time || ''}`;
      if (l.status === 'rescheduled' && l.moved_to_date && !byOrigin.has(l.id)) {
        out.push({ level: 'err', group: 'Уроки', text: `${cTitle(c)}, ${when}: перенос на ${fmtShort(l.moved_to_date)}, но самого перенесённого урока нет.`,
          fix: { label: 'Создать перенесённый урок', run: async () => DB.insert('lessons', { class_id: c.id, date: l.moved_to_date, time: l.moved_to_time || l.time, status: 'planned', origin_id: l.id }) } });
      }
      // посещаемость раньше даты первого урока ученика
      for (const a of l.attendance || []) {
        const e = enrById[a.enrollment_id];
        if (e && l.date < e.start_date && ['done', 'cancelled'].includes(l.status)) {
          out.push({ level: 'warn', group: 'Уроки', key: 'early-' + e.id,
            text: `<b>${esc(sName(e))}</b> отмечен(а) на уроке ${cTitle(c)} ${fmtShort(l.date)}, а «дата первого урока» у него(неё) — ${fmtShort(e.start_date)}.`,
            fix: { label: `Поставить дату первого урока ${fmtShort(l.date)}`, run: async () => {
              const first = d.lessons.filter((x) => (x.attendance || []).some((y) => y.enrollment_id === e.id)).map((x) => x.date).sort()[0];
              await DB.update('enrollments', e.id, { start_date: first });
            } } });
        }
      }
    }

    // урок отмечен «прошёл», а ученику не засчитан (ученика добавили в группу позже или «дата первого урока» стоит позже)
    for (const e of d.enrollments.filter((x) => x.active && studentById[x.student_id]?.active)) {
      const c = classById[e.class_id];
      if (!c) continue;
      const solo = c.kind === 'individual' && enrOfClass(c.id).length === 1;
      const miss = d.lessons.filter((l) => l.class_id === c.id && l.status === 'done' && l.date <= d.t &&
        (l.date >= e.start_date || (solo && !(l.attendance || []).length)) &&
        !(l.attendance || []).some((a) => a.enrollment_id === e.id));
      if (!miss.length) continue;
      const first = miss.map((l) => l.date).sort()[0];
      const early = first < e.start_date;
      out.push({ level: 'err', group: 'Уроки',
        text: `<b>${esc(sName(e))}</b>: в ${cTitle(c)} ${miss.length} ${lessonsWord(miss.length)} отмечены «прошёл», но ученику не засчитаны — поэтому «Прошло» меньше, чем на самом деле.${early ? ` Часть уроков раньше «даты первого урока» (${fmtShort(e.start_date)}).` : ''}`,
        fix: { label: `Засчитать ${miss.length} ${lessonsWord(miss.length)} («был»)`, run: async () => {
          if (early) await DB.update('enrollments', e.id, { start_date: first });
          DB.check(await DB.sb.from('attendance').upsert(miss.map((l) => ({ lesson_id: l.id, enrollment_id: e.id, present: true })),
            { onConflict: 'lesson_id,enrollment_id' }));
        } },
        open: openStudent(e.student_id) });
    }

    // неотмеченные прошлые уроки по занятиям
    for (const c of d.classes.filter((x) => x.active && (x.kind === 'intensive' ? x.start_date : starts[x.id]))) {
      const ls = d.lessons.filter((l) => l.class_id === c.id);
      let n = 0;
      const st0 = c.kind === 'intensive' ? c.start_date : starts[c.id];
      for (let day = st0 > Logic.addDays(d.t, -365) ? st0 : Logic.addDays(d.t, -365); day < d.t; day = Logic.addDays(day, 1)) {
        n += Logic.lessonsForDate(day, [c], ls.filter((l) => l.date === day), starts).filter((s) => !s.lesson || s.lesson.status === 'planned').length;
      }
      if (n) out.push({ level: 'info', group: 'Неотмеченные уроки', text: `${cTitle(c)}: ${n} ${lessonsWord(n)} в прошлом не отмечены. Отметьте «прошёл» или «урока не было».`, open: openCal(c) });
    }

    // ---------- учителя ----------
    const pending = d.profiles.filter((p) => p.role === 'pending');
    if (pending.length) out.push({ level: 'info', group: 'Учителя', text: `Ждут подтверждения новых аккаунтов: ${pending.length}. Пока вы их не подтвердите, они ничего не видят.`,
      open: { label: 'Открыть «Учителя»', run: () => { location.hash = '#/teachers'; } } });
    for (const tch of d.teachers.filter((x) => x.active && !x.user_id)) {
      if (d.classes.some((c) => c.active && c.teacher_id === tch.id)) out.push({ level: 'info', group: 'Учителя',
        text: `Учитель <b>${esc(tch.full_name)}</b> ведёт занятия, но не привязан к аккаунту — сам отмечать уроки не сможет.`,
        open: { label: 'Открыть «Учителя»', run: () => { location.hash = '#/teachers'; } } });
    }

    // одинаковые «дата первого урока» — убираем повторы одного и того же ученика
    const seen = new Set();
    return out.filter((x) => !x.key || (!seen.has(x.key) && seen.add(x.key)));
  }

  function ctxFor(d) {
    return {
      classes: d.classes, courses: d.courses, teachers: d.teachers,
      courseName: Object.fromEntries(d.courses.map((c) => [c.id, c.name])),
      teacherName: Object.fromEntries(d.teachers.map((t) => [t.id, t.full_name])),
    };
  }

  const LEVEL = { err: ['Ошибка', 'badge-debt'], warn: ['Проверьте', 'badge-due'], info: ['Совет', ''] };

  async function render(root) {
    root.innerHTML = `<div class="loading">Проверяю данные…</div>`;
    const d = await load();
    const list = analyze(d);
    const order = { err: 0, warn: 1, info: 2 };
    list.sort((a, b) => order[a.level] - order[b.level]);
    const groups = [...new Set(list.map((x) => x.group))];
    const renames = list.filter((x) => x.rename);
    const errs = list.filter((x) => x.level === 'err').length;

    root.innerHTML = `
      <div class="page-head"><h1>🩺 Проверка данных</h1><button class="btn" id="re">Проверить ещё раз</button></div>
      <p class="muted">Сайт сам ищет ошибки и странности в базе: чужое имя в занятии, ученик не в том занятии, пустая посещаемость, потерянные переносы, дубликаты учеников.
        Ничего не меняется, пока вы не нажмёте кнопку исправления.</p>
      ${list.length ? `<div class="tiles">
        <div class="tile"><div class="tile-label">Ошибки</div><div class="tile-value ${errs ? 'accent' : ''}">${errs}</div></div>
        <div class="tile"><div class="tile-label">Проверить</div><div class="tile-value">${list.filter((x) => x.level === 'warn').length}</div></div>
        <div class="tile"><div class="tile-label">Советы</div><div class="tile-value">${list.filter((x) => x.level === 'info').length}</div></div>
      </div>` : ''}
      ${renames.length > 1 ? `<div class="alert">Неправильных названий у индивидуальных занятий: <b>${renames.length}</b>.
        <button class="btn btn-sm btn-primary" id="fix-names">Переименовать все по имени ученика</button></div>` : ''}
      ${list.length ? groups.map((g) => `
        <section class="section">
          <h2>${esc(g)} <span class="count">${list.filter((x) => x.group === g).length}</span></h2>
          <div class="list">${list.map((x, i) => x.group !== g ? '' : `
            <div class="list-row chk-row">
              <span class="badge ${LEVEL[x.level][1]}">${LEVEL[x.level][0]}</span>
              <div class="chk-text">${x.text}</div>
              <div class="btn-group">
                ${x.fix ? `<button class="btn btn-sm btn-primary" data-fix="${i}">${esc(x.fix.label)}</button>` : ''}
                ${x.open ? `<button class="btn btn-sm" data-open="${i}">${esc(x.open.label)}</button>` : ''}
              </div>
            </div>`).join('')}</div>
        </section>`).join('') : empty('Ошибок не найдено 🎉')}
      <p class="muted small">Проверено: ${d.students.length} учеников, ${d.classes.length} занятий, ${d.lessons.length} отмеченных уроков. ${fmtDate(d.t, true)}.</p>`;

    const again = () => render(root);
    $$('#re', root).forEach((b) => b.onclick = again);
    $$('[data-fix]', root).forEach((b) => b.onclick = () => busy(b, async () => {
      const x = list[Number(b.dataset.fix)];
      if (!(await confirmBox(`${x.fix.label}?`))) return;
      await x.fix.run();
      toast('Исправлено');
      again();
    }));
    $$('[data-open]', root).forEach((b) => b.onclick = () => list[Number(b.dataset.open)].open.run(again));
    const fixNames = $$('#fix-names', root)[0];
    if (fixNames) fixNames.onclick = () => busy(fixNames, async () => {
      if (!(await confirmBox(`Переименовать ${renames.length} индивидуальных занятий в «Имя ученика — Курс»?`))) return;
      for (const x of renames) await DB.update('classes', x.rename.id, { name: x.rename.name });
      toast('Переименовано');
      again();
    });
  }

  // для «Главной»: только число ошибок
  async function count() {
    const list = analyze(await load());
    return list.filter((x) => x.level !== 'info').length;
  }

  window.CheckPage = { render, analyze, count };
})();
