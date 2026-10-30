-- =====================================================================
--  ОБНОВЛЕНИЕ 6: сопровождение — тип ученика; способы оплаты, комиссия банка и налог
--  Supabase → SQL Editor → New query → вставить этот файл → Run. Один раз.
--  Безопасно: данные не удаляются, повторный запуск ничего не ломает.
-- =====================================================================

-- ---------- Ученик: тип оплаты ----------
-- monthly — ежемесячно (пакеты уроков), support — сопровождение (оплачено вперёд до support_until)
alter table public.students add column if not exists pay_type text not null default 'monthly';
alter table public.students drop constraint if exists students_pay_type_check;
alter table public.students add constraint students_pay_type_check check (pay_type in ('monthly', 'support'));
alter table public.students add column if not exists support_until date;   -- до какой даты учится

-- ---------- Оплаты пакетов: способ, комиссия банка и налог на момент оплаты ----------
alter table public.payments add column if not exists method   text;        -- kaspi, kaspi_credit, gold, halyk, cash (пусто — не указан)
alter table public.payments add column if not exists term     int;         -- срок рассрочки, мес
alter table public.payments add column if not exists fee_pct  numeric;     -- % комиссии банка на момент оплаты
alter table public.payments add column if not exists tax_pct  numeric;     -- % налога на момент оплаты
alter table public.payments add column if not exists fee      int not null default 0;
alter table public.payments add column if not exists tax      int not null default 0;
alter table public.payments add column if not exists net      int;         -- на руки (пусто у старых оплат — вся сумма)
alter table public.payments add column if not exists migrated boolean not null default false; -- перенесена в сопровождение ученика, в итогах не считается

-- ---------- Оплаты сопровождения (у ученика; в таблицу payments не пишутся) ----------
create table if not exists public.support_payments (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.students(id) on delete cascade,
  paid_at       date not null default current_date,
  amount        int  not null default 0,
  method        text,
  term          int,
  fee_pct       numeric,
  tax_pct       numeric,
  fee           int  not null default 0,
  tax           int  not null default 0,
  net           int,
  note          text,
  migrated_from uuid references public.payments(id) on delete set null,  -- из какой старой строки перенесено
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists support_payments_student_idx on public.support_payments (student_id);

-- ---------- Настройки (ставки способов оплаты) ----------
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.support_payments enable row level security;
alter table public.settings         enable row level security;
drop policy if exists support_payments_admin on public.support_payments;
create policy support_payments_admin on public.support_payments for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for all using (public.is_admin()) with check (public.is_admin());
