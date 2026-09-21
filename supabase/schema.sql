create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  branch text,
  instrument text,
  role text not null default 'student' check (role in ('student','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  fee_inr integer not null default 0 check (fee_inr >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.instructors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text not null,
  branch text,
  image_url text,
  bio text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  phone text not null,
  email text,
  instrument text not null,
  level text not null,
  preferred_batch text not null,
  message text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id),
  enquiry_id uuid references public.enquiries(id) on delete set null,
  branch text,
  level text not null,
  batch text not null,
  fee_inr integer not null check (fee_inr >= 0),
  status text not null default 'pending' check (status in ('pending','active','paused','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  enrollment_id uuid references public.enrollments(id) on delete set null,
  amount_inr integer not null check (amount_inr > 0),
  currency text not null default 'INR',
  provider text not null default 'manual',
  provider_order_id text,
  provider_payment_id text,
  receipt text unique,
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_enquiries_student on public.enquiries(student_id);
create index if not exists idx_enrollments_student on public.enrollments(student_id);
create index if not exists idx_payments_student on public.payments(student_id);
create index if not exists idx_payments_status on public.payments(status);

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
drop trigger if exists enquiries_updated_at on public.enquiries;
create trigger enquiries_updated_at before update on public.enquiries
for each row execute function public.set_updated_at();
drop trigger if exists enrollments_updated_at on public.enrollments;
create trigger enrollments_updated_at before update on public.enrollments
for each row execute function public.set_updated_at();
drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at before update on public.payments
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name',''),
          coalesce(new.raw_user_meta_data ->> 'phone',''), 'student')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create schema if not exists private;

create or replace function private.is_admin()
returns boolean language sql stable
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke execute on function private.is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.instructors enable row level security;
alter table public.enquiries enable row level security;
alter table public.enrollments enable row level security;
alter table public.payments enable row level security;

revoke all on table public.profiles, public.courses, public.instructors, public.enquiries, public.enrollments, public.payments from anon;
grant select on public.courses, public.instructors to anon;
grant select, insert on public.enquiries to authenticated;
grant select on public.profiles, public.enrollments, public.payments, public.courses, public.instructors to authenticated;
grant update on public.enquiries, public.enrollments, public.payments to authenticated;

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select to authenticated
using ((select auth.uid()) = id or (select private.is_admin()));

drop policy if exists profiles_self_update on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists courses_public_read on public.courses;
create policy courses_public_read on public.courses for select to anon, authenticated
using (active = true or (select private.is_admin()));

drop policy if exists instructors_public_read on public.instructors;
create policy instructors_public_read on public.instructors for select to anon, authenticated
using (active = true or (select private.is_admin()));

drop policy if exists enquiries_student_insert on public.enquiries;
create policy enquiries_student_insert on public.enquiries for insert to authenticated
with check ((select auth.uid()) = student_id);

drop policy if exists enquiries_student_read on public.enquiries;
create policy enquiries_student_read on public.enquiries for select to authenticated
using ((select auth.uid()) = student_id or (select private.is_admin()));

drop policy if exists enquiries_admin_update on public.enquiries;
create policy enquiries_admin_update on public.enquiries for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists enrollments_student_insert on public.enrollments;

drop policy if exists enrollments_student_read on public.enrollments;
create policy enrollments_student_read on public.enrollments for select to authenticated
using ((select auth.uid()) = student_id or (select private.is_admin()));

drop policy if exists enrollments_admin_update on public.enrollments;
create policy enrollments_admin_update on public.enrollments for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists payments_student_insert on public.payments;

drop policy if exists payments_student_read on public.payments;
create policy payments_student_read on public.payments for select to authenticated
using ((select auth.uid()) = student_id or (select private.is_admin()));

drop policy if exists payments_admin_update on public.payments;
create policy payments_admin_update on public.payments for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

insert into public.courses (name,description,fee_inr) values
 ('Guitar','Technique, chords, rhythm and performance.',1500),
 ('Keyboard / Piano','Keys, theory, coordination and repertoire.',1500),
 ('Drums','Groove, timing, coordination and live playing.',1500),
 ('Violin','Technique, tone, notation and expression.',1500),
 ('Bass Guitar','Rhythm, groove, scales and ensemble playing.',1500),
 ('Ukulele','Chords, strumming, rhythm and easy performance.',1200)
on conflict (name) do nothing;

insert into public.instructors (name,title,branch,bio) values
 ('Miss. RATAKIRU PARIAT','Principal','Moodop Nartiang Branch','School leadership and academic coordination.'),
 ('Mr. ONIKSON PARIAT','Chairman / Principal','Ummulong Branch','School leadership and branch coordination.');

-- Students request an enrollment through this trusted database function.
-- The fee is always copied from the selected course, never accepted from the browser.
create or replace function public.create_student_enrollment(
  p_course_id uuid,
  p_branch text,
  p_level text,
  p_batch text,
  p_enquiry_id uuid default null
)
returns public.enrollments
language plpgsql
security definer
set search_path = public
as $
declare
  v_course public.courses%rowtype;
  v_row public.enrollments%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_course
  from public.courses
  where id = p_course_id and active = true;

  if not found then
    raise exception 'Course not found or inactive';
  end if;

  if p_enquiry_id is not null and not exists (
    select 1 from public.enquiries
    where id = p_enquiry_id and student_id = auth.uid()
  ) then
    raise exception 'Invalid enquiry';
  end if;

  insert into public.enrollments(student_id,course_id,enquiry_id,branch,level,batch,fee_inr,status)
  values(auth.uid(),p_course_id,p_enquiry_id,p_branch,p_level,p_batch,v_course.fee_inr,'pending')
  returning * into v_row;

  return v_row;
end;
$;

revoke all on function public.create_student_enrollment(uuid,text,text,text,uuid) from public, anon;
grant execute on function public.create_student_enrollment(uuid,text,text,text,uuid) to authenticated;

-- After creating the admin Auth user, promote it:
-- update public.profiles set role = 'admin' where id = 'YOUR-AUTH-USER-UUID';
