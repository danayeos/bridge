-- =====================================================================
--  ОБНОВЛЕНИЕ 4: одна оплата за несколько курсов, но уроки у каждого курса свои
--  (например: 240 000 ₸ за 2 курса — по 12 уроков на каждый курс)
--  Supabase → SQL Editor → New query → вставить этот файл → Run. Один раз.
--  Безопасно: данные не удаляются. Можно запускать, даже если update-3 не запускали.
-- =====================================================================

-- курс, с которым этот курс оплачивается одной оплатой (пусто — оплата отдельная)
alter table public.enrollments add column if not exists pay_with uuid references public.enrollments(id) on delete set null;
alter table public.enrollments drop constraint if exists enrollments_pay_with_self;
alter table public.enrollments add constraint enrollments_pay_with_self check (pay_with is null or pay_with <> id);

-- строки одной общей оплаты (по строке на курс) связаны общим bundle_id
alter table public.payments add column if not exists bundle_id uuid;
create index if not exists payments_bundle_idx on public.payments (bundle_id);

-- остаток уроков: у каждого курса свой
create or replace view public.enrollment_stats with (security_invoker = true) as
select
  e.id as enrollment_id,
  e.initial_lessons + coalesce(p.paid_lessons, 0) as paid_lessons,
  coalesce(u.used_lessons, 0)                     as used_lessons,
  e.initial_lessons + coalesce(p.paid_lessons, 0) - coalesce(u.used_lessons, 0) as remaining,
  p.last_payment,
  coalesce(e.pay_with, e.id)                      as account_id
from public.enrollments e
left join (
  select enrollment_id, sum(lessons)::int as paid_lessons, max(paid_at) as last_payment
  from public.payments group by enrollment_id
) p on p.enrollment_id = e.id
left join (
  select a.enrollment_id, count(*)::int as used_lessons
  from public.attendance a
  join public.lessons l on l.id = a.lesson_id
  where l.status in ('done', 'cancelled') and (a.present or a.decision = 'burned')
  group by a.enrollment_id
) u on u.enrollment_id = e.id;
