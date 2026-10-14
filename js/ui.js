// Общие помощники интерфейса: экранирование, форматирование, окна, уведомления.
(function () {
  const L = {
    kind: { individual: 'Индивидуально', group: 'Группа' },
    mode: { online: 'Онлайн', offline: 'Офлайн' },
    reason: { sick: 'Заболел(а)', overslept: 'Проспал(а)', other: 'Другое' },
    caused: { student: 'Ученик', teacher: 'Учитель' },
    status: { done: 'Прошёл', rescheduled: 'Перенесён', cancelled: 'Отменён', planned: 'Перенос сюда' },
    plan: { package: 'Пакет', support: 'Сопровождение' },
    decision: { burned: 'Сгорел', moved: 'Не сгорает' },
    days: ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
    daysFull: ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'],
    months: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
  };

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function money(n) {
    return `${Math.round(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ')} ₸`;
  }
  function fmtDate(s, withDay = false) {
    if (!s) return '';
    const [y, m, d] = s.split('-');
    const base = `${d}.${m}.${y}`;
    return withDay ? `${L.days[Logic.weekday(s)]}, ${base}` : base;
  }
  function fmtShort(s) {
    if (!s) return '';
    const [, m, d] = s.split('-');
    return `${L.days[Logic.weekday(s)]} ${d}.${m}`;
  }
  function schedText(schedule) {
    if (!schedule || !schedule.length) return 'нет расписания';
    return [...schedule]
      .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time))
      .map((s) => `${L.days[s.day]} ${s.time}`)
      .join(', ');
  }
  function lessonsWord(n) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return 'уроков';
    if (b === 1) return 'урок';
    if (b >= 2 && b <= 4) return 'урока';
    return 'уроков';
  }

  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('hide'), 2600);
    setTimeout(() => el.remove(), 3000);
  }

  // Модальное окно. body — HTML. Возвращает {el, close}.
  function modal(title, body, { wide = false } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
      <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>${esc(title)}</h3>
          <button class="icon-btn" data-close aria-label="Закрыть">✕</button>
        </div>
        <div class="modal-body">${body}</div>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-close]')) close();
    });
    const first = wrap.querySelector('input:not([type=hidden]), select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return { el: wrap, close };
  }

  function confirmBox(text) {
    return new Promise((resolve) => {
      const m = modal('Подтвердите', `
        <p>${esc(text)}</p>
        <div class="form-actions">
          <button class="btn" data-close>Нет</button>
          <button class="btn btn-primary" data-yes>Да</button>
        </div>`);
      m.el.querySelector('[data-yes]').onclick = () => { m.close(); resolve(true); };
      m.el.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === m.el) resolve(false); });
    });
  }

  // Данные формы → объект
  function formData(form) {
    const out = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
      else out[el.name] = el.value.trim();
    }
    return out;
  }

  function options(list, selected, { empty } = {}) {
    let html = empty !== undefined ? `<option value="">${esc(empty)}</option>` : '';
    for (const [value, label] of list) {
      html += `<option value="${esc(value)}" ${String(value) === String(selected ?? '') ? 'selected' : ''}>${esc(label)}</option>`;
    }
    return html;
  }

  // Кнопка «занята» на время запроса
  async function busy(btn, fn) {
    if (btn.disabled) return;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '…';
    try { return await fn(); }
    catch (e) { console.error(e); toast(e.message || 'Ошибка', 'err'); }
    finally { btn.disabled = false; btn.textContent = old; }
  }

  function empty(text) { return `<div class="empty">${esc(text)}</div>`; }

  window.UI = { L, esc, $, $$, money, fmtDate, fmtShort, schedText, lessonsWord, toast, modal, confirmBox, formData, options, busy, empty };
})();
