-- =====================================================================
--  BRIDGE — база данных школы (Supabase / PostgreSQL)
--  Как использовать: Supabase → SQL Editor → New query → вставить весь
--  этот файл → Run. Запускать один раз на пустом проекте.
-- =====================================================================

-- ---------- Пользователи (аккаунты) ----------
-- role: pending — зарегистрировался, ждёт подтверждения администратора
--       admin   — администратор
--       teacher — учитель
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'pending' check (role in ('pending', 'admin', 'teacher')),
  created_at timestamptz not null default now()
);

-- ---------- Учителя ----------
create table public.teachers (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null,
  user_id    uuid unique references public.profiles(id) on delete set null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Курсы ----------
create table public.courses (
  id   serial primary key,
  name text not null unique
);
insert into public.courses (name) values ('SAT'), ('IELTS'), ('NUET'), ('Математика'), ('Английский');

-- ---------- Занятия (группа или индивидуальные уроки) ----------
-- schedule: [{"day":1,"time":"16:00"}, ...]   day: 1 = Пн ... 7 = Вс
create table public.classes (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  course_id    int  not null references public.courses(id),
  teacher_id   uuid references public.teachers(id) on delete set null,
  kind         text not null check (kind in ('individual', 'group')),
  mode         text not null check (mode in ('online', 'offline')),
  teacher_rate int  not null default 0,             -- оплата учителю за 1 урок, ₸
  schedule     jsonb not null default '[]'::jsonb,
  rate_history jsonb not null default '[]'::jsonb,   -- [{"from":"2026-10-01","rate":5000}]
  duration     int  not null default 60,              -- длительность урока, мин
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------- Ученики ----------
create table public.students (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null,
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Ученик в занятии (свой пакет и цена) ----------
-- plan: package — обычная оплата пакетами (8 / 12 уроков, 6 мес, 2 года ...)
--       support — сопровождение (всё оплачено, напоминать не нужно)
create table public.enrollments (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.students(id) on delete cascade,
  class_id        uuid not null references public.classes(id) on delete cascade,
  plan            text not null default 'package' check (plan in ('package', 'support')),
  package_lessons int  not null default 8,
  package_price   int  not null default 0,
  start_date      date not null default current_date,
  initial_lessons int  not null default 0,          -- сколько оплаченных уроков было на момент добавления
  active          boolean not null default true,
  pay_with        uuid references public.enrollments(id) on delete set null, -- общая оплата с другим курсом ученика
  created_at      timestamptz not null default now(),
  unique (student_id, class_id),
  constraint enrollments_pay_with_self check (pay_with is null or pay_with <> id)
);

-- ---------- Оплаты ----------
create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  paid_at       date not null default current_date,
  amount        int  not null default 0,
  lessons       int  not null,                       -- сколько уроков добавляет оплата
  note          text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);

-- ---------- Уроки ----------
-- status: planned     — перенесённый урок, ещё не прошёл
--         done        — урок прошёл
--         rescheduled — перенесён на другую дату (moved_to_*)
--         cancelled   — отменён
create table public.lessons (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references public.classes(id) on delete cascade,
  teacher_id    uuid references public.teachers(id) on delete set null,
  date          date not null,
  time          text not null default '',
  status        text not null check (status in ('planned', 'done', 'rescheduled', 'cancelled')),
  origin_id     uuid references public.lessons(id) on delete set null,   -- откуда перенесли
  moved_to_date date,
  moved_to_time text,
  caused_by     text check (caused_by in ('student', 'teacher')),
  reason        text check (reason in ('sick', 'overslept', 'other')),
  reason_text   text,
  rate          int  not null default 0,             -- оплата учителю за этот урок
  teacher_paid  boolean,                             -- null = по умолчанию (прошёл → да)
  fine          int  not null default 0,             -- штраф учителю
  reviewed      boolean not null default false,      -- администратор проверил
  comment       text,
  marked_by     uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index lessons_slot_uniq on public.lessons (class_id, date, time) where origin_id is null;
create index lessons_date_idx on public.lessons (date);

-- ---------- Посещаемость ----------
-- decision для отсутствующих: burned — урок сгорает, moved — не сгорает (перенос)
--                             null   — ждёт решения администратора
create table public.attendance (
  lesson_id     uuid not null references public.lessons(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  present       boolean not null,
  decision      text check (decision in ('burned', 'moved')),
  primary key (lesson_id, enrollment_id)
);
create index attendance_enrollment_idx on public.attendance (enrollment_id);

-- =====================================================================
--  Вспомогательные функции
-- =====================================================================
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.my_teacher_id() returns uuid
language sql stable security definer set search_path = public as $$
  select t.id from teachers t
  join profiles p on p.id = t.user_id
  where t.user_id = auth.uid() and p.role = 'teacher' and t.active
  limit 1;
$$;

create or replace function public.teaches_class(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from classes where id = cid and teacher_id = public.my_teacher_id());
$$;

-- Ставка занятия на дату (с учётом истории ставок)
create or replace function public.class_rate_on(cid uuid, d date) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (h ->> 'rate')::int
       from classes c, jsonb_array_elements(c.rate_history) h
      where c.id = cid and (h ->> 'from')::date <= d
      order by (h ->> 'from')::date desc
      limit 1),
    (select teacher_rate from classes where id = cid),
    0);
$$;

-- Новый аккаунт → профиль. Самый первый аккаунт становится администратором.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when exists (select 1 from profiles where role = 'admin') then 'pending' else 'admin' end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Урок: учитель не может менять штраф, оплату и проверку. Ставка и учитель берутся из занятия.
create or replace function public.lessons_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c classes%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into c from classes where id = new.class_id;
    if new.teacher_id is null then new.teacher_id := c.teacher_id; end if;
    if not public.is_admin() or new.rate = 0 then new.rate := public.class_rate_on(new.class_id, new.date); end if;
  end if;
  if not public.is_admin() then
    if tg_op = 'INSERT' then
      new.fine := 0; new.teacher_paid := null; new.reviewed := false;
    else
      new.fine := old.fine; new.teacher_paid := old.teacher_paid; new.rate := old.rate;
      new.teacher_id := old.teacher_id;
      -- после изменения учителем администратор должен проверить заново
      new.reviewed := false;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger lessons_guard
  before insert or update on public.lessons
  for each row execute function public.lessons_guard();

-- Посещаемость: решение «сгорает / перенос» ставит только администратор.
-- В группе отсутствие автоматически = сгорает.
create or replace function public.attendance_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_group boolean;
begin
  if public.is_admin() then
    if new.present then new.decision := null; end if;
    return new;
  end if;
  select c.kind = 'group' into is_group
  from lessons l join classes c on c.id = l.class_id
  where l.id = new.lesson_id;

  if new.present then
    new.decision := null;
  elsif tg_op = 'UPDATE' and not old.present then
    new.decision := old.decision;
  elsif is_group then
    new.decision := 'burned';
  else
    new.decision := null;
  end if;
  return new;
end $$;

create trigger attendance_guard
  before insert or update on public.attendance
  for each row execute function public.attendance_guard();

-- Список учеников по занятиям (без цен) — для учителя только его занятия.
create or replace function public.class_roster()
returns table (enrollment_id uuid, class_id uuid, student_id uuid, student_name text,
               start_date date, active boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.class_id, s.id, s.full_name, e.start_date, (e.active and s.active)
  from enrollments e
  join students s on s.id = e.student_id
  join classes c on c.id = e.class_id
  where public.is_admin() or c.teacher_id = public.my_teacher_id()
  order by s.full_name;
$$;

-- Общее расписание школы для учителей (без цен и ставок)
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'teacher'));
$$;

-- все занятия школы: без ставок и цен
create or replace function public.school_schedule()
returns table (id uuid, name text, course_id int, teacher_id uuid, teacher_name text, kind text, mode text,
               schedule jsonb, duration int, active boolean, start_date date, students int)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.course_id, c.teacher_id, t.full_name, c.kind, c.mode, c.schedule, c.duration, c.active,
         (select min(e.start_date) from enrollments e where e.class_id = c.id),
         (select count(*)::int from enrollments e join students s on s.id = e.student_id
           where e.class_id = c.id and e.active and s.active)
  from classes c
  left join teachers t on t.id = c.teacher_id
  where public.is_staff();
$$;

-- уроки всех учителей за период (переносы, отмены): без ставок, штрафов и посещаемости
create or replace function public.school_lessons(d1 date, d2 date)
returns table (id uuid, class_id uuid, date date, "time" text, status text, origin_id uuid,
               moved_to_date date, moved_to_time text)
language sql stable security definer set search_path = public as $$
  select l.id, l.class_id, l.date, l.time, l.status, l.origin_id, l.moved_to_date, l.moved_to_time
  from lessons l
  where public.is_staff() and l.date between d1 and d2;
$$;

-- =====================================================================
--  Остаток уроков у каждого ученика (только для администратора)
-- =====================================================================
-- остаток уроков: курсы с общей оплатой считаются вместе (account_id — общий «счёт»)
create view public.enrollment_stats with (security_invoker = true) as
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

-- =====================================================================
--  Права доступа (Row Level Security)
-- =====================================================================
alter table public.profiles    enable row level security;
alter table public.teachers    enable row level security;
alter table public.courses     enable row level security;
alter table public.classes     enable row level security;
alter table public.students    enable row level security;
alter table public.enrollments enable row level security;
alter table public.payments    enable row level security;
alter table public.lessons     enable row level security;
alter table public.attendance  enable row level security;

-- профили: каждый видит себя, администратор — всех
create policy profiles_self  on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_admin on public.profiles for update using (public.is_admin());
create policy profiles_admin_del on public.profiles for delete using (public.is_admin());

-- учителя
create policy teachers_admin on public.teachers for all using (public.is_admin()) with check (public.is_admin());
create policy teachers_self  on public.teachers for select using (user_id = auth.uid());

-- курсы: читать могут все вошедшие
create policy courses_read  on public.courses for select using (auth.uid() is not null);
create policy courses_admin on public.courses for all using (public.is_admin()) with check (public.is_admin());

-- занятия
create policy classes_admin   on public.classes for all using (public.is_admin()) with check (public.is_admin());
create policy classes_teacher on public.classes for select using (teacher_id = public.my_teacher_id());

-- ученики, записи, оплаты — только администратор (учитель видит учеников через class_roster)
create policy students_admin    on public.students    for all using (public.is_admin()) with check (public.is_admin());
create policy enrollments_admin on public.enrollments for all using (public.is_admin()) with check (public.is_admin());
create policy payments_admin    on public.payments    for all using (public.is_admin()) with check (public.is_admin());

-- уроки
create policy lessons_admin on public.lessons for all using (public.is_admin()) with check (public.is_admin());
create policy lessons_teacher_sel on public.lessons for select using (public.teaches_class(class_id));
create policy lessons_teacher_ins on public.lessons for insert with check (public.teaches_class(class_id));
create policy lessons_teacher_upd on public.lessons for update using (public.teaches_class(class_id)) with check (public.teaches_class(class_id));
create policy lessons_teacher_del on public.lessons for delete using (public.teaches_class(class_id) and status = 'planned');

-- посещаемость
create policy attendance_admin on public.attendance for all using (public.is_admin()) with check (public.is_admin());
create policy attendance_teacher on public.attendance for all
  using (exists (select 1 from public.lessons l where l.id = lesson_id and public.teaches_class(l.class_id)))
  with check (exists (select 1 from public.lessons l where l.id = lesson_id and public.teaches_class(l.class_id)));
