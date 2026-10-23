-- =====================================================================
--  ОБНОВЛЕНИЕ 1: ставка учителя по датам (например, до 30.09 — 4000, с 01.10 — 5000)
--  Supabase → SQL Editor → New query → вставить этот файл → Run. Один раз.
--  Безопасно: данные не удаляются.
-- =====================================================================

-- история ставок: [{"from":"2026-10-01","rate":5000}, ...]
alter table public.classes add column if not exists rate_history jsonb not null default '[]'::jsonb;

-- ставка занятия на конкретную дату
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

-- новый урок получает ставку, которая действовала в день урока
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
      new.reviewed := false;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
