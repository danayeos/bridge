// Учителя и аккаунты (кто может входить на сайт).
(function () {
  const { esc, $, $$, money, toast, modal, confirmBox, formData, options, busy, schedText, empty } = UI;
  const ROLE = { pending: 'Ждёт подтверждения', teacher: 'Учитель', admin: 'Администратор' };

  async function render(root, app) {
    root.innerHTML = `<div class="loading">Загрузка…</div>`;
    const [teachers, profiles, classes, courses] = await Promise.all([DB.teachers(), DB.profiles(), DB.classes(), DB.courses()]);
    const courseName = Object.fromEntries(courses.map((c) => [c.id, c.name]));
    const profById = Object.fromEntries(profiles.map((p) => [p.id, p]));
    const teacherByUser = Object.fromEntries(teachers.filter((t) => t.user_id).map((t) => [t.user_id, t]));
    const pending = profiles.filter((p) => p.role === 'pending');

    root.innerHTML = `
      <div class="page-head">
        <h1>Учителя</h1>
        <button class="btn btn-primary" id="add-t">+ Новый учитель</button>
      </div>

      ${pending.length ? `
      <section class="section alert">
        <h2>Новые аккаунты ждут подтверждения <span class="count">${pending.length}</span></h2>
        <div class="list">${pending.map((p) => `
          <div class="list-row">
            <div class="who"><b>${esc(p.full_name || p.email)}</b><span class="muted small">${esc(p.email)}</span></div>
            <div class="btn-group">
              <button class="btn btn-sm btn-primary" data-approve="${p.id}">Это учитель</button>
              <button class="btn btn-sm" data-make-admin="${p.id}">Сделать админом</button>
            </div>
          </div>`).join('')}</div>
      </section>` : ''}

      <section class="section">
        <div class="cards">
          ${teachers.length ? teachers.map((t) => {
            const cls = classes.filter((c) => c.teacher_id === t.id && c.active);
            const acc = t.user_id && profById[t.user_id];
            return `
            <button class="card card-btn ${t.active ? '' : 'is-off'}" data-edit="${t.id}">
              <div class="lesson-top">
                <div class="lesson-main">
                  <div class="lesson-name">${esc(t.full_name)}</div>
                  <div class="muted small">${acc ? '🔑 ' + esc(acc.email) : 'Нет аккаунта для входа'}</div>
                </div>
                ${t.active ? '' : '<span class="badge">Не работает</span>'}
              </div>
              ${cls.length ? `<ul class="mini-list">${cls.map((c) => `
                <li><b>${esc(c.name)}</b> <span class="muted">· ${esc(courseName[c.course_id] || '')} · ${schedText(c.schedule)} · ${money(c.teacher_rate)}/урок</span></li>`).join('')}</ul>`
                : '<div class="muted small">Нет занятий</div>'}
            </button>`;
          }).join('') : empty('Учителей пока нет')}
        </div>
      </section>

      <section class="section">
        <h2>Все аккаунты</h2>
        <p class="muted small">Учителя и администраторы сами регистрируются на странице входа («Создать аккаунт»), а вы подтверждаете их здесь.</p>
        <div class="list">${profiles.map((p) => `
          <div class="list-row">
            <div class="who"><b>${esc(p.full_name || '—')}</b><span class="muted small">${esc(p.email)}${teacherByUser[p.id] ? ' · учитель: ' + esc(teacherByUser[p.id].full_name) : ''}</span></div>
            <select class="input-sm" data-role="${p.id}" ${p.id === app.user.id ? 'disabled title="Свою роль менять нельзя"' : ''}>
              ${options(Object.entries(ROLE), p.role)}
            </select>
          </div>`).join('')}</div>
      </section>`;

    const reload = () => render(root, app);
    $('#add-t', root).onclick = () => editTeacher(null, profiles, teachers, reload);
    $$('[data-edit]', root).forEach((b) => b.onclick = () => editTeacher(teachers.find((t) => t.id === b.dataset.edit), profiles, teachers, reload));
    $$('[data-approve]', root).forEach((b) => b.onclick = () => approve(profById[b.dataset.approve], teachers, reload));
    $$('[data-make-admin]', root).forEach((b) => b.onclick = async () => {
      const p = profById[b.dataset.makeAdmin];
      if (!(await confirmBox(`Сделать ${p.email} администратором? Этот человек увидит все деньги и сможет всё менять.`))) return;
      await busy(b, async () => { await DB.update('profiles', p.id, { role: 'admin' }); toast('Готово'); reload(); });
    });
    $$('[data-role]', root).forEach((s) => s.onchange = async () => {
      try { await DB.update('profiles', s.dataset.role, { role: s.value }); toast('Роль изменена'); }
      catch (e) { toast(e.message, 'err'); }
      reload();
    });
  }

  // Подтвердить аккаунт учителя: привязать к существующему учителю или создать нового
  function approve(p, teachers, done) {
    const free = teachers.filter((t) => !t.user_id);
    const m = modal('Подтвердить учителя', `
      <form class="form">
        <p><b>${esc(p.full_name || '')}</b> · ${esc(p.email)}</p>
        <div class="field"><label>Какой это учитель?</label>
          <select name="teacher_id">${options(free.map((t) => [t.id, t.full_name]), '', { empty: '➕ Новый учитель' })}</select></div>
        <div class="field" data-new><label>Имя учителя</label><input name="full_name" value="${esc(p.full_name || '')}"></div>
        <div class="form-actions">
          <button type="button" class="btn" data-close>Отмена</button>
          <button type="submit" class="btn btn-primary">Подтвердить</button>
        </div>
      </form>`);
    const form = $('form', m.el);
    const sync = () => { $('[data-new]', form).hidden = !!form.teacher_id.value; };
    form.teacher_id.onchange = sync; sync();
    form.onsubmit = (ev) => {
      ev.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const f = formData(form);
        if (f.teacher_id) await DB.update('teachers', f.teacher_id, { user_id: p.id });
        else {
          if (!f.full_name) throw new Error('Напишите имя');
          await DB.insert('teachers', { full_name: f.full_name, user_id: p.id });
        }
        await DB.update('profiles', p.id, { role: 'teacher' });
        m.close(); toast('Учитель подтверждён'); done();
      });
    };
  }

  function editTeacher(t, profiles, teachers, done) {
    const used = new Set(teachers.filter((x) => x.user_id && x.id !== t?.id).map((x) => x.user_id));
    const accounts = profiles.filter((p) => !used.has(p.id) && p.role !== 'admin');
    const m = modal(t ? 'Учитель' : 'Новый учитель', `
      <form class="form">
        <div class="field"><label>Имя и фамилия</label><input name="full_name" required value="${esc(t?.full_name || '')}"></div>
        <div class="field"><label>Аккаунт для входа</label>
          <select name="user_id">${options(accounts.map((p) => [p.id, `${p.full_name || ''} ${p.email}`.trim()]), t?.user_id, { empty: 'Без аккаунта' })}</select>
          <span class="muted small">Учитель сам регистрируется на странице входа, потом выберите его аккаунт здесь.</span></div>
        ${t ? `<label class="check"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}> Работает</label>` : ''}
        <div class="form-actions">
          ${t ? `<button type="button" class="btn btn-danger" data-del>Удалить</button>` : ''}
          <button type="button" class="btn" data-close>Отмена</button>
          <button type="submit" class="btn btn-primary">Сохранить</button>
        </div>
      </form>`);
    const form = $('form', m.el);
    form.onsubmit = (ev) => {
      ev.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const f = formData(form);
        const row = { full_name: f.full_name, user_id: f.user_id || null };
        if (t) row.active = f.active;
        t ? await DB.update('teachers', t.id, row) : await DB.insert('teachers', row);
        if (row.user_id) {
          const p = profiles.find((x) => x.id === row.user_id);
          if (p && p.role === 'pending') await DB.update('profiles', p.id, { role: 'teacher' });
        }
        m.close(); toast('Сохранено'); done();
      });
    };
    const del = $('[data-del]', m.el);
    if (del) del.onclick = async () => {
      if (!(await confirmBox('Удалить учителя? Его занятия останутся без учителя. Обычно лучше снять галочку «Работает».'))) return;
      await busy(del, async () => { await DB.remove('teachers', t.id); m.close(); toast('Удалено'); done(); });
    };
  }

  window.TeachersPage = { render };
})();
