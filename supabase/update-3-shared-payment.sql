-- =====================================================================
--  ОБНОВЛЕНИЕ 3: общая оплата за несколько курсов одного ученика
--  Supabase → SQL Editor → New query → вставить этот файл → Run. Один раз.
--  Безопасно: данные не удаляются.
-- =====================================================================

-- курс, с которым у этого курса общая оплата (пусто — оплата своя)
alter table public.enrollments add column if not exists pay_with uuid references public.enrollments(id) on delete set null;
alter table public.enrollments drop constraint if exists enrollments_pay_with_self;
alter table public.enrollments add constraint enrollments_pay_with_self check (pay_with is null or pay_with <> id);

-- остаток уроков: курсы с общей оплатой считаются вместе (account_id — общий «счёт»)
create or replace view public.enrollment_stats with (security_invoker = true) as
with acc as (
  select id, coalesce(pay_with, id) as acc, initial_lessons from public.enrollments
), init as (
  select acc, sum(initial_lessons)::int as n from acc group by acc
), pay as (
  select a.acc, sum(p.lessons)::int as n, max(p.paid_at) as last_payment
  from public.payments p join acc a on a.id = p.enrollment_id group by a.acc
), used as (
  select a.acc, count(*)::int as n
  from public.attendance t
  join public.lessons l on l.id = t.lesson_id
  join acc a on a.id = t.enrollment_id
  where l.status in ('done', 'cancelled') and (t.present or t.decision = 'burned')
  group by a.acc
)
select
  a.id as enrollment_id,
  i.n + coalesce(p.n, 0)                     as paid_lessons,
  coalesce(u.n, 0)                           as used_lessons,
  i.n + coalesce(p.n, 0) - coalesce(u.n, 0)  as remaining,
  p.last_payment,
  a.acc                                      as account_id
from acc a
join init i on i.acc = a.acc
left join pay p on p.acc = a.acc
left join used u on u.acc = a.acc;
