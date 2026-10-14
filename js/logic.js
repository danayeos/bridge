// Чистые функции без обращения к базе: даты, расписание, расчёты.
// Работают и в браузере (window.Logic), и в Node (для тестов).
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');

  function toDateStr(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function today() { return toDateStr(new Date()); }
  function addDays(s, n) {
    const d = parseDate(s);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }
  // 1 = Пн ... 7 = Вс
  function weekday(s) {
    const w = parseDate(s).getDay();
    return w === 0 ? 7 : w;
  }
  function monthRange(ym) { // '2026-10' → ['2026-10-01', '2026-10-31']
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(last)}`];
  }

  // Уроки на дату: из расписания + уже записанные в базе.
  // classes: [{id, schedule:[{day,time}], active}], lessons: строки lessons на эту дату
  function lessonsForDate(date, classes, lessons) {
    const wd = weekday(date);
    const byKey = new Map();
    const result = [];
    for (const l of lessons) {
      if (l.date !== date) continue;
      if (!l.origin_id) byKey.set(`${l.class_id}|${l.time}`, l);
    }
    for (const c of classes) {
      if (!c.active) continue;
      // до создания занятия уроков по расписанию не было
      if (c.created_at && date < c.created_at.slice(0, 10)) continue;
      for (const slot of c.schedule || []) {
        if (Number(slot.day) !== wd) continue;
        const key = `${c.id}|${slot.time}`;
        const existing = byKey.get(key);
        result.push({ class_id: c.id, date, time: slot.time, lesson: existing || null });
        byKey.delete(key);
      }
    }
    // перенесённые сюда уроки и записанные вне расписания
    for (const l of lessons) {
      if (l.date !== date) continue;
      if (l.origin_id || byKey.has(`${l.class_id}|${l.time}`)) {
        result.push({ class_id: l.class_id, date, time: l.time, lesson: l });
      }
    }
    result.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    return result;
  }

  // Ученики, которые должны быть на уроке в эту дату
  function rosterFor(classId, date, roster) {
    return roster.filter((r) => r.class_id === classId && r.active && r.start_date <= date);
  }

  // Оплачивается ли урок учителю
  function teacherPaid(lesson) {
    if (lesson.teacher_paid !== null && lesson.teacher_paid !== undefined) return lesson.teacher_paid;
    return lesson.status === 'done';
  }

  // Зарплата по учителям: lessons — уроки за период
  function salaries(lessons) {
    const map = new Map();
    for (const l of lessons) {
      if (!l.teacher_id) continue;
      if (!map.has(l.teacher_id)) map.set(l.teacher_id, { teacher_id: l.teacher_id, count: 0, sum: 0, fines: 0, fineCount: 0 });
      const s = map.get(l.teacher_id);
      if (teacherPaid(l)) { s.count += 1; s.sum += l.rate || 0; }
      if (l.fine) { s.fines += l.fine; s.fineCount += 1; }
    }
    for (const s of map.values()) s.total = s.sum - s.fines;
    return [...map.values()];
  }

  // Статус оплаты ученика по остатку уроков
  function payStatus(enrollment, remaining) {
    if (enrollment.plan === 'support') return 'support';
    if (remaining < 0) return 'debt';
    if (remaining <= 1) return 'due';
    return 'ok';
  }

  const api = { toDateStr, parseDate, today, addDays, weekday, monthRange, lessonsForDate, rosterFor, teacherPaid, salaries, payStatus };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Logic = api;
})(typeof window !== 'undefined' ? window : globalThis);
