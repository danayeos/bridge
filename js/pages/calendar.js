// Календарь занятия: все уроки по месяцам. Любой день можно отметить
// (прошёл / перенос / отмена / не было) или добавить урок вне расписания.
(function () {
  const { L, esc, $, $$, modal, toast, busy } = UI;

  function shiftMonth(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function chip(s, idx) {
    const l = s.lesson;
    const t = esc(s.time || '');
    if (!l) {
      const past = s.date < Logic.today();
      return `<button class="cal-chip ${past ? 'cal-unmarked' : 'cal-ghost'}" data-slot="${idx}" title="${past ? 'Не отмечен' : 'По расписанию'}">${t}${past ? ' ?' : ''}</button>`;
    }
    if (l.status === 'done') {
      const absent = (l.attendance || []).filter((a) => !a.present).length;
      return `<button class="cal-chip cal-done" data-slot="${idx}">✓ ${t}${absent ? ` <b>✕${absent}</b>` : ''}</button>`;
    }
    if (l.status === 'rescheduled') {
      return `<button class="cal-chip cal-moved" data-slot="${idx}">↷ ${UI.fmtShort(l.moved_to_date).slice(3)}</button>`;
    }
    if (l.status === 'cancelled') {
      return l.caused_by
        ? `<button class="cal-chip cal-cancel" data-slot="${idx}">✕ отмена</button>`
        : `<button class="cal-chip cal-none" data-slot="${idx}">не было</button>`;
    }
    return `<button class="cal-chip cal-planned" data-slot="${idx}" title="Перенесён сюда">↶ ${t}</button>`;
  }

  async function open(classId, onChange) {
    let month = Logic.today().slice(0, 7);
    const [classes, courses, teachers, roster] = await Promise.all([DB.classes(), DB.courses(), DB.teachers(), DB.roster()]);
    const c = classes.find((x) => x.id === classId);
    if (!c) return toast('Занятие не найдено', 'err');
    const info = {
      classById: { [c.id]: c },
      courseName: Object.fromEntries(courses.map((x) => [x.id, x.name])),
      teacherName: Object.fromEntries(teachers.map((x) => [x.id, x.full_name])),
      roster,
      isAdmin: true,
    };
    const starts = Logic.classStarts(roster);
    const who = c.kind === 'individual' ? roster.filter((r) => r.class_id === c.id).map((r) => r.student_name) : [];
    const m = modal(`Календарь · ${c.name}${who.length && !who.some((n) => c.name.toLowerCase().includes(n.toLowerCase().split(' ')[0])) ? ` (ученик: ${who.join(', ')})` : ''}`, `<div data-cal><div class="loading">Загрузка…</div></div>`, { wide: true });
    const box = $('[data-cal]', m.el);

    let lastSlots = [];
    const after = () => { onChange && onChange(); draw(); };

    async function draw() {
      const [from, to] = Logic.monthRange(month);
      const lessons = (await DB.lessons(from, to)).filter((l) => l.class_id === classId);
      const t = Logic.today();
      const gridStart = Logic.addDays(from, 1 - Logic.weekday(from));
      const gridEnd = Logic.addDays(to, 7 - Logic.weekday(to));
      const slots = [];
      const cnt = { done: 0, rescheduled: 0, cancelled: 0, none: 0, unmarked: 0 };
      let cells = '';
      for (let d = gridStart; d <= gridEnd; d = Logic.addDays(d, 1)) {
        const inMonth = d >= from && d <= to;
        const daySlots = inMonth ? Logic.lessonsForDate(d, [c], lessons.filter((l) => l.date === d), starts) : [];
        let chips = '';
        for (const s of daySlots) {
          const l = s.lesson;
          if (!l) { if (d < t) cnt.unmarked++; }
          else if (l.status === 'cancelled' && !l.caused_by) cnt.none++;
          else if (cnt[l.status] !== undefined) cnt[l.status]++;
          slots.push(s);
          chips += chip(s, slots.length - 1);
        }
        cells += `
          <div class="cal-cell ${inMonth ? '' : 'cal-out'} ${d === t ? 'cal-today' : ''}">
            <div class="cal-day"><span>${Number(d.slice(8))}</span>
              ${inMonth ? `<button class="cal-add" data-add="${d}" title="Добавить урок в этот день" aria-label="Добавить урок">+</button>` : ''}</div>
            ${chips}
          </div>`;
      }

      lastSlots = slots;
      box.innerHTML = `
        <div class="cal-head">
          <button class="btn btn-sm" data-month="-1" aria-label="Предыдущий месяц">←</button>
          <b>${L.months[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}</b>
          <button class="btn btn-sm" data-month="1" aria-label="Следующий месяц">→</button>
        </div>
        <div class="cal-sum small">
          <span class="cal-chip cal-done">✓ прошло: ${cnt.done}</span>
          <span class="cal-chip cal-moved">↷ перенос: ${cnt.rescheduled}</span>
          <span class="cal-chip cal-cancel">✕ отмена: ${cnt.cancelled}</span>
          <span class="cal-chip cal-none">не было: ${cnt.none}</span>
          ${cnt.unmarked ? `<span class="cal-chip cal-unmarked">не отмечено: ${cnt.unmarked}</span>` : ''}
        </div>
        <div class="cal-grid">
          ${L.days.slice(1).map((d) => `<div class="cal-wd">${d}</div>`).join('')}
          ${cells}
        </div>
        <p class="muted small">Нажмите на урок, чтобы отметить или изменить. «+» — добавить урок в день, которого нет в расписании.
          Пунктир — урок по расписанию, ещё не отмечен; если его на самом деле не было, выберите «Урока не было».</p>`;

      $$('[data-month]', box).forEach((b) => b.onclick = () => { month = shiftMonth(month, Number(b.dataset.month)); draw(); });
      $$('[data-slot]', box).forEach((b) => b.onclick = () => TodayPage.openMark(slots[Number(b.dataset.slot)], info, after));
      $$('[data-add]', box).forEach((b) => b.onclick = () => addLesson(b.dataset.add));
    }

    function addLesson(date) {
      const cur = Logic.currentSchedule(c.schedule, date);
      const time = (cur.find((s) => Number(s.day) === Logic.weekday(date)) || cur[0] || { time: '16:00' }).time;
      const am = modal(`Добавить урок · ${UI.fmtDate(date, true)}`, `
        <form class="form">
          <div class="field"><label>Время</label><input type="time" name="time" value="${esc(time)}" required></div>
          <div class="form-actions">
            <button type="button" class="btn" data-close>Отмена</button>
            <button type="submit" class="btn btn-primary">Дальше</button>
          </div>
        </form>`);
      const form = $('form', am.el);
      form.onsubmit = (e) => {
        e.preventDefault();
        am.close();
        // в это время урок уже есть — открываем его
        const same = lastSlots.find((s) => s.date === date && s.time === form.time.value && (!s.lesson || !s.lesson.origin_id));
        TodayPage.openMark(same || { class_id: c.id, date, time: form.time.value, lesson: null }, info, after);
      };
    }

    draw().catch((e) => { box.innerHTML = `<div class="alert alert-err">${esc(e.message)}</div>`; });
  }

  window.CalendarPage = { open };
})();
