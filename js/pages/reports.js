// Деньги за месяц: фактический и заработанный доход, способы оплаты, интенсивы, зарплаты учителей.
(function () {
  const { L, esc, $, $$, money, toast, modal, busy, fmtDate, fmtShort, empty } = UI;
  let month = null;
  const monthName = (ym) => `${L.months[Number(ym.slice(5)) - 1].toLowerCase()} ${ym.slice(0, 4)}`;
  const pct = (v) => (v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','));

  async function render(root) {
    if (!month) month = Logic.today().slice(0, 7);
    root.innerHTML = `<div class="loading">Загрузка…</div>`;
    const [from, to] = Logic.monthRange(month);
    const [pays, lessons, enrollments, students, classes, teachers, courses, sps, methods] = await Promise.all([
      DB.payments(from, to), DB.lessons(from, to), DB.enrollments(), DB.students(), DB.classes(), DB.teachers(), DB.courses(),
      DB.supportPayments(), DB.payMethods(),
    ]);
    const enrById = Object.fromEntries(enrollments.map((e) => [e.id, e]));
    const studentById = Object.fromEntries(students.map((s) => [s.id, s]));
    const studentName = Object.fromEntries(students.map((s) => [s.id, s.full_name]));
    const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
    const courseName = Object.fromEntries(courses.map((c) => [c.id, c.name]));
    const teacherName = Object.fromEntries(teachers.map((t) => [t.id, t.full_name]));
    const methodName = (id) => (methods.find((m) => m.id === id) || {}).name || 'Не указан';

    // старое сопровождение у курса (ещё не перенесено в ученика)
    const legacy = new Set(enrollments.filter((e) => e.plan === 'support').map((e) => e.id));
    const untilOf = (sp) => studentById[sp.student_id]?.support_until || null;
    const actual = Logic.actualIncome(pays, sps, legacy)[month] || { count: 0, gross: 0, fee: 0, tax: 0, net: 0, packages: { gross: 0, net: 0 }, support: { gross: 0, net: 0 }, byMethod: {} };
    const earnedAll = Logic.earnedIncome(pays, sps, untilOf, legacy);
    const earned = earnedAll.months[month] || { gross: 0, net: 0, packages: { gross: 0, net: 0 }, support: { gross: 0, net: 0, items: [] } };
    const monthSps = sps.filter((p) => p.paid_at >= from && p.paid_at <= to && p.paid_at >= Logic.SUPPORT_CUTOFF);

    // интенсивы считаем в месяце, когда они начались
    let sales = [];
    try { sales = await DB.sales(); } catch { /* база ещё без интенсивов */ }
    const intensives = classes.filter((c) => c.kind === 'intensive' && c.start_date >= from && c.start_date <= to);
    const intLessons = intensives.length
      ? (await DB.lessons(intensives.map((c) => c.start_date).sort()[0], intensives.map((c) => c.end_date || c.start_date).sort().pop()))
        .filter((l) => l.status === 'done' && intensives.some((c) => c.id === l.class_id))
      : [];
    const intRows = intensives.map((c) => {
      const s = sales.filter((x) => x.class_id === c.id);
      const done = intLessons.filter((l) => l.class_id === c.id);
      const planned = ClassesPage.intensiveLessonCount(c);
      return { c, s, income: ClassesPage.salesTotal(s), people: s.reduce((n, x) => n + x.count, 0),
        done: done.length, paid: done.reduce((n, l) => n + (l.rate || 0), 0), planned, plannedPay: planned * (c.teacher_rate || 0) };
    });
    const intIncome = intRows.reduce((n, r) => n + r.income, 0);
    const sal = Logic.salaries(lessons).sort((a, b) => b.total - a.total);
    const salTotal = sal.reduce((s, x) => s + x.total, 0);

    // за какие курсы оплата: сопровождение одной оплатой покрывает все связанные курсы («IELTS + SAT»)
    const payRoot = (e) => (e.pay_with && enrById[e.pay_with] ? e.pay_with : e.id);
    const coursesOf = (p) => {
      const e = enrById[p.enrollment_id];
      if (!e) return ['Другое'];
      const list = e.plan === 'support' ? enrollments.filter((x) => x.plan === 'support' && payRoot(x) === payRoot(e)) : [e];
      return [...new Set(list.map((x) => courseName[classById[x.class_id]?.course_id] || 'Другое'))];
    };
    const payLabel = (p) => {
      const e = enrById[p.enrollment_id] || {};
      const names = coursesOf(p);
      if (e.plan === 'support') return `Сопровождение: ${names.join(' + ')}`;
      const c = classById[e.class_id];
      return c?.kind === 'group' ? `${names[0]} — ${c.name}` : `${names[0]} (индив.)`;
    };
    const counts = (p) => !p.migrated && !(legacy.has(p.enrollment_id) && p.paid_at < Logic.SUPPORT_CUTOFF);

    // доход по курсам (фактический, брутто)
    const byCourse = {};
    for (const p of pays.filter(counts)) {
      const k = coursesOf(p).join(' + ');
      byCourse[k] = (byCourse[k] || 0) + p.amount;
    }
    if (monthSps.length) byCourse['Сопровождение'] = (byCourse['Сопровождение'] || 0) + monthSps.reduce((n, p) => n + p.amount, 0);
    for (const r of intRows) if (r.income) byCourse[`⚡ ${r.c.name}`] = r.income;
    const courseTotal = Object.values(byCourse).reduce((a, b) => a + b, 0);

    // справочно: сопровождение, оплаченное до даты отсечки — ни в какие итоги не входит
    const oldSup = students.filter((s) => sps.some((p) => p.student_id === s.id && p.paid_at < Logic.SUPPORT_CUTOFF)).map((s) => {
      const list = sps.filter((p) => p.student_id === s.id && p.paid_at < Logic.SUPPORT_CUTOFF);
      return { s, sum: list.reduce((n, p) => n + p.amount, 0), first: list.map((p) => p.paid_at).sort()[0], until: s.support_until,
        per: Logic.supportPerMonth(list, s.support_until), ended: !!s.support_until && s.support_until < from };
    }).sort((a, b) => a.s.full_name.localeCompare(b.s.full_name));
    const oldPerTotal = oldSup.filter((x) => !x.ended && x.per !== null).reduce((n, x) => n + x.per, 0);

    const methodRows = Object.entries(actual.byMethod).sort((a, b) => b[1].gross - a[1].gross);
    const noUntil = earnedAll.noUntil.filter((p) => p.paid_at.slice(0, 7) <= month);

    root.innerHTML = `
      <div class="page-head">
        <h1>Деньги</h1>
        <div class="btn-group">
          <button class="btn btn-sm" id="r-methods">⚙ Способы оплаты</button>
          <input type="month" id="r-month" value="${month}">
        </div>
      </div>

      <div class="tiles">
        <div class="tile"><div class="tile-label">Фактический доход</div><div class="tile-value">${money(actual.gross)}</div><div class="muted small">пришло денег · на руки ${money(actual.net)}</div></div>
        <div class="tile"><div class="tile-label">Заработанный доход</div><div class="tile-value">${money(earned.net)}</div><div class="muted small">на руки · брутто ${money(earned.gross)}</div></div>
        <div class="tile"><div class="tile-label">Налог к уплате</div><div class="tile-value">${money(actual.tax)}</div></div>
        ${intRows.length ? `<div class="tile"><div class="tile-label">Интенсивы</div><div class="tile-value">${money(intIncome)}</div><div class="muted small">${intRows.reduce((n, r) => n + r.people, 0)} чел.</div></div>` : ''}
        <div class="tile"><div class="tile-label">Зарплаты учителей</div><div class="tile-value">${money(salTotal)}</div></div>
        <div class="tile"><div class="tile-label">Разница</div><div class="tile-value accent">${money(actual.net + intIncome - salTotal)}</div><div class="muted small">на руки + интенсивы − зарплаты</div></div>
      </div>

      <section class="section">
        <h2>Фактический доход · ${monthName(month)}</h2>
        <p class="muted small">Сколько денег реально пришло в этом месяце: пакеты и сопровождения, оплаченные в этом месяце (сопровождения — только с ${fmtDate(Logic.SUPPORT_CUTOFF)}).
          Налог — от полной суммы клиента, комиссия банка — отдельно.</p>
        ${methodRows.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Способ оплаты</th><th class="num">Оплат</th><th class="num">Сумма</th><th class="num">Комиссия</th><th class="num">Налог</th><th class="num">На руки</th></tr></thead>
          <tbody>${methodRows.map(([id, r]) => `
            <tr><td>${esc(methodName(id))}</td><td class="num">${r.count}</td><td class="num">${money(r.gross)}</td>
            <td class="num ${r.fee ? '' : 'muted'}">${r.fee ? '−' + money(r.fee) : '—'}</td><td class="num ${r.tax ? '' : 'muted'}">${r.tax ? '−' + money(r.tax) : '—'}</td>
            <td class="num"><b>${money(r.net)}</b></td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Итого</td><td class="num">${actual.count}</td><td class="num">${money(actual.gross)}</td><td class="num">−${money(actual.fee)}</td>
            <td class="num">−${money(actual.tax)}</td><td class="num"><b>${money(actual.net)}</b></td></tr></tfoot>
        </table></div>
        <p class="small">Пакеты: <b>${money(actual.packages.gross)}</b> · Сопровождение: <b>${money(actual.support.gross)}</b> ·
          Налог к уплате за месяц (Kaspi Pay и рассрочка): <b>${money(actual.tax)}</b></p>` : empty('В этом месяце оплат не было')}
      </section>

      <section class="section">
        <h2>Заработанный доход · ${monthName(month)}</h2>
        <p class="muted small">Пакеты — в месяце оплаты. Сопровождение (с ${fmtDate(Logic.SUPPORT_CUTOFF)}) — сумма «на руки» делится поровну
          на месяцы от оплаты до окончания, сюда попадает доля этого месяца. Брутто — справочно.</p>
        <div class="enr-nums">
          <div><span>Пакеты, на руки</span><b>${money(earned.packages.net)}</b></div>
          <div><span>Сопровождение, доля месяца</span><b>${money(earned.support.net)}</b></div>
          <div><span>Итого на руки</span><b>${money(earned.net)}</b></div>
        </div>
        ${earned.support.items.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Ученик на сопровождении</th><th>Оплата</th><th>Период</th><th class="num">Доля за месяц</th><th class="num">Брутто (справочно)</th></tr></thead>
          <tbody>${earned.support.items.map((x) => {
            const p = x.payment;
            const sid = p.student_id || enrById[p.enrollment_id]?.student_id;
            const end = p.student_id ? untilOf(p) : null;
            return `<tr><td>${esc(studentName[sid] || '')}</td>
              <td class="small">${fmtDate(p.paid_at)} · ${money(p.amount)} · на руки ${money(Logic.payNet(p))}</td>
              <td class="small">${end ? `${monthName(p.paid_at.slice(0, 7))} — ${monthName(end.slice(0, 7))} (${x.of} мес.)` : 'старая запись курса — целиком в месяц оплаты'}</td>
              <td class="num"><b>${money(x.net)}</b></td><td class="num muted">${money(x.gross)}</td></tr>`;
          }).join('')}</tbody></table></div>` : ''}
        ${noUntil.length ? `<div class="pay-hint warn">У сопровождения нет даты окончания — в заработанный доход не включено:
          ${noUntil.map((p) => `<b>${esc(studentName[p.student_id] || '')}</b> (${fmtDate(p.paid_at)}, ${money(p.amount)})`).join(', ')}.</div>` : ''}
      </section>

      <section class="section">
        <h2>Зарплата учителей · ${L.months[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}</h2>
        ${sal.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Учитель</th><th class="num">Уроков</th><th class="num">Сумма</th><th class="num">Штрафы</th><th class="num">К выплате</th></tr></thead>
          <tbody>${sal.map((s) => `
            <tr><td>${esc(teacherName[s.teacher_id] || '—')}</td><td class="num">${s.count}</td><td class="num">${money(s.sum)}</td>
            <td class="num ${s.fines ? 'bad-text' : 'muted'}">${s.fines ? '−' + money(s.fines) + ` (${s.fineCount})` : '—'}</td>
            <td class="num"><b>${money(s.total)}</b></td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Итого</td><td class="num">${sal.reduce((a, s) => a + s.count, 0)}</td><td class="num">${money(sal.reduce((a, s) => a + s.sum, 0))}</td>
            <td class="num">−${money(sal.reduce((a, s) => a + s.fines, 0))}</td><td class="num"><b>${money(salTotal)}</b></td></tr></tfoot>
        </table></div>
        <p class="muted small">Считаются проведённые уроки по ставке каждого занятия. Исключения (не платить, штраф) ставятся в «Журнале» или на «Главной».</p>`
        : empty('В этом месяце уроков не было')}
      </section>

      ${intRows.length ? `
      <section class="section">
        <h2>⚡ Интенсивы</h2>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Интенсив</th><th>Даты</th><th>Продажи</th><th class="num">Выручка</th><th class="num">Учителю</th><th class="num">Прибыль</th></tr></thead>
          <tbody>${intRows.map((r) => `
            <tr><td><b>${esc(r.c.name)}</b><div class="muted small">${esc(teacherName[r.c.teacher_id] || 'без учителя')} · ${money(r.c.teacher_rate)} за урок</div></td>
            <td class="nowrap">${fmtShort(r.c.start_date)} — ${r.c.end_date ? fmtShort(r.c.end_date) : '…'}</td>
            <td>${r.s.map((x) => `${esc(x.name)}: ${x.count} × ${money(x.price)}`).join('<br>') || '—'}</td>
            <td class="num">${money(r.income)}</td>
            <td class="num">${money(r.plannedPay)}<div class="muted small">проведено ${r.done} из ${r.planned} ур.</div></td>
            <td class="num"><b>${money(r.income - r.plannedPay)}</b></td></tr>`).join('')}</tbody>
        </table></div>
        <p class="muted small">Интенсив считается в месяце, когда он начался. Оплата учителю за проведённые уроки входит в «Зарплаты учителей» того месяца, когда были уроки.</p>
      </section>` : ''}

      <section class="section">
        <h2>По курсам</h2>
        ${courseTotal ? `<div class="bars">${Object.entries(byCourse).sort((a, b) => b[1] - a[1]).map(([k, v]) => `
          <div class="bar-row"><span class="bar-label">${esc(k)}</span>
            <span class="bar"><span style="width:${Math.max(2, (v / courseTotal) * 100)}%"></span></span>
            <span class="bar-value">${money(v)}</span></div>`).join('')}</div>` : empty('Оплат нет')}
      </section>

      <section class="section">
        <h2>Все оплаты</h2>
        ${pays.length || monthSps.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Дата</th><th>Ученик</th><th>За что</th><th>Способ</th><th class="num">Уроков</th><th class="num">Сумма</th><th class="num">На руки</th></tr></thead>
          <tbody>${pays.filter((p) => !p.migrated).map((p) => {
            const e = enrById[p.enrollment_id] || {};
            return `<tr class="${counts(p) ? '' : 'muted'}"><td>${fmtDate(p.paid_at)}</td><td>${esc(studentName[e.student_id] || '')}</td>
              <td>${esc(payLabel(p))}${counts(p) ? '' : `<div class="small">сопровождение до ${fmtDate(Logic.SUPPORT_CUTOFF)} — в доход не входит</div>`}</td>
              <td class="small">${esc(p.method ? methodName(p.method) + (p.term ? ' ' + p.term + ' мес' : '') : 'не указан')}</td>
              <td class="num">${p.lessons}</td><td class="num">${money(p.amount)}</td><td class="num">${money(Logic.payNet(p))}</td></tr>`;
          }).join('')}${monthSps.map((p) => `<tr><td>${fmtDate(p.paid_at)}</td><td>${esc(studentName[p.student_id] || '')}</td><td>Сопровождение</td>
              <td class="small">${esc(p.method ? methodName(p.method) + (p.term ? ' ' + p.term + ' мес' : '') : 'не указан')}</td>
              <td class="num">—</td><td class="num">${money(p.amount)}</td><td class="num">${money(Logic.payNet(p))}</td></tr>`).join('')}</tbody></table></div>` : empty('В этом месяце оплат не было')}
      </section>

      <section class="section section-ref">
        <h2>Сопровождение (оплачено до ${fmtDate(Logic.SUPPORT_CUTOFF)}) — справочно</h2>
        <p class="muted small">Эти деньги получены давно, в этом месяце их нет. Они <b>не входят</b> ни в фактический, ни в заработанный доход,
          ни в «Разницу», ни в «По курсам», ни в один итог. Блок только для понимания тенденции.</p>
        ${oldSup.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Ученик</th><th class="num">Сумма</th><th>Период</th><th class="num">≈ в месяц</th></tr></thead>
          <tbody>${oldSup.map((x) => `
            <tr class="${x.ended ? 'muted' : ''}"><td>${esc(x.s.full_name)}${x.ended ? ' <span class="small">(закончилось)</span>' : ''}</td><td class="num">${money(x.sum)}</td>
            <td>${fmtDate(x.first)} — ${x.until ? fmtDate(x.until) : '—'}</td><td class="num">${x.per !== null ? money(x.per) : '—'}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3">≈ в месяц по всем (кто ещё учится)</td><td class="num"><b>${money(oldPerTotal)}</b></td></tr></tfoot>
        </table></div>` : empty('Таких учеников нет')}
      </section>`;

    $('#r-month', root).onchange = (e) => { if (e.target.value) { month = e.target.value; render(root); } };
    $('#r-methods', root).onclick = () => methodsModal(methods, () => render(root));
  }

  // Ставки способов оплаты (стартовые — в Logic.PAY_METHODS). Старые оплаты не пересчитываются.
  function methodsModal(methods, done) {
    const inp = (name, v) => `<input type="number" class="input-sm" step="0.01" min="0" name="${name}" value="${pct(v).replace(',', '.')}" placeholder="—">`;
    const m = modal('Способы оплаты', `
      <form class="form">
        <p class="muted small">Комиссия банка и налог — в процентах от полной суммы клиента. Изменения действуют на новые оплаты; уже внесённые оплаты не пересчитываются.</p>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Способ</th><th>Комиссия банка, %</th><th>Налог, %</th></tr></thead>
          <tbody>${methods.map((x) => `
            <tr><td>${esc(x.name)}</td>
            <td>${x.terms ? Object.keys(x.terms).map((t) => `<div class="nowrap">${t} мес ${inp(`fee_${x.id}_${t}`, x.terms[t])}</div>`).join('') : inp(`fee_${x.id}`, x.fee)}</td>
            <td>${inp(`tax_${x.id}`, x.tax)}</td></tr>`).join('')}</tbody>
        </table></div>
        <div class="form-actions">
          <button type="button" class="btn" data-close>Отмена</button>
          <button type="submit" class="btn btn-primary">Сохранить</button>
        </div>
      </form>`, { wide: true });
    const form = $('form', m.el);
    const val = (name) => { const v = form.elements[name].value; return v === '' ? null : Number(v); };
    form.onsubmit = (ev) => {
      ev.preventDefault();
      busy(form.querySelector('[type=submit]'), async () => {
        const list = methods.map((x) => ({ id: x.id, tax: val(`tax_${x.id}`) ?? 0,
          ...(x.terms ? { terms: Object.fromEntries(Object.keys(x.terms).map((t) => [t, val(`fee_${x.id}_${t}`)])) } : { fee: val(`fee_${x.id}`) ?? 0 }) }));
        await DB.savePayMethods(list);
        m.close(); toast('Ставки сохранены'); done();
      });
    };
  }

  window.ReportsPage = { render };
})();
