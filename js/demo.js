// ДЕМО-режим: открывается по адресу index.html?demo — данные выдуманные и живут только до перезагрузки.
// В обычном режиме этот файл ничего не делает.
if (/[?&]demo/.test(location.search)) {
  window.BRIDGE_DEMO = true;
  window.BRIDGE_CONFIG = { SUPABASE_URL: 'http://demo', SUPABASE_ANON_KEY: 'demo' };
  // Поддельная база в памяти браузера (подмена supabase-js).
  (function () {
    let n = 0;
    const uid = () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;
    const T = { profiles: [], teachers: [], courses: [], classes: [], students: [], enrollments: [], payments: [], lessons: [], attendance: [] };
    window.__T = T;
    const ROLE = new URLSearchParams(location.search).get('as') === 'teacher' ? 'teacher' : 'admin';
    const ADMIN = uid(), TEACH = uid();
    T.profiles.push({ id: ADMIN, email: 'admin@bridge.kz', full_name: 'Админ', role: 'admin' });
    T.profiles.push({ id: TEACH, email: 'aigerim@bridge.kz', full_name: 'Айгерим', role: 'teacher' });
    T.profiles.push({ id: uid(), email: 'new@bridge.kz', full_name: 'Новый Учитель', role: 'pending' });
    ['SAT', 'IELTS', 'NUET', 'Математика', 'Английский'].forEach((name, i) => T.courses.push({ id: i + 1, name }));
    const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    const addDays = (s, k) => { const [y, m, d] = s.split('-').map(Number); const x = new Date(y, m - 1, d + k); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    const wd = (s) => { const [y, m, d] = s.split('-').map(Number); const w = new Date(y, m - 1, d).getDay(); return w || 7; };

    const t1 = { id: uid(), full_name: 'Айгерим Сапарова', user_id: TEACH, active: true };
    const t2 = { id: uid(), full_name: 'Данияр Ахметов', user_id: null, active: true };
    T.teachers.push(t1, t2);
    const allDays = [1, 2, 3, 4, 5, 6, 7];
    const c1 = { id: uid(), name: 'Ясина — Математика', course_id: 4, teacher_id: t1.id, kind: 'individual', mode: 'offline', teacher_rate: 7500, schedule: [{ day: wd(today), time: '16:00' }, { day: wd(addDays(today, 2)), time: '16:00' }], active: true };
    const c2 = { id: uid(), name: 'IELTS вечер', course_id: 2, teacher_id: t1.id, kind: 'group', mode: 'online', teacher_rate: 5000, schedule: [{ day: wd(today), time: '18:00' }], active: true };
    const c3 = { id: uid(), name: 'SAT утро', course_id: 1, teacher_id: t2.id, kind: 'group', mode: 'offline', teacher_rate: 6000, schedule: [{ day: wd(addDays(today, -1)), time: '10:00' }], active: true };
    T.classes.push(c1, c2, c3);
    T.classes.forEach((c) => { c.duration = c.kind === 'group' ? 90 : 60; c.rate_history = []; });
    const s = ['Ясина', 'Алихан Нуров', 'Мадина Ким', 'Тимур Абаев'].map((full_name) => ({ id: uid(), full_name, note: null, active: true }));
    T.students.push(...s);
    const e = (st, c, extra = {}) => { const r = { id: uid(), student_id: st.id, class_id: c.id, plan: 'package', package_lessons: 8, package_price: 80000, start_date: addDays(today, -60), initial_lessons: 0, active: true, ...extra }; T.enrollments.push(r); return r; };
    const e1 = e(s[0], c1);
    const e2 = e(s[1], c2, { package_lessons: 12, package_price: 60000 });
    const e3 = e(s[2], c2, { package_lessons: 12, package_price: 60000, initial_lessons: 5 });
    e(s[3], c3, { plan: 'support', package_price: 0 });
    e(s[1], c3, { package_price: 90000, pay_with: e2.id }); // одна оплата с IELTS
    T.payments.push({ id: uid(), enrollment_id: e1.id, paid_at: addDays(today, -30), amount: 80000, lessons: 8, note: null });
    T.payments.push({ id: uid(), enrollment_id: e2.id, paid_at: addDays(today, -3), amount: 60000, lessons: 12, note: null });
    for (let i = 0; i < 7; i++) {
      const l = { id: uid(), class_id: c1.id, teacher_id: t1.id, date: addDays(today, -28 + i * 3), time: '16:00', status: 'done', origin_id: null, rate: 7500, teacher_paid: null, fine: 0, reviewed: false, caused_by: null, reason: null, reason_text: null, moved_to_date: null, moved_to_time: null, comment: null };
      T.lessons.push(l);
      T.attendance.push({ lesson_id: l.id, enrollment_id: e1.id, present: i !== 6, decision: null });
    }
    T.lessons.push({ id: uid(), class_id: c1.id, teacher_id: t1.id, date: addDays(today, -5), time: '16:00', status: 'rescheduled', origin_id: null, rate: 7500, teacher_paid: null, fine: 0, reviewed: false, caused_by: 'teacher', reason: 'overslept', reason_text: null, moved_to_date: addDays(today, 1), moved_to_time: '17:00', comment: null });

    // ---------- query builder ----------
    const views = {
      enrollment_stats: () => T.enrollments.map((en) => {
        const ps = T.payments.filter((p) => p.enrollment_id === en.id);
        const used = T.attendance.filter((a) => a.enrollment_id === en.id && (a.present || a.decision === 'burned') &&
          ['done', 'cancelled'].includes(T.lessons.find((l) => l.id === a.lesson_id)?.status)).length;
        const paid = en.initial_lessons + ps.reduce((x, p) => x + p.lessons, 0);
        return { enrollment_id: en.id, paid_lessons: paid, used_lessons: used, remaining: paid - used, last_payment: ps.map((p) => p.paid_at).sort().pop() || null, account_id: en.pay_with || en.id };
      }),
    };
    const clone = (o) => JSON.parse(JSON.stringify(o));
    function from(table) {
      const st = { table, filters: [], orders: [], op: 'select', sel: '*', single: false, maybe: false, payload: null, ret: false, range: null };
      const rowsOf = () => (views[table] ? views[table]() : T[table]);
      const match = (r) => st.filters.every((f) => f(r));
      const embed = (r) => {
        const out = clone(r);
        if (/attendance\(\*\)/.test(st.sel)) out.attendance = clone(T.attendance.filter((a) => a.lesson_id === r.id));
        if (/lessons\(\*\)/.test(st.sel)) out.lessons = clone(T.lessons.find((l) => l.id === r.lesson_id) || null);
        return out;
      };
      function guard(row, isNew) {
        if (table === 'lessons') {
          if (isNew) { const c = T.classes.find((x) => x.id === row.class_id); row.teacher_id ??= c?.teacher_id; if (!row.rate) row.rate = c?.teacher_rate || 0; }
          if (ROLE !== 'admin' && isNew) { row.fine = 0; row.teacher_paid = null; row.reviewed = false; }
        }
        if (table === 'attendance' && ROLE !== 'admin') {
          const l = T.lessons.find((x) => x.id === row.lesson_id); const c = T.classes.find((x) => x.id === l?.class_id);
          if (row.present) row.decision = null; else if (c?.kind === 'group') row.decision = 'burned'; else row.decision ??= null;
        }
      }
      async function exec() {
        await new Promise((r) => setTimeout(r, 5));
        try {
          let data;
          if (st.op === 'select') {
            data = rowsOf().filter(match).map(embed);
            for (const [col, asc] of [...st.orders].reverse()) data.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
            if (st.range) data = data.slice(st.range[0], st.range[1] + 1);
          } else if (st.op === 'insert' || st.op === 'upsert') {
            const rows = (Array.isArray(st.payload) ? st.payload : [st.payload]).map(clone);
            data = [];
            for (const r of rows) {
              if (table !== 'attendance' && !r.id) r.id = uid();
              const defaults = { lessons: { origin_id: null, fine: 0, teacher_paid: null, reviewed: false, rate: 0 }, enrollments: { active: true, plan: 'package', pay_with: null }, students: { active: true }, classes: { active: true, schedule: [] }, teachers: { active: true, user_id: null }, attendance: { decision: null } }[table] || {};
              const row = { ...defaults, ...r };
              if (table === 'attendance') {
                const ex = T.attendance.find((a) => a.lesson_id === row.lesson_id && a.enrollment_id === row.enrollment_id);
                if (ex) { if (ROLE !== 'admin' && !ex.present && !row.present) row.decision = ex.decision; else guard(row, true); Object.assign(ex, row); data.push(ex); continue; }
              }
              if (table === 'lessons' && !row.origin_id && T.lessons.some((l) => !l.origin_id && l.class_id === row.class_id && l.date === row.date && l.time === row.time)) throw new Error('duplicate key value violates unique constraint');
              guard(row, true);
              T[table].push(row); data.push(row);
            }
            data = clone(data);
          } else if (st.op === 'update') {
            data = [];
            for (const r of T[table].filter(match)) {
              const patch = clone(st.payload);
              if (ROLE !== 'admin' && table === 'lessons') { delete patch.fine; delete patch.teacher_paid; delete patch.rate; }
              Object.assign(r, patch); data.push(clone(r));
            }
          } else if (st.op === 'delete') {
            const del = T[table].filter(match);
            T[table] = T[table].filter((r) => !match(r));
            if (table === 'lessons') { const ids = new Set(del.map((d) => d.id)); T.attendance = T.attendance.filter((a) => !ids.has(a.lesson_id)); T.lessons.forEach((l) => { if (ids.has(l.origin_id)) l.origin_id = null; }); }
            if (table === 'students') { const ids = new Set(del.map((d) => d.id)); T.enrollments = T.enrollments.filter((x) => !ids.has(x.student_id)); }
            if (table === 'enrollments' || table === 'students') { const ids = new Set(T.enrollments.map((x) => x.id)); T.payments = T.payments.filter((p) => ids.has(p.enrollment_id)); T.attendance = T.attendance.filter((a) => ids.has(a.enrollment_id)); T.enrollments.forEach((x) => { if (x.pay_with && !ids.has(x.pay_with)) x.pay_with = null; }); }
            if (table === 'classes') { const ids = new Set(del.map((d) => d.id)); T.enrollments = T.enrollments.filter((x) => !ids.has(x.class_id)); T.lessons = T.lessons.filter((x) => !ids.has(x.class_id)); }
            window.__T = T;
            data = null;
          }
          if (st.single || st.maybe) {
            if (!data.length) return st.maybe ? { data: null, error: null } : { data: null, error: { message: 'no rows' } };
            return { data: data[0], error: null };
          }
          return { data, error: null };
        } catch (err) { return { data: null, error: { message: err.message } }; }
      }
      const b = {
        select(sel = '*') { if (st.op === 'select') st.sel = sel; else st.ret = true; return b; },
        insert(p) { st.op = 'insert'; st.payload = p; return b; },
        upsert(p) { st.op = 'upsert'; st.payload = p; return b; },
        update(p) { st.op = 'update'; st.payload = p; return b; },
        delete() { st.op = 'delete'; return b; },
        eq(c, v) { st.filters.push((r) => String(r[c]) === String(v)); return b; },
        gte(c, v) { st.filters.push((r) => r[c] >= v); return b; },
        lte(c, v) { st.filters.push((r) => r[c] <= v); return b; },
        in(c, vs) { st.filters.push((r) => vs.includes(r[c])); return b; },
        not(c, op, v) { const vs = v.replace(/[()]/g, '').split(','); st.filters.push((r) => !vs.includes(r[c])); return b; },
        order(c, o = {}) { st.orders.push([c, o.ascending !== false]); return b; },
        range(a, z) { st.range = [a, z]; return b; },
        single() { st.single = true; return b; },
        maybeSingle() { st.maybe = true; return b; },
        then(res, rej) { return exec().then(res, rej); },
      };
      return b;
    }

    const me = ROLE === 'admin' ? T.profiles[0] : T.profiles[1];
    const session = { user: { id: me.id, email: me.email } };
    window.supabase = {
      createClient() {
        return {
          from,
          async rpc(name) {
            if (name === 'school_schedule') {
              return { data: T.classes.map((c) => ({ id: c.id, name: c.name, course_id: c.course_id, teacher_id: c.teacher_id,
                teacher_name: T.teachers.find((t) => t.id === c.teacher_id)?.full_name || null, kind: c.kind, mode: c.mode,
                schedule: c.schedule, duration: c.duration || 60, active: c.active,
                start_date: T.enrollments.filter((e) => e.class_id === c.id).map((e) => e.start_date).sort()[0] || null,
                students: T.enrollments.filter((e) => e.class_id === c.id && e.active).length })), error: null };
            }
            if (name === 'school_lessons') {
              return { data: T.lessons.filter((l) => l.date >= arguments[1].d1 && l.date <= arguments[1].d2)
                .map(({ id, class_id, date, time, status, origin_id, moved_to_date, moved_to_time }) => ({ id, class_id, date, time, status, origin_id, moved_to_date, moved_to_time })), error: null };
            }
            if (name !== 'class_roster') throw new Error('rpc');
            const myT = T.teachers.find((t) => t.user_id === me.id);
            const rows = T.enrollments.filter((en) => ROLE === 'admin' || T.classes.find((c) => c.id === en.class_id)?.teacher_id === myT?.id)
              .map((en) => { const st = T.students.find((x) => x.id === en.student_id); return { enrollment_id: en.id, class_id: en.class_id, student_id: st.id, student_name: st.full_name, start_date: en.start_date, active: en.active && st.active }; });
            return { data: rows, error: null };
          },
          auth: {
            async getSession() { return { data: { session }, error: null }; },
            onAuthStateChange() {},
            async signOut() {},
          },
        };
      },
    };
  })();
}
