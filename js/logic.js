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

  // ---------- Расписание с историей ----------
  // Слот: {day, time, from?, to?} — from/to: с какой и по какую дату он действует.
  function slotActive(slot, date) {
    return (!slot.from || slot.from <= date) && (!slot.to || date <= slot.to);
  }
  // Слоты, которые действуют сейчас или начнутся позже (не закончились до date)
  function currentSchedule(schedule, date) {
    return (schedule || []).filter((s) => !s.to || s.to >= date);
  }
  // Новое расписание next действует с даты from; старые слоты закрываются накануне.
  function mergeSchedule(old, next, from) {
    const key = (s) => `${s.day}|${s.time}`;
    const nextKeys = new Set(next.map(key));
    const kept = new Set();
    const prevDay = addDays(from, -1);
    const out = [];
    for (const s of old || []) {
      if (s.to && s.to < from) { out.push(s); continue; } // уже в истории
      if (nextKeys.has(key(s)) && !kept.has(key(s))) {
        const k = { day: s.day, time: s.time };
        if (s.from) k.from = s.from > from ? from : s.from;
        out.push(k);
        kept.add(key(s));
      } else if (!s.from || s.from < from) {
        out.push({ ...s, to: prevDay });
      }
    }
    for (const n of next) {
      if (kept.has(key(n))) continue;
      kept.add(key(n));
      out.push({ day: n.day, time: n.time, from });
    }
    return out;
  }

  // Уроки на дату: из расписания + уже записанные в базе.
  // classes: [{id, schedule:[{day,time}], active}], lessons: строки lessons на эту дату
  // starts (необязательно): {class_id: дата начала самого раннего ученика}
  function lessonsForDate(date, classes, lessons, starts) {
    const wd = weekday(date);
    const byKey = new Map();
    const result = [];
    for (const l of lessons) {
      if (l.date !== date) continue;
      if (!l.origin_id) byKey.set(`${l.class_id}|${l.time}`, l);
    }
    for (const c of classes) {
      if (!c.active) continue;
      // пока в занятии нет учеников, уроков по расписанию нет
      if (starts && !(starts[c.id] && starts[c.id] <= date)) continue;
      for (const slot of c.schedule || []) {
        if (Number(slot.day) !== wd || !slotActive(slot, date)) continue;
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

  // До какой даты хватит оплаченных уроков: дата последнего оплаченного урока по расписанию.
  // remaining — сколько уроков осталось; считаем уроки начиная с даты from (включительно).
  function paidUntil(cls, remaining, from) {
    if (remaining <= 0 || !cls || !currentSchedule(cls.schedule, from).length) return null;
    let left = remaining;
    for (let d = from, i = 0; i < 400; d = addDays(d, 1), i++) {
      const wd = weekday(d);
      for (const s of cls.schedule || []) {
        if (Number(s.day) === wd && slotActive(s, d)) { left -= 1; if (left === 0) return d; }
      }
    }
    return null;
  }

  // Дата начала каждого занятия = самый ранний start_date его учеников
  function classStarts(roster) {
    const out = {};
    for (const r of roster) {
      if (!out[r.class_id] || r.start_date < out[r.class_id]) out[r.class_id] = r.start_date;
    }
    return out;
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

  const api = { toDateStr, parseDate, today, addDays, weekday, monthRange, lessonsForDate, rosterFor, classStarts, slotActive, currentSchedule, mergeSchedule, paidUntil, teacherPaid, salaries, payStatus };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Logic = api;
})(typeof window !== 'undefined' ? window : globalThis);
