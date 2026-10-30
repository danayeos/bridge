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
      if (c.kind === 'intensive') {
        // интенсив идёт только в свои даты (учеников в нём нет)
        if (!c.start_date || date < c.start_date || (c.end_date && date > c.end_date)) continue;
      } else if (starts && !(starts[c.id] && starts[c.id] <= date)) {
        continue; // пока в занятии нет учеников, уроков по расписанию нет
      }
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

  // Текущий пакет: оплатили 24, прошло 18 → это 2-й пакет из 12: прошло 6, осталось 6.
  // ahead — сколько целых пакетов оплачено заранее (после текущего).
  function packProgress(remaining, pkg) {
    pkg = pkg > 0 ? pkg : 8;
    if (remaining <= 0) return { size: pkg, done: pkg, left: 0, ahead: 0 };
    const left = ((remaining - 1) % pkg) + 1;
    return { size: pkg, done: pkg - left, left, ahead: Math.floor((remaining - 1) / pkg) };
  }

  // Сопровождение: срок хранится в package_lessons как 1000 + число месяцев (1000 — до конца, до поступления).
  // Так старые записи (там просто 8 — размер пакета по умолчанию) не путаются со сроком и считаются «до конца».
  const SUP_BASE = 1000;
  function supportMonths(e) {
    const v = Number(e.package_lessons);
    return v >= SUP_BASE ? v - SUP_BASE : 0;
  }
  const encodeSupport = (months) => SUP_BASE + (Number(months) || 0);
  // Возвращает дату окончания сопровождения или null («до конца»).
  function supportUntil(e) {
    const months = supportMonths(e);
    if (!months || !e.start_date) return null;
    const [y, m, d] = e.start_date.split('-').map(Number);
    const end = new Date(y, m - 1 + months, d);
    return toDateStr(end);
  }
  const SUPPORT_TERMS = [[6, '6 месяцев'], [12, '1 год'], [24, '2 года'], [0, 'До конца (до поступления)']];

  // ---------- Способы оплаты: комиссия банка и налог (это разные вещи, храним отдельно) ----------
  // Стартовые ставки, %. Администратор меняет их в «Деньги → Способы оплаты» (таблица settings).
  // У рассрочки комиссия зависит от срока; null — ставку ещё не вписали.
  const PAY_METHODS = [
    { id: 'kaspi', name: 'Kaspi Pay', fee: 0.95, tax: 3 },
    { id: 'kaspi_credit', name: 'Kaspi Pay рассрочка', tax: 3, terms: { 3: null, 6: null, 12: 15.5, 24: 17.5 } },
    { id: 'gold', name: 'Алтын → Kaspi Gold', fee: 0, tax: 0 },
    { id: 'halyk', name: 'Алтын → Halyk', fee: 0, tax: 0 },
    { id: 'cash', name: 'Наличные', fee: 0, tax: 0 },
    { id: 'kaspi_transfer', name: 'Kaspi перевод', fee: 0, tax: 0 },
  ];
  // Сохранённые ставки поверх стартовых (новые способы из кода появятся сами)
  function payMethods(saved) {
    return PAY_METHODS.map((d) => {
      const s = (saved || []).find((x) => x.id === d.id) || {};
      return { ...d, ...s, name: d.name, ...(d.terms ? { terms: { ...d.terms, ...(s.terms || {}) } } : {}) };
    });
  }
  const isRate = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));
  // Ставки способа на сегодня: {fee_pct, tax_pct}; null — ставка (например, рассрочки на 3 мес.) не указана.
  function methodRates(methods, id, term) {
    const m = (methods || PAY_METHODS).find((x) => x.id === id);
    if (!m) return null;
    const fee = m.terms ? m.terms[term] : m.fee;
    if (!isRate(fee)) return null;
    return { fee_pct: Number(fee), tax_pct: Number(m.tax) || 0 };
  }
  // Налог — всегда от полной суммы, которую заплатил клиент (не от суммы после комиссии).
  function payCalc(amount, fee_pct, tax_pct) {
    const fee = Math.round(((amount || 0) * (fee_pct || 0)) / 100);
    const tax = Math.round(((amount || 0) * (tax_pct || 0)) / 100);
    return { fee, tax, net: (amount || 0) - fee - tax };
  }
  // «На руки» у оплаты; у старых оплат без способа — вся сумма
  const payNet = (p) => (p.net !== null && p.net !== undefined ? p.net : (p.amount || 0) - (p.fee || 0) - (p.tax || 0));

  // ---------- Месяцы ----------
  function addMonths(ym, n) { // '2026-10' + 3 → '2027-01'
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  // Сколько месяцев от месяца даты from до месяца даты to включительно (минимум 1): окт 2026 → окт 2027 = 13
  function monthsSpan(from, to) {
    const [y1, m1] = from.split('-').map(Number);
    const [y2, m2] = to.split('-').map(Number);
    return Math.max(1, (y2 - y1) * 12 + (m2 - m1) + 1);
  }

  // ---------- Сопровождение ученика (тип оплаты на уровне ученика) ----------
  // Оплаты сопровождения ДО этой даты получены давно: в доход не входят никогда, только справочно.
  const SUPPORT_CUTOFF = '2026-09-01';
  const isSupportStudent = (s) => !!s && s.pay_type === 'support';
  // Сопровождение «≈ в месяц»: все оплаты / месяцы от первой оплаты до окончания. null — нет данных.
  function supportPerMonth(sps, until) {
    if (!until || !sps.length) return null;
    const first = sps.map((p) => p.paid_at).sort()[0];
    return Math.round(sps.reduce((n, p) => n + (p.amount || 0), 0) / monthsSpan(first, until));
  }
  // Доли одной оплаты по месяцам: поровну от месяца оплаты до месяца окончания включительно,
  // остаток от округления — в последний месяц (сумма долей = оплате). null — нет даты окончания.
  function supportShares(sp, until) {
    if (!until) return null;
    const n = monthsSpan(sp.paid_at, until);
    const net = payNet(sp), gross = sp.amount || 0;
    const bn = Math.floor(net / n), bg = Math.floor(gross / n);
    const out = [];
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      out.push({ month: addMonths(sp.paid_at.slice(0, 7), i), net: last ? net - bn * (n - 1) : bn, gross: last ? gross - bg * (n - 1) : bg, of: n });
    }
    return out;
  }

  // ---------- Отчёты по месяцам (из них потом строится финтаблица) ----------
  const money0 = () => ({ count: 0, gross: 0, fee: 0, tax: 0, net: 0 });
  function addPay(b, p) {
    b.count += 1; b.gross += p.amount || 0; b.fee += p.fee || 0; b.tax += p.tax || 0; b.net += payNet(p);
  }
  // Оплата из таблицы payments, которая считается в доходе: не перенесённая в сопровождение ученика
  // и не старое сопровождение курса до даты отсечки. legacySupport — id курсов со старым сопровождением.
  const countsAsIncome = (p, legacySupport) => !p.migrated && !(legacySupport && legacySupport.has(p.enrollment_id) && p.paid_at < SUPPORT_CUTOFF);

  // ФАКТИЧЕСКИЙ доход: сколько денег реально пришло в месяц (вся оплата — в месяц даты оплаты).
  // → { 'YYYY-MM': { count, gross, fee, tax, net, packages, support, byMethod: { method: {...} } } }
  function actualIncome(payments, supportPayments, legacySupport) {
    const out = {};
    const add = (p, kind) => {
      const mo = p.paid_at.slice(0, 7);
      const r = out[mo] ||= { ...money0(), packages: money0(), support: money0(), byMethod: {} };
      addPay(r, p); addPay(r[kind], p); addPay(r.byMethod[p.method || ''] ||= money0(), p);
    };
    for (const p of payments) if (countsAsIncome(p, legacySupport)) add(p, legacySupport && legacySupport.has(p.enrollment_id) ? 'support' : 'packages');
    for (const sp of supportPayments) if (sp.paid_at >= SUPPORT_CUTOFF) add(sp, 'support');
    return out;
  }

  // ЗАРАБОТАННЫЙ доход: пакеты — в месяц оплаты, сопровождение — доля «на руки» в каждый месяц до окончания.
  // untilOf(sp) — дата окончания сопровождения этого ученика.
  // → { months: { 'YYYY-MM': { gross, net, packages: {gross, net}, support: {gross, net, items: [...]} } }, noUntil: [оплаты без даты окончания] }
  function earnedIncome(payments, supportPayments, untilOf, legacySupport) {
    const months = {};
    const noUntil = [];
    const row = (mo) => months[mo] ||= { gross: 0, net: 0, packages: { gross: 0, net: 0 }, support: { gross: 0, net: 0, items: [] } };
    for (const p of payments) {
      if (!countsAsIncome(p, legacySupport)) continue;
      const r = row(p.paid_at.slice(0, 7));
      const kind = legacySupport && legacySupport.has(p.enrollment_id) ? 'support' : 'packages';
      r.gross += p.amount || 0; r.net += payNet(p);
      r[kind].gross += p.amount || 0; r[kind].net += payNet(p);
      if (kind === 'support') r.support.items.push({ payment: p, gross: p.amount || 0, net: payNet(p), of: 1 });
    }
    for (const sp of supportPayments) {
      if (sp.paid_at < SUPPORT_CUTOFF) continue;
      const shares = supportShares(sp, untilOf(sp));
      if (!shares) { noUntil.push(sp); continue; }
      for (const sh of shares) {
        const r = row(sh.month);
        r.gross += sh.gross; r.net += sh.net; r.support.gross += sh.gross; r.support.net += sh.net;
        r.support.items.push({ payment: sp, gross: sh.gross, net: sh.net, of: sh.of });
      }
    }
    return { months, noUntil };
  }

  // ---------- Перенос старого сопровождения (на уровне курса) в сопровождение ученика ----------
  // Ничего не меняет — только раскладывает учеников: auto (переносим), mixed и conflicts (решает администратор).
  function planSupportMigration({ students, enrollments, payments }) {
    const auto = [], mixed = [], conflicts = [];
    for (const s of students) {
      const all = enrollments.filter((e) => e.student_id === s.id);
      const sup = all.filter((e) => e.plan === 'support');
      if (!sup.length) continue;
      const pays = payments.filter((p) => !p.migrated && sup.some((e) => e.id === p.enrollment_id));
      if (isSupportStudent(s) && !pays.length) continue; // уже перенесён
      // смотрим на курсы, на которые ученик ходит сейчас (если таких нет — на все)
      const act = all.filter((e) => e.active);
      const ens = act.length ? act : all;
      if (ens.some((e) => e.plan !== 'support')) { mixed.push({ student: s, support: sup, other: ens.filter((e) => e.plan !== 'support') }); continue; }
      const untils = [...new Set(sup.map((e) => supportUntil(e) || ''))];
      const reasons = [];
      if (untils.length > 1) reasons.push(`у курсов разные сроки: ${untils.map((u) => u || 'до конца').join(', ')}`);
      if (pays.length > 1) reasons.push(`несколько строк оплаты сопровождения (${pays.length})`);
      const price = sup.reduce((n, e) => n + (e.package_price || 0), 0);
      if (pays.length === 1 && price && pays[0].amount !== price) reasons.push(`оплата ${pays[0].amount} ₸, а цена сопровождения ${price} ₸`);
      if (reasons.length) { conflicts.push({ student: s, reasons, payments: pays, enrollments: sup }); continue; }
      auto.push({ student: s, until: untils[0] || null, payments: pays, enrollments: sup });
    }
    return { auto, mixed, conflicts };
  }

  const api = { PAY_METHODS, payMethods, methodRates, payCalc, payNet, addMonths, monthsSpan, SUPPORT_CUTOFF, isSupportStudent, supportPerMonth, supportShares, actualIncome, earnedIncome, planSupportMigration,
    supportUntil, supportMonths, encodeSupport, SUPPORT_TERMS, packProgress, toDateStr, parseDate, today, addDays, weekday, monthRange, lessonsForDate, rosterFor, classStarts, slotActive, currentSchedule, mergeSchedule, paidUntil, teacherPaid, salaries, payStatus };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Logic = api;
})(typeof window !== 'undefined' ? window : globalThis);
