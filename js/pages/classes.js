// Группы, индивидуальные занятия и интенсивы: расписание, учитель, оплата учителю.
(function () {
  const { L, esc, $, $$, money, toast, modal, confirmBox, options, busy, schedText, empty } = UI;
  let tab = 'group';

  async function render(root) {
    root.innerHTML = `<div class="loading">Загрузка…</div>`;
    const [classes, courses, teachers, roster] = await Promise.all([DB.classes(), DB.courses(), DB.teachers(), DB.roster()]);
    const ctx = {
      classes, courses, teachers,
      courseName: Object.fromEntries(courses.map((c) => [c.id, c.name])),
      teacherName: Object.fromEntries(teachers.map((t) => [t.id, t.full_name])),
    };
    // индивидуальные занятия, где не осталось ни одного ученика
    const orphans = classes.filter((c) => c.kind === 'individual' && !roster.some((r) => r.class_id === c.id));
    const list = classes.filter((c) => c.kind === tab).sort((a, b) => tab === 'intensive'
      ? (b.start_date || '').localeCompare(a.start_date || '')
      : (b.active - a.active) || a.name.localeCompare(b.name));
    // продажи интенсивов (если база ещё не обновлена — покажем подсказку)
    let sales = [], salesErr = '';
    if (tab === 'intensive') { try { sales = await DB.sales(); } catch (e) { salesErr = e.message; } }

    root.innerHTML = `
      <div class="page-head">
        <h1>Группы и расписание</h1>
        <button class="btn btn-primary" id="add-cls">${tab === 'intensive' ? '+ Новый интенсив' : '+ Новая группа'}</button>
      </div>
      <div class="tabs">
        <button class="tab ${tab === 'group' ? 'active' : ''}" data-tab="group">Группы</button>
        <button class="tab ${tab === 'individual' ? 'active' : ''}" data-tab="individual">Индивидуальные</button>
        <button class="tab ${tab === 'intensive' ? 'active' : ''}" data-tab="intensive">Интенсивы</button>
      </div>
      ${tab === 'individual' ? `<p class="muted small">Индивидуальные занятия создаются в карточке ученика («Добавить курс»). Здесь можно поменять расписание, учителя и оплату учителю.</p>
        ${orphans.length ? `<div class="alert">Занятий без учеников: <b>${orphans.length}</b> (ученика или курс удалили). <button class="btn btn-sm btn-danger" id="del-orphans">Удалить их</button></div>` : ''}` : ''}
      ${tab === 'intensive' ? `<p class="muted small">Интенсив — занятие на свои даты. Имена учеников не нужны: только тарифы, сколько человек купили, расписание и оплата учителю за урок.</p>
        ${salesErr ? `<div class="alert alert-err">${esc(salesErr)}</div>` : ''}` : ''}
      <div class="cards">
        ${list.length ? list.map((c) => {
          if (c.kind === 'intensive') return intensiveCard(c, ctx, sales.filter((x) => x.class_id === c.id));
          const st = roster.filter((r) => r.class_id === c.id && r.active);
          return `
          <button class="card card-btn ${c.active ? '' : 'is-off'}" data-edit="${c.id}">
            <div class="lesson-top">
              <div class="lesson-main">
                <div class="lesson-name">${esc(c.name)}</div>
                <div class="muted small">${esc(ctx.courseName[c.course_id] || '')} · ${L.mode[c.mode]} · ${esc(ctx.teacherName[c.teacher_id] || 'без учителя')}</div>
              </div>
              ${c.active ? '' : '<span class="badge">Архив</span>'}
            </div>
            <div class="small">🗓 ${schedText(c.schedule)}</div>
            <div class="small muted">Учителю за урок: ${money(c.teacher_rate)}</div>
            <div class="students-line">${st.length ? st.map((r) => `<span class="st">${esc(r.student_name)}</span>`).join('') : '<span class="muted small">Нет учеников</span>'}</div>
          </button>`;
        }).join('') : empty({ group: 'Групп пока нет', individual: 'Индивидуальных занятий пока нет', intensive: 'Интенсивов пока нет' }[tab])}
      </div>`;

    $$('[data-tab]', root).forEach((b) => b.onclick = () => { tab = b.dataset.tab; render(root); });
    const delOrphans = $('#del-orphans', root);
    if (delOrphans) delOrphans.onclick = async () => {
      if (!(await confirmBox(`Удалить ${orphans.length} занятий без учеников вместе с их уроками?`))) return;
      await busy(delOrphans, async () => {
        DB.check(await DB.sb.from('classes').delete().in('id', orphans.map((c) => c.id)));
        toast('Удалено'); render(root);
      });
    };
    $('#add-cls', root).onclick = () => (tab === 'intensive' ? editIntensive(null, ctx, [], () => render(root)) : editClass(null, ctx, () => render(root)));
    // нажали на группу — сразу таблица посещаемости, внизу «Настройки» и «Календарь»
    $$('[data-edit]', root).forEach((b) => b.onclick = () => GroupsPage.openMatrix(b.dataset.edit, true, () => render(root)));
    $$('[data-intensive]', root).forEach((b) => b.onclick = () => {
      const c = classes.find((x) => x.id === b.dataset.intensive);
      editIntensive(c, ctx, sales.filter((x) => x.class_id === c.id), () => render(root));
    });
  }

  // Поля занятия (используются и в карточке ученика)
  function classFields(c, ctx, { individual = false, intensive = false } = {}) {
    const t = Logic.today();
    const cur = Logic.currentSchedule(c?.schedule, t);
    const sched = cur.length ? cur : [{ day: 1, time: '16:00' }];
    const past = (c?.schedule || []).filter((s) => s.to && s.to < t);
    return `
      <div class="field"><label>${individual ? 'Название <span class="muted small">(необязательно)</span>' : intensive ? 'Название интенсива' : 'Название группы'}</label>
        <input name="cls_name" autocomplete="off" value="${esc(c?.name || '')}" ${individual ? 'placeholder="Например: Ясина — математика"' : intensive ? 'placeholder="Например: SAT интенсив, ноябрь" required' : 'placeholder="Например: IELTS вечер" required'}></div>
      <div class="row2">
        <div class="field"><label>Курс</label>
          <select name="cls_course" required>${options(ctx.courses.map((x) => [x.id, x.name]), c?.course_id ?? (intensive ? ctx.courses.find((x) => x.name === 'Интенсив')?.id : ''), { empty: 'Выберите…' })}</select></div>
        <div class="field"><label>Учитель</label>
          <select name="cls_teacher">${options(ctx.teachers.filter((t) => t.active || t.id === c?.teacher_id).map((t) => [t.id, t.full_name]), c?.teacher_id, { empty: 'Не выбран' })}</select></div>
      </div>
      <div class="row2">
        <div class="field"><label>Формат</label>
          <div class="seg">
            <label><input type="radio" name="cls_mode" value="offline" ${c?.mode !== 'online' ? 'checked' : ''}><span>Офлайн</span></label>
            <label><input type="radio" name="cls_mode" value="online" ${c?.mode === 'online' ? 'checked' : ''}><span>Онлайн</span></label>
          </div></div>
        <div class="field"><label>Учителю за 1 урок, ₸</label>
          <input type="number" name="cls_rate" min="0" step="500" value="${c?.teacher_rate ?? ''}" placeholder="5000"></div>
      </div>
      <div class="field"><label>Длительность урока, мин</label>
        <input type="number" name="cls_duration" min="15" step="15" value="${c?.duration ?? 60}" list="durations" style="max-width:160px">
        <datalist id="durations"><option value="45"><option value="60"><option value="90"><option value="120"></datalist></div>
      ${c && (c.rate_history || []).length ? `<div class="muted small">История ставок: ${rateHistoryText(c.rate_history)}</div>` : ''}
      ${c && !intensive ? `
      <div class="field sched-from" data-rate-when hidden><label>Ставка изменилась — что случилось?</label>
        <div class="seg">
          <label><input type="radio" name="cls_rate_mode" value="change" checked><span>Повысили / понизили с даты</span></label>
          <label><input type="radio" name="cls_rate_mode" value="fix"><span>Исправляю ошибку</span></label>
        </div>
        <div data-rate-hint="change">
          <label class="small">С какой даты новая ставка?</label>
          <input type="date" name="cls_rate_from" value="${Logic.today()}">
          <span class="muted small">Уроки до этой даты — по старой ставке, с этой даты — по новой.</span>
        </div>
        <span class="muted small" data-rate-hint="fix" hidden>Новая ставка будет для <b>всех</b> уроков этого занятия, и прошлых тоже.</span>
      </div>` : ''}
      <div class="field"><label>Расписание</label>
        <div class="sched" data-sched>${sched.map(schedRow).join('')}</div>
        <button type="button" class="btn btn-sm btn-ghost" data-add-slot>+ Добавить день</button>
        ${past.length ? `<span class="muted small">Раньше: ${past.map((s) => `${L.days[s.day]} ${esc(s.time)}${s.from ? ' с ' + UI.fmtDate(s.from) : ''} до ${UI.fmtDate(s.to)}`).join('; ')}</span>` : ''}
      </div>
      ${c && !intensive ? `
      <div class="field sched-from"><label>Если меняете расписание — что случилось?</label>
        <div class="seg">
          <label><input type="radio" name="cls_sched_mode" value="fix" checked><span>Исправляю ошибку</span></label>
          <label><input type="radio" name="cls_sched_mode" value="change"><span>Расписание поменялось</span></label>
        </div>
        <span class="muted small" data-mode-hint="fix">Расписание будет считаться таким <b>с самого начала</b> (и для прошлых уроков).</span>
        <div data-mode-hint="change" hidden>
          <label class="small">С какой даты новое расписание?</label>
          <input type="date" name="cls_sched_from" value="${t}">
          <span class="muted small">До этой даты уроки считаются по старому расписанию, с этой — по новому.</span>
        </div></div>` : ''}`;
  }

  function rateHistoryText(h) {
    return [...h].sort((a, b) => a.from.localeCompare(b.from))
      .map((x) => `${money(x.rate)} ${x.from <= '2000-01-01' ? 'сначала' : 'с ' + UI.fmtDate(x.from)}`).join(' → ');
  }

  // Ставка на дату по истории
  function rateOn(h, d, fallback) {
    const hit = [...h].filter((x) => x.from <= d).sort((a, b) => b.from.localeCompare(a.from))[0];
    return hit ? hit.rate : fallback;
  }

  function schedRow(s) {
    return `
      <div class="sched-row">
        <select data-day>${options(L.daysFull.slice(1).map((d, i) => [i + 1, d]), s.day)}</select>
        <input type="time" data-time value="${esc(s.time)}">
        <button type="button" class="icon-btn" data-del-slot aria-label="Убрать">✕</button>
      </div>`;
  }

  function bindSchedule(form) {
    const box = $('[data-sched]', form);
    if (!box) return;
    $('[data-add-slot]', form).onclick = () => {
      const last = $$('.sched-row', box).pop();
      box.insertAdjacentHTML('beforeend', schedRow({ day: 3, time: last ? $('[data-time]', last).value : '16:00' }));
    };
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-del-slot]')) e.target.closest('.sched-row').remove();
    });
  }

  function readClass(form, { kind, defaultName = '' }) {
    const f = UI.formData(form);
    if (!f.cls_course) throw new Error('Выберите курс');
    const schedule = $$('.sched-row', form)
      .map((r) => ({ day: Number($('[data-day]', r).value), time: $('[data-time]', r).value }))
      .filter((s) => s.time);
    const courseName = form.querySelector('[name=cls_course] option:checked')?.textContent || '';
    return {
      name: f.cls_name || (defaultName ? `${defaultName} — ${courseName}` : courseName),
      course_id: Number(f.cls_course),
      teacher_id: f.cls_teacher || null,
      mode: f.cls_mode || 'offline',
      teacher_rate: f.cls_rate || 0,
      ...(DB.features.duration ? { duration: f.cls_duration || 60 } : {}),
      schedule,
      kind,
    };
  }

  function editClass(c, ctx, done) {
    const m = modal(c ? `Настройки · ${c.name}` : 'Новая группа', `
      <form class="form">
        ${classFields(c, ctx, { individual: c?.kind === 'individual' })}
        ${c ? `<label class="check"><input type="checkbox" name="cls_active" ${c.active ? 'checked' : ''}> Занятие идёт (снимите, чтобы убрать в архив)</label>` : ''}
        ${c ? `<p class="muted small">Новая ставка учителю действует для новых отметок. Старые уроки можно поправить в «Журнале».</p>` : ''}
        <div class="form-actions">
          ${c ? `<button type="button" class="btn btn-danger" data-del>Удалить</button>` : ''}
          <button type="button" class="btn" data-close>Отмена</button>
          <button type="submit" class="btn btn-primary">Сохранить</button>
        </div>
      </form>`, { wide: true });
    const form = $('form', m.el);
    bindSchedule(form);
    $$('[name=cls_sched_mode]', form).forEach((r) => r.onchange = () =>
      $$('[data-mode-hint]', form).forEach((h) => h.hidden = h.dataset.modeHint !== r.value));
    const rateInput = form.querySelector('[name=cls_rate]');
    const rateWhen = $('[data-rate-when]', form);
    if (c && rateWhen) {
      rateInput.oninput = () => { rateWhen.hidden = Number(rateInput.value || 0) === c.teacher_rate; };
      $$('[name=cls_rate_mode]', form).forEach((r) => r.onchange = () =>
        $$('[data-rate-hint]', form).forEach((h) => h.hidden = h.dataset.rateHint !== r.value));
    }
    form.onsubmit = (ev) => {
      ev.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const row = readClass(form, { kind: c ? c.kind : 'group' });
        if (c) {
          row.active = form.cls_active.checked;
          // «исправляю ошибку» — новое расписание действует всегда; «поменялось» — с выбранной даты
          if (form.querySelector('[name=cls_sched_mode]:checked').value === 'change') {
            row.schedule = Logic.mergeSchedule(c.schedule, row.schedule, form.cls_sched_from.value || Logic.today());
          }
        }
        let rateFrom = null; // с какой даты пересчитать ставку у уже отмеченных уроков
        if (c && row.teacher_rate !== c.teacher_rate) {
          if (form.querySelector('[name=cls_rate_mode]:checked').value === 'fix') {
            if ((c.rate_history || []).length) row.rate_history = [];
            rateFrom = '2000-01-01';
          } else {
            rateFrom = form.cls_rate_from.value || Logic.today();
            const base = (c.rate_history || []).length ? c.rate_history : [{ from: '2000-01-01', rate: c.teacher_rate }];
            row.rate_history = [...base.filter((x) => x.from < rateFrom), { from: rateFrom, rate: row.teacher_rate }];
            row.teacher_rate = rateOn(row.rate_history, Logic.today(), row.teacher_rate);
          }
        }
        c ? await DB.update('classes', c.id, row) : await DB.insert('classes', row);
        if (rateFrom) {
          const newRate = row.rate_history ? rateOn(row.rate_history, rateFrom, row.teacher_rate) : row.teacher_rate;
          DB.check(await DB.sb.from('lessons').update({ rate: newRate }).eq('class_id', c.id).gte('date', rateFrom));
        }
        m.close(); toast('Сохранено'); done();
      });
    };
    const del = $('[data-del]', m.el);
    if (del) del.onclick = async () => {
      if (!(await confirmBox('Удалить занятие вместе со всеми уроками, учениками в нём и их оплатами? Обычно лучше убрать в архив.'))) return;
      await busy(del, async () => { await DB.remove('classes', c.id); m.close(); toast('Удалено'); done(); });
    };
  }

  // ---------- Интенсивы ----------
  // Сколько уроков по расписанию в даты интенсива
  function intensiveLessonCount(c) {
    if (!c.start_date || !c.end_date) return 0;
    let n = 0;
    for (let d = c.start_date; d <= c.end_date; d = Logic.addDays(d, 1)) n += Logic.lessonsForDate(d, [{ ...c, active: true }], []).length;
    return n;
  }
  const salesTotal = (sales) => sales.reduce((s, x) => s + (x.price || 0) * (x.count || 0), 0);
  const peopleTotal = (sales) => sales.reduce((s, x) => s + (x.count || 0), 0);
  const period = (c) => (c.start_date ? `${UI.fmtDate(c.start_date)} — ${c.end_date ? UI.fmtDate(c.end_date) : '…'}` : 'даты не указаны');

  function intensiveCard(c, ctx, sales) {
    const t = Logic.today();
    const state = !c.start_date ? '' : t < c.start_date ? '<span class="badge">Скоро</span>'
      : c.end_date && t > c.end_date ? '<span class="badge">Завершён</span>' : '<span class="badge badge-ok">Идёт</span>';
    const n = intensiveLessonCount(c);
    const income = salesTotal(sales);
    const pay = n * (c.teacher_rate || 0);
    return `
      <button class="card card-btn" data-intensive="${c.id}">
        <div class="lesson-top">
          <div class="lesson-main">
            <div class="lesson-name">⚡ ${esc(c.name)}</div>
            <div class="muted small">${esc(ctx.courseName[c.course_id] || '')} · ${L.mode[c.mode]} · ${esc(ctx.teacherName[c.teacher_id] || 'без учителя')}</div>
          </div>
          ${state}
        </div>
        <div class="small">📅 ${period(c)}</div>
        <div class="small">🗓 ${schedText(c.schedule)}</div>
        <div class="small">${sales.length ? sales.map((x) => `${esc(x.name)}: ${x.count} × ${money(x.price)}`).join(' · ') : '<span class="muted">Продаж пока нет</span>'}</div>
        <div class="int-sum">
          <div><span>Выручка</span><b>${money(income)}</b><span class="muted small">${peopleTotal(sales)} чел.</span></div>
          <div><span>Учителю</span><b>${money(pay)}</b><span class="muted small">${n} ур. × ${money(c.teacher_rate)}</span></div>
          <div><span>Прибыль</span><b class="${income - pay < 0 ? 'bad-text' : 'ok-text'}">${money(income - pay)}</b></div>
        </div>
      </button>`;
  }

  function saleRow(x = {}) {
    return `
      <div class="sale-row">
        <input data-s="name" placeholder="Тариф, например: Про" value="${esc(x.name || '')}">
        <input data-s="price" type="number" min="0" step="1000" placeholder="Цена, ₸" value="${x.price ?? ''}">
        <input data-s="count" type="number" min="0" placeholder="Сколько купили" value="${x.count ?? ''}">
        <button type="button" class="icon-btn" data-del-sale title="Убрать тариф">✕</button>
      </div>`;
  }

  function editIntensive(c, ctx, sales, done) {
    const t = Logic.today();
    const base = c || { kind: 'intensive', mode: 'offline', teacher_rate: 8000, duration: 120,
      schedule: [1, 2, 3, 4, 5].map((day) => ({ day, time: '10:00' })) };
    const m = modal(c ? `Интенсив · ${c.name}` : 'Новый интенсив', `
      <form class="form">
        ${classFields(base, ctx, { intensive: true })}
        <div class="row2">
          <div class="field"><label>Первый день</label><input type="date" name="int_from" value="${c?.start_date || t}" required></div>
          <div class="field"><label>Последний день</label><input type="date" name="int_to" value="${c?.end_date || Logic.addDays(t, 13)}" required></div>
        </div>
        <div class="field"><label>Тарифы и продажи <span class="muted small">(имена учеников не нужны)</span></label>
          <div class="sale-row sale-head muted small"><span>Тариф</span><span>Цена за место, ₸</span><span>Сколько человек купили</span><span></span></div>
          <div data-sales>${(sales.length ? sales : [{ name: 'Про', price: 75000 }, { name: 'Стандарт', price: 50000 }]).map(saleRow).join('')}</div>
          <button type="button" class="btn btn-sm btn-ghost" data-add-sale>+ Тариф</button>
        </div>
        <div class="int-sum" data-total></div>
        <div class="form-actions">
          ${c ? '<button type="button" class="btn btn-danger" data-del>Удалить</button>' : ''}
          ${c ? '<button type="button" class="btn" data-cal>📅 Календарь</button>' : ''}
          <button type="button" class="btn" data-close>Отмена</button>
          <button type="submit" class="btn btn-primary">Сохранить</button>
        </div>
      </form>`, { wide: true });
    const form = $('form', m.el);
    bindSchedule(form);
    const box = $('[data-sales]', form);
    const readSales = () => $$('.sale-row', box).map((r) => ({
      name: $('[data-s=name]', r).value.trim(),
      price: Number($('[data-s=price]', r).value) || 0,
      count: Number($('[data-s=count]', r).value) || 0,
    })).filter((x) => x.name || x.count);
    // итог считаем сразу, пока вводят цифры
    const total = () => {
      const s = readSales();
      const draft = { ...base, ...readClass(form, { kind: 'intensive' }), start_date: form.int_from.value, end_date: form.int_to.value };
      const n = intensiveLessonCount(draft);
      const income = salesTotal(s), pay = n * (draft.teacher_rate || 0);
      $('[data-total]', form).innerHTML = `
        <div><span>Выручка</span><b>${money(income)}</b><span class="muted small">${peopleTotal(s)} чел.</span></div>
        <div><span>Учителю</span><b>${money(pay)}</b><span class="muted small">${n} ур. × ${money(draft.teacher_rate)}</span></div>
        <div><span>Прибыль</span><b class="${income - pay < 0 ? 'bad-text' : 'ok-text'}">${money(income - pay)}</b></div>`;
    };
    const bindRows = () => $$('[data-del-sale]', box).forEach((b) => b.onclick = () => { b.closest('.sale-row').remove(); total(); });
    $('[data-add-sale]', form).onclick = () => { box.insertAdjacentHTML('beforeend', saleRow()); bindRows(); };
    bindRows();
    form.addEventListener('input', () => { try { total(); } catch { /* курс ещё не выбран */ } });
    form.addEventListener('click', () => setTimeout(() => { try { total(); } catch { /* */ } }));
    try { total(); } catch { /* */ }

    const cal = $('[data-cal]', m.el);
    if (cal) cal.onclick = () => { m.close(); CalendarPage.open(c.id, done); };
    form.onsubmit = (ev) => {
      ev.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const row = { ...readClass(form, { kind: 'intensive' }), start_date: form.int_from.value, end_date: form.int_to.value };
        if (!row.start_date || !row.end_date || row.end_date < row.start_date) throw new Error('Проверьте даты: последний день раньше первого');
        if (c && (c.rate_history || []).length) row.rate_history = [];
        const saved = c ? await DB.update('classes', c.id, row) : await DB.insert('classes', row);
        // ставка у интенсива одна на все уроки
        if (c && row.teacher_rate !== c.teacher_rate) DB.check(await DB.sb.from('lessons').update({ rate: row.teacher_rate }).eq('class_id', c.id));
        DB.check(await DB.sb.from('intensive_sales').delete().eq('class_id', saved.id));
        const s = readSales();
        if (s.length) DB.check(await DB.sb.from('intensive_sales').insert(s.map((x) => ({ ...x, name: x.name || 'Тариф', class_id: saved.id }))));
        m.close(); toast('Сохранено'); done();
      });
    };
    const del = $('[data-del]', m.el);
    if (del) del.onclick = async () => {
      if (!(await confirmBox('Удалить интенсив вместе с уроками и продажами?'))) return;
      await busy(del, async () => { await DB.remove('classes', c.id); m.close(); toast('Удалено'); done(); });
    };
  }

  window.ClassesPage = { render, classFields, bindSchedule, readClass, editClass, intensiveLessonCount, salesTotal };
})();
