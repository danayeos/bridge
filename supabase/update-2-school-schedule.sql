-- =====================================================================
--  ОБНОВЛЕНИЕ 2: общее расписание школы для учителей + длительность урока
--  Supabase → SQL Editor → New query → вставить этот файл → Run. Один раз.
--  Безопасно: данные не удаляются. Учителя видят только расписание (без цен и ставок).
-- =====================================================================

-- длительность урока в минутах (нужна, чтобы видеть, кто сейчас в Zoom)
alter table public.classes add column if not exists duration int not null default 60;

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
