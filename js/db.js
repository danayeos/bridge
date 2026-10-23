// Работа с базой Supabase.
(function () {
  const cfg = window.BRIDGE_CONFIG;
  const configured = cfg && cfg.SUPABASE_URL.startsWith('http');
  const sb = configured ? supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  function check({ data, error }) {
    if (error) throw new Error(translate(error.message));
    return data;
  }
  function translate(msg) {
    if (/Invalid login credentials/i.test(msg)) return 'Неверный email или пароль';
    if (/already registered/i.test(msg)) return 'Этот email уже зарегистрирован';
    if (/Password should be at least/i.test(msg)) return 'Пароль должен быть не короче 6 символов';
    if (/Email not confirmed/i.test(msg)) return 'Email не подтверждён — проверьте почту';
    if (/duplicate key/i.test(msg)) return 'Такая запись уже есть';
    if (/row-level security/i.test(msg)) return 'Нет доступа';
    if (/rate_history/i.test(msg)) return 'Сначала обновите базу: запустите файл supabase/update-1-rate-history.sql в Supabase → SQL Editor';
    return msg;
  }

  // Забирает все строки (Supabase отдаёт максимум 1000 за раз)
  async function all(build) {
    const size = 1000;
    let from = 0, out = [];
    for (;;) {
      const rows = check(await build().range(from, from + size - 1));
      out = out.concat(rows);
      if (rows.length < size) return out;
      from += size;
    }
  }

  const DB = {
    sb,
    configured,
    check,

    // ----- аккаунт -----
    async session() { return check(await sb.auth.getSession()).session; },
    async signIn(email, password) { return check(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(email, password, full_name) {
      return check(await sb.auth.signUp({ email, password, options: { data: { full_name } } }));
    },
    async signOut() { await sb.auth.signOut(); },
    async me() {
      const s = await DB.session();
      if (!s) return null;
      const profile = check(await sb.from('profiles').select('*').eq('id', s.user.id).maybeSingle());
      const teacher = check(await sb.from('teachers').select('*').eq('user_id', s.user.id).maybeSingle());
      return { user: s.user, profile, teacher };
    },

    // ----- справочники -----
    courses: () => all(() => sb.from('courses').select('*').order('id')),
    teachers: () => all(() => sb.from('teachers').select('*').order('full_name')),
    profiles: () => all(() => sb.from('profiles').select('*').order('created_at')),
    classes: () => all(() => sb.from('classes').select('*').order('name')),
    students: () => all(() => sb.from('students').select('*').order('full_name')),
    enrollments: () => all(() => sb.from('enrollments').select('*').order('created_at')),
    stats: () => all(() => sb.from('enrollment_stats').select('*')),
    roster: async () => check(await sb.rpc('class_roster')),

    payments(from, to) {
      return all(() => {
        let q = sb.from('payments').select('*').order('paid_at', { ascending: false });
        if (from) q = q.gte('paid_at', from);
        if (to) q = q.lte('paid_at', to);
        return q;
      });
    },
    paymentsOf: (enrollmentIds) =>
      all(() => sb.from('payments').select('*').in('enrollment_id', enrollmentIds).order('paid_at', { ascending: false })),

    lessons(from, to) {
      return all(() => sb.from('lessons').select('*, attendance(*)').gte('date', from).lte('date', to).order('date').order('time'));
    },
    attendanceOf: (enrollmentIds) =>
      all(() => sb.from('attendance').select('*, lessons(*)').in('enrollment_id', enrollmentIds)),

    // ----- запись -----
    async insert(table, row) { return check(await sb.from(table).insert(row).select().single()); },
    async update(table, id, patch) { return check(await sb.from(table).update(patch).eq('id', id).select().single()); },
    async remove(table, id) { return check(await sb.from(table).delete().eq('id', id)); },

    // Сохранить отметку урока.
    // slot: {class_id, date, time, lesson}; data: {status, ..., attendance: [{enrollment_id, present}]}
    async saveLesson(slot, data) {
      const fields = {
        status: data.status,
        moved_to_date: data.moved_to_date || null,
        moved_to_time: data.moved_to_time || null,
        caused_by: data.caused_by || null,
        reason: data.reason || null,
        reason_text: data.reason_text || null,
        comment: data.comment || null,
      };
      let lesson;
      if (slot.lesson) {
        lesson = await DB.update('lessons', slot.lesson.id, fields);
      } else {
        lesson = await DB.insert('lessons', { class_id: slot.class_id, date: slot.date, time: slot.time, ...fields });
      }

      // посещаемость
      check(await sb.from('attendance').delete().eq('lesson_id', lesson.id)
        .not('enrollment_id', 'in', `(${(data.attendance || []).map((a) => a.enrollment_id).join(',') || '00000000-0000-0000-0000-000000000000'})`));
      if (data.attendance && data.attendance.length) {
        check(await sb.from('attendance').upsert(
          data.attendance.map((a) => ({ lesson_id: lesson.id, enrollment_id: a.enrollment_id, present: a.present })),
          { onConflict: 'lesson_id,enrollment_id' }));
      }

      // перенос: создаём (или двигаем) урок на новую дату
      const moved = check(await sb.from('lessons').select('*').eq('origin_id', lesson.id));
      if (data.status === 'rescheduled' && data.moved_to_date) {
        const target = { date: data.moved_to_date, time: data.moved_to_time || slot.time };
        if (moved.length) {
          if (moved[0].status === 'planned') await DB.update('lessons', moved[0].id, target);
        } else {
          await DB.insert('lessons', { class_id: slot.class_id, status: 'planned', origin_id: lesson.id, ...target });
        }
      } else {
        for (const m of moved) if (m.status === 'planned') await DB.remove('lessons', m.id);
      }
      return lesson;
    },
  };

  window.DB = DB;
})();
