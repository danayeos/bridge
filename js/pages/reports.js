// Деньги за месяц: оплаты учеников и зарплаты учителей.
(function () {
  const { L, esc, $, money, fmtDate, fmtShort, empty } = UI;
  let month = null;

  async function render(root) {
    if (!month) month = Logic.today().slice(0, 7);
    root.innerHTML = `<div class="loading">Загрузка…</div>`;
    const [from, to] = Logic.monthRange(month);
    const [pays, lessons, enrollments, students, classes, teachers, courses] = await Promise.all([
      DB.payments(from, to), DB.lessons(from, to), DB.enrollments(), DB.students(), DB.classes(), DB.teachers(), DB.courses(),
    ]);
    const enrById = Object.fromEntries(enrollments.map((e) => [e.id, e]));
    const studentName = Object.fromEntries(students.map((s) => [s.id, s.full_name]));
    const classById = Object.fromEntries(classes.map((c) => [c.id, c]));
    const courseName = Object.fromEntries(courses.map((c) => [c.id, c.name]));
    const teacherName = Object.fromEntries(teachers.map((t) => [t.id, t.full_name]));

    const income = pays.reduce((s, p) => s + p.amount, 0);
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

    // доход по курсам
    const byCourse = {};
    for (const p of pays) {
      const k = coursesOf(p).join(' + ');
      byCourse[k] = (byCourse[k] || 0) + p.amount;
    }

    root.innerHTML = `
      <div class="page-head">
        <h1>Деньги</h1>
        <input type="month" id="r-month" value="${month}">
      </div>

      <div class="tiles">
        <div class="tile"><div class="tile-label">Оплаты учеников</div><div class="tile-value">${money(income)}</div><div class="muted small">${pays.length} оплат</div></div>
        <div class="tile"><div class="tile-label">Зарплаты учителей</div><div class="tile-value">${money(salTotal)}</div></div>
        <div class="tile"><div class="tile-label">Разница</div><div class="tile-value accent">${money(income - salTotal)}</div></div>
      </div>

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

      <section class="section">
        <h2>По курсам</h2>
        ${Object.keys(byCourse).length ? `<div class="bars">${Object.entries(byCourse).sort((a, b) => b[1] - a[1]).map(([k, v]) => `
          <div class="bar-row"><span class="bar-label">${esc(k)}</span>
            <span class="bar"><span style="width:${Math.max(2, (v / income) * 100)}%"></span></span>
            <span class="bar-value">${money(v)}</span></div>`).join('')}</div>` : empty('Оплат нет')}
      </section>

      <section class="section">
        <h2>Все оплаты</h2>
        ${pays.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Дата</th><th>Ученик</th><th>За что</th><th class="num">Уроков</th><th class="num">Сумма</th></tr></thead>
          <tbody>${pays.map((p) => {
            const e = enrById[p.enrollment_id] || {};
            return `<tr><td>${fmtDate(p.paid_at)}</td><td>${esc(studentName[e.student_id] || '')}</td>
              <td>${esc(payLabel(p))}</td><td class="num">${p.lessons}</td><td class="num">${money(p.amount)}</td></tr>`;
          }).join('')}</tbody></table></div>` : empty('В этом месяце оплат не было')}
      </section>`;

    $('#r-month', root).onchange = (e) => { if (e.target.value) { month = e.target.value; render(root); } };
  }

  window.ReportsPage = { render };
})();
