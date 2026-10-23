// Расписание школы на неделю: все учителя, онлайн / офлайн, кто сейчас в Zoom, пересечения.
(function () {
  const { L, esc, $, $$, options, fmtShort, empty } = UI;
  let weekStart = null;
  let show = 'all';      // all | mine | online | offline
  let teacherId = '';

  const toMin = (t) => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
  const fmtMin = (n) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const monday = (d) => Logic.addDays(d, 1 - Logic.weekday(d));

  // Уроки на дату со всей нужной информацией
  function itemsFor(date, classes, lessons, starts) {
    const byId = Object.fromEntries(classes.map((c) => [c.id, c]));
    return Logic.lessonsForDate(date, classes, lessons.filter((l) => l.date === date), starts)
      .filter((s) => byId[s.class_id])
      .map((s) => {
        const c = byId[s.class_id];
        const start = toMin(s.time);
        const st = s.lesson ? s.lesson.status : null;
        return {
          ...s, c, start, end: start + (c.duration || 60),
          off: st === 'rescheduled' || st === 'cancelled', // урока в это время нет
          status: st,
        };
      });
  }

  // Пересечения: два онлайн-урока одновременно (один Zoom) или учитель в двух местах
  function markConflicts(items) {
    const live = items.filter((x) => !x.off);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        if (a.start >= b.end || b.start >= a.end) continue;
        if (a.c.mode === 'online' && b.c.mode === 'online') { a.zoom = b.zoom = true; }
        if (a.c.teacher_id && a.c.teacher_id === b.c.teacher_id) { a.twice = b.twice = true; }
      }
    }
  }

  async function render(root, ctx) {
    root.innerHTML = `<div class="loading">Загрузка…</div>`;
    const t = Logic.today();
    if (!weekStart) weekStart = monday(t);
    const weekEnd = Logic.addDays(weekStart, 6);
    const inWeek = t >= weekStart && t <= weekEnd;
    const [sched, lessons, courses, todayLessons] = await Promise.all([
      DB.schoolSchedule(), DB.schoolLessons(weekStart, weekEnd), DB.courses(),
      inWeek ? Promise.resolve(null) : DB.schoolLessons(t, t),
    ]);
    const classes = sched.filter((c) => c.active);
    const starts = Object.fromEntries(classes.filter((c) => c.start_date).map((c) => [c.id, c.start_date]));
    const courseName = Object.fromEntries(courses.map((c) => [c.id, c.name]));
    const myId = ctx.teacher?.id;
    const teachers = [...new Map(classes.filter((c) => c.teacher_id).map((c) => [c.teacher_id, c.teacher_name || '—'])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]));

    // ---- сейчас в Zoom ----
    const todayItems = itemsFor(t, classes, todayLessons || lessons, starts);
    const nm = nowMin();
    const onlineToday = todayItems.filter((x) => !x.off && x.c.mode === 'online');
    const nowZoom = onlineToday.filter((x) => x.start <= nm && nm < x.end);
    const nextZoom = onlineToday.filter((x) => x.start > nm).sort((a, b) => a.start - b.start)[0];
    const zoomLine = (x) => `<b>${esc(x.time)}–${fmtMin(x.end)}</b> ${esc(x.c.name)} · ${esc(x.c.teacher_name || '')}`;

    // ---- неделя ----
    const filterItem = (x) =>
      (show !== 'mine' || x.c.teacher_id === myId) &&
      (show !== 'online' || x.c.mode === 'online') &&
      (show !== 'offline' || x.c.mode === 'offline') &&
      (!teacherId || x.c.teacher_id === teacherId);
    let days = '';
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const d = Logic.addDays(weekStart, i);
      const items = itemsFor(d, classes, lessons, starts);
      markConflicts(items);
      const shown = items.filter(filterItem);
      total += shown.filter((x) => !x.off).length;
      days += `
        <div class="wk-day ${d === t ? 'wk-today' : ''} ${shown.length ? '' : 'wk-empty-day'}">
          <div class="wk-head">${L.days[i + 1]} <span>${d.slice(8)}.${d.slice(5, 7)}</span></div>
          ${shown.length ? shown.map((x) => {
            const now = d === t && !x.off && x.start <= nm && nm < x.end;
            const note = x.status === 'rescheduled' ? `перенесён на ${fmtShort(x.lesson.moved_to_date)}`
              : x.status === 'cancelled' ? (x.lesson.caused_by ? 'отменён' : 'урока нет')
              : x.status === 'planned' && x.lesson.origin_id ? 'перенесён сюда' : '';
            return `
            <div class="wk-item wk-${x.c.mode} ${x.off ? 'wk-off' : ''} ${x.c.teacher_id === myId ? 'wk-mine' : ''} ${x.zoom || x.twice ? 'wk-clash' : ''} ${now ? 'wk-now' : ''}">
              <div class="wk-time">${esc(x.time)}–${fmtMin(x.end)} <span class="wk-mode">${x.c.mode === 'online' ? '🎥 онлайн' : '🏫 офлайн'}</span></div>
              <div class="wk-name">${esc(x.c.name)}</div>
              <div class="wk-meta">${esc(x.c.teacher_name || 'без учителя')} · ${esc(courseName[x.c.course_id] || '')}${x.c.kind === 'group' ? ` · ${x.c.students} уч.` : ''}</div>
              ${note ? `<div class="wk-note">${note}</div>` : ''}
              ${x.zoom ? `<div class="wk-warn">⚠ Zoom занят другим онлайн-уроком</div>` : ''}
              ${x.twice ? `<div class="wk-warn">⚠ У учителя два урока одновременно</div>` : ''}
              ${now ? `<div class="wk-live">● идёт сейчас</div>` : ''}
            </div>`;
          }).join('') : '<div class="wk-empty">—</div>'}
        </div>`;
    }

    root.innerHTML = `
      <div class="page-head">
        <h1>Расписание школы</h1>
      </div>

      <div class="zoom-box ${nowZoom.length ? 'busy' : 'free'}">
        ${nowZoom.length
          ? `<div>🎥 <b>Сейчас в Zoom${nowZoom.length > 1 ? ` (${nowZoom.length} урока — пересечение!)` : ''}:</b></div>${nowZoom.map((x) => `<div>${zoomLine(x)}</div>`).join('')}`
          : `<div>🎥 <b>Zoom сейчас свободен.</b></div>`}
        ${nextZoom ? `<div class="small">Следующий онлайн-урок сегодня: ${zoomLine(nextZoom)}</div>` : `<div class="small">Сегодня больше онлайн-уроков нет.</div>`}
      </div>

      <div class="toolbar">
        <div class="seg seg-inline">
          ${[['all', 'Все уроки'], ...(myId ? [['mine', 'Только мои']] : []), ['online', '🎥 Онлайн'], ['offline', '🏫 Офлайн']].map(([v, l]) =>
            `<label><input type="radio" name="wk-show" value="${v}" ${show === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        </div>
        <select id="wk-teacher">${options(teachers, teacherId, { empty: 'Все учителя' })}</select>
      </div>

      <div class="day-nav">
        <button class="btn" data-week="-1" aria-label="Предыдущая неделя">←</button>
        <div class="day-title"><span>${fmtShort(weekStart)} — ${fmtShort(weekEnd)}${inWeek ? ' · эта неделя' : ''}</span></div>
        <button class="btn" data-week="1" aria-label="Следующая неделя">→</button>
        ${inWeek ? '' : `<button class="btn btn-ghost" data-this-week>Эта неделя</button>`}
      </div>
      <p class="muted small">Уроков на неделе: ${total}.
        <span class="wk-legend wk-online">🎥 онлайн</span> <span class="wk-legend wk-offline">🏫 офлайн</span>
        <span class="wk-legend wk-clash">⚠ пересечение</span>${myId ? ' <span class="wk-legend wk-mine">мои уроки</span>' : ''}</p>
      <div class="wk-grid">${days}</div>
      ${!classes.length ? empty('Занятий пока нет') : ''}`;

    $$('[name=wk-show]', root).forEach((r) => r.onchange = () => { show = r.value; render(root, ctx); });
    $('#wk-teacher', root).onchange = (e) => { teacherId = e.target.value; render(root, ctx); };
    $$('[data-week]', root).forEach((b) => b.onclick = () => { weekStart = Logic.addDays(weekStart, 7 * Number(b.dataset.week)); render(root, ctx); });
    const tw = $('[data-this-week]', root);
    if (tw) tw.onclick = () => { weekStart = monday(t); render(root, ctx); };
  }

  window.WeekPage = { render };
})();
