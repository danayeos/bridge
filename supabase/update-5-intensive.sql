-- =====================================================================
--  ОБНОВЛЕНИЕ 5: интенсивы
--  Интенсив — занятие на определённый срок (например, 2 недели), без списка учеников:
--  только расписание, тарифы (Про 75 000 × 6 чел., Стандарт 50 000 × 5 чел.) и оплата учителю за урок.
--  Supabase → SQL Editor → New query → вставить этот файл → Run. Один раз.
--  Безопасно: данные не удаляются.
-- =====================================================================

-- новый вид занятия: intensive
alter table public.classes drop constraint if exists classes_kind_check;
alter table public.classes add constraint classes_kind_check check (kind in ('individual', 'group', 'intensive'));

-- срок интенсива
alter table public.classes add column if not exists start_date date;
alter table public.classes add column if not exists end_date date;

-- продажи по тарифам (Про 75 000 × 6 чел.) — отдельная таблица, её видит только администратор (учителя цен не видят)
create table if not exists public.intensive_sales (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references public.classes(id) on delete cascade,
  name       text not null,                 -- тариф: «Про», «Стандарт»
  price      int  not null default 0,       -- цена за 1 место, ₸
  count      int  not null default 0,       -- сколько человек купили
  created_at timestamptz not null default now()
);
alter table public.intensive_sales enable row level security;
drop policy if exists intensive_sales_admin on public.intensive_sales;
create policy intensive_sales_admin on public.intensive_sales for all using (public.is_admin()) with check (public.is_admin());

-- курс «Интенсив»
insert into public.courses (name) values ('Интенсив') on conflict (name) do nothing;

-- расписание школы для учителей: у интенсива даты начала и конца берутся из самого занятия
drop function if exists public.school_schedule();
create function public.school_schedule()
returns table (id uuid, name text, course_id int, teacher_id uuid, teacher_name text, kind text, mode text,
               schedule jsonb, duration int, active boolean, start_date date, end_date date, students int)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.course_id, c.teacher_id, t.full_name, c.kind, c.mode, c.schedule, c.duration, c.active,
         coalesce(c.start_date, (select min(e.start_date) from enrollments e where e.class_id = c.id)),
         c.end_date,
         (select count(*)::int from enrollments e join students s on s.id = e.student_id
           where e.class_id = c.id and e.active and s.active)
  from classes c
  left join teachers t on t.id = c.teacher_id
  where public.is_staff();
$$;
