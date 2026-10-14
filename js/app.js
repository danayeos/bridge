// Вход, меню и переключение страниц.
(function () {
  const { esc, $, $$, toast, busy, formData } = UI;

  const ADMIN_NAV = [
    ['dashboard', 'Главная', '🏠', (r) => DashboardPage.render(r)],
    ['today', 'Расписание', '🗓', (r, a) => TodayPage.render(r, a)],
    ['students', 'Ученики', '🎓', (r) => StudentsPage.render(r)],
    ['classes', 'Группы', '👥', (r) => ClassesPage.render(r)],
    ['teachers', 'Учителя', '🧑‍🏫', (r, a) => TeachersPage.render(r, a)],
    ['journal', 'Журнал', '📒', (r) => JournalPage.render(r)],
    ['reports', 'Деньги', '💰', (r) => ReportsPage.render(r)],
  ];
  const TEACHER_NAV = [
    ['today', 'Мои уроки', '🗓', (r, a) => TodayPage.render(r, a)],
  ];

  let app = null; // { user, profile, teacher, role }

  async function start() {
    if (!DB.configured) return renderSetup();
    window.addEventListener('hashchange', route);
    // пришли по ссылке «сбросить пароль» из письма
    let recovery = /type=recovery/.test(location.hash);
    DB.sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { app = null; renderLogin(); }
      if (event === 'PASSWORD_RECOVERY' && !recovery) { recovery = true; setTimeout(renderNewPassword); }
    });
    if (recovery) {
      await DB.session(); // дождаться, пока Supabase прочитает ссылку
      history.replaceState(null, '', location.pathname);
      return renderNewPassword();
    }
    await boot();
  }

  async function boot() {
    try {
      const me = await DB.me();
      if (!me) return renderLogin();
      if (!me.profile) return renderLogin('Профиль не найден. Проверьте, что schema.sql запущен в Supabase.');
      app = { ...me, role: me.profile.role };
      if (app.role === 'pending' || (app.role === 'teacher' && !app.teacher)) return renderPending();
      renderShell();
      route();
    } catch (e) {
      console.error(e);
      renderLogin(e.message);
    }
  }

  function nav() { return app.role === 'admin' ? ADMIN_NAV : TEACHER_NAV; }

  function renderShell() {
    const name = app.teacher?.full_name || app.profile.full_name || app.user.email;
    document.body.innerHTML = `
      <div class="shell">
        <aside class="sidebar">
          <div class="brand"><span class="logo">B</span><span>Bridge</span></div>
          <nav>${nav().map(([id, label, icon]) => `<a href="#/${id}" data-nav="${id}"><span class="nav-ico">${icon}</span><span>${label}</span></a>`).join('')}</nav>
          <div class="me">
            <div class="me-name">${esc(name)}</div>
            <div class="muted small">${app.role === 'admin' ? 'Администратор' : 'Учитель'}</div>
            <button class="btn btn-ghost btn-sm" id="logout">Выйти</button>
          </div>
        </aside>
        <header class="topbar">
          <div class="brand"><span class="logo">B</span><span>Bridge</span></div>
          <button class="btn btn-ghost btn-sm" id="logout2">Выйти</button>
        </header>
        ${window.BRIDGE_DEMO ? `<div class="demo-bar">Демо-режим: данные выдуманные и пропадут после обновления страницы. Смотреть как:
          <a href="?demo&as=admin">Администратор</a> · <a href="?demo&as=teacher">Учитель</a></div>` : ''}
        <main id="page"></main>
        ${nav().length > 1 ? `<nav class="bottom-nav">${nav().map(([id, label, icon]) => `<a href="#/${id}" data-nav="${id}"><span class="nav-ico">${icon}</span><span>${label}</span></a>`).join('')}</nav>` : ''}
      </div>
      <div id="toasts"></div>`;
    $('#logout').onclick = $('#logout2').onclick = () => DB.signOut();
  }

  async function route() {
    if (!app || !$('#page')) return;
    const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
    const item = nav().find((n) => n[0] === id) || nav()[0];
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === item[0]));
    $$('.modal-wrap').forEach((w) => w.remove()); // при переходе закрываем открытые окна
    const page = $('#page');
    try {
      await item[3](page, app);
    } catch (e) {
      console.error(e);
      page.innerHTML = `<div class="alert alert-err"><b>Ошибка:</b> ${esc(e.message)}</div>`;
    }
    window.scrollTo(0, 0);
  }

  function authLayout(inner) {
    document.body.innerHTML = `
      <div class="auth">
        <div class="auth-card">
          <div class="brand brand-big"><span class="logo">B</span><span>Bridge</span></div>
          ${inner}
        </div>
      </div>
      <div id="toasts"></div>`;
  }

  function renderLogin(error, mode = 'in') {
    authLayout(`
      <p class="muted center">${mode === 'in' ? 'Вход для учителей и администраторов' : 'Новый аккаунт'}</p>
      ${error ? `<div class="alert alert-err">${esc(error)}</div>` : ''}
      <form class="form" id="auth-form">
        ${mode === 'up' ? `<div class="field"><label>Имя и фамилия</label><input name="full_name" required autocomplete="name"></div>` : ''}
        <div class="field"><label>Email</label><input type="email" name="email" required autocomplete="email"></div>
        <div class="field"><label>Пароль</label><input type="password" name="password" required minlength="6" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}"></div>
        <button class="btn btn-primary btn-block" type="submit">${mode === 'in' ? 'Войти' : 'Создать аккаунт'}</button>
      </form>
      <button class="btn btn-ghost btn-block" id="switch">${mode === 'in' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти'}</button>`);
    $('#switch').onclick = () => renderLogin(null, mode === 'in' ? 'up' : 'in');
    if (mode === 'in') {
      $('#auth-form').insertAdjacentHTML('afterend', `<button class="btn btn-ghost btn-block" id="forgot">Забыли пароль?</button>`);
      $('#forgot').onclick = renderForgot;
    }
    const form = $('#auth-form');
    form.onsubmit = (e) => {
      e.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const f = formData(form);
        if (mode === 'in') {
          await DB.signIn(f.email, f.password);
        } else {
          const res = await DB.signUp(f.email, f.password, f.full_name);
          if (!res.session) {
            authLayout(`<div class="alert">Аккаунт создан. Мы отправили письмо на <b>${esc(f.email)}</b> — подтвердите email и затем войдите.</div>
              <button class="btn btn-primary btn-block" onclick="location.reload()">Ко входу</button>`);
            return;
          }
        }
        await boot();
      });
    };
  }

  function renderForgot() {
    authLayout(`
      <p class="muted center">Восстановление пароля</p>
      <form class="form" id="f-form">
        <div class="field"><label>Email, с которым вы регистрировались</label><input type="email" name="email" required autocomplete="email"></div>
        <button class="btn btn-primary btn-block" type="submit">Прислать ссылку</button>
      </form>
      <button class="btn btn-ghost btn-block" id="back">Назад ко входу</button>`);
    $('#back').onclick = () => renderLogin();
    const form = $('#f-form');
    form.onsubmit = (e) => {
      e.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const { email } = formData(form);
        DB.check(await DB.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
        authLayout(`<div class="alert">Мы отправили письмо на <b>${esc(email)}</b>. Откройте ссылку из письма — там можно задать новый пароль.
          Если письма нет, проверьте папку «Спам».</div>
          <button class="btn btn-ghost btn-block" id="back">Назад ко входу</button>`);
        $('#back').onclick = () => renderLogin();
      });
    };
  }

  function renderNewPassword() {
    authLayout(`
      <p class="muted center">Придумайте новый пароль</p>
      <form class="form" id="np-form">
        <div class="field"><label>Новый пароль</label><input type="password" name="password" required minlength="6" autocomplete="new-password"></div>
        <button class="btn btn-primary btn-block" type="submit">Сохранить и войти</button>
      </form>`);
    const form = $('#np-form');
    form.onsubmit = (e) => {
      e.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const { password } = formData(form);
        DB.check(await DB.sb.auth.updateUser({ password }));
        toast('Пароль изменён');
        await boot();
      });
    };
  }

  function renderPending() {
    authLayout(`
      <div class="alert">
        <b>Аккаунт ждёт подтверждения.</b><br>
        Попросите администратора открыть «Учителя» и подтвердить ваш аккаунт (${esc(app.user.email)}).
      </div>
      <button class="btn btn-primary btn-block" id="re">Проверить ещё раз</button>
      <button class="btn btn-ghost btn-block" id="out">Выйти</button>`);
    $('#re').onclick = () => boot();
    $('#out').onclick = () => DB.signOut();
  }

  function renderSetup() {
    authLayout(`
      <div class="alert">
        <b>Сайт ещё не подключён к базе данных.</b><br>
        Откройте файл <code>js/config.js</code> и вставьте туда адрес и ключ Supabase. Подробно — в файле <code>README.md</code>.
      </div>
      <a class="btn btn-primary btn-block" href="?demo">Посмотреть демо</a>`);
  }

  window.addEventListener('DOMContentLoaded', start);
})();
