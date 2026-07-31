-- CBT SMP - Database terpusat Supabase
-- Jalankan seluruh file ini sekali melalui Supabase Dashboard > SQL Editor.
-- File ini membuat tabel, keamanan RLS, fungsi RPC, akun demo, dan ujian contoh.

create schema if not exists extensions;
create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_users (
  id uuid primary key default extensions.gen_random_uuid(),
  username text not null,
  password_hash text not null,
  name text not null,
  role text not null check (role in ('teacher', 'student')),
  class_name text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists app_users_username_lower_uidx
  on public.app_users (lower(username));

create table if not exists public.app_sessions (
  token uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);
create index if not exists app_sessions_user_idx on public.app_sessions(user_id);
create index if not exists app_sessions_expiry_idx on public.app_sessions(expires_at);

create table if not exists public.exams (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null,
  subject text not null,
  class_name text not null default '',
  duration_minutes integer not null check (duration_minutes between 1 and 300),
  passing_score integer not null check (passing_score between 0 and 100),
  active boolean not null default true,
  randomize_questions boolean not null default true,
  randomize_options boolean not null default true,
  allow_retake boolean not null default false,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default extensions.gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  position integer not null,
  question_text text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) >= 2),
  correct_index integer not null check (correct_index >= 0),
  created_at timestamptz not null default now(),
  unique (exam_id, position)
);
create index if not exists questions_exam_idx on public.questions(exam_id, position);

create table if not exists public.attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  runtime_questions jsonb not null,
  answers jsonb not null default '[]'::jsonb,
  flagged jsonb not null default '[]'::jsonb,
  current_index integer not null default 0,
  focus_losses integer not null default 0,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  started_at timestamptz not null default now(),
  end_at timestamptz not null,
  submitted_at timestamptz,
  time_expired boolean not null default false
);
create index if not exists attempts_user_exam_idx on public.attempts(user_id, exam_id, status);

create table if not exists public.results (
  id uuid primary key default extensions.gen_random_uuid(),
  attempt_id uuid unique references public.attempts(id) on delete set null,
  exam_id uuid references public.exams(id) on delete set null,
  user_id uuid references public.app_users(id) on delete set null,
  exam_title text not null,
  student_name text not null,
  class_name text not null default '',
  correct_count integer not null,
  total_questions integer not null,
  score integer not null,
  passing_score integer not null,
  answers jsonb not null,
  focus_losses integer not null default 0,
  started_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  time_expired boolean not null default false
);
create index if not exists results_user_idx on public.results(user_id, submitted_at desc);
create index if not exists results_exam_idx on public.results(exam_id, submitted_at desc);

-- Semua tabel di schema public dilindungi RLS dan tidak diakses langsung oleh browser.
alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.exams enable row level security;
alter table public.questions enable row level security;
alter table public.attempts enable row level security;
alter table public.results enable row level security;

revoke all on public.app_users, public.app_sessions, public.exams, public.questions, public.attempts, public.results from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on schema private from public, anon, authenticated;

create or replace function private.session_user(p_token uuid)
returns public.app_users
language sql
stable
security definer
set search_path = ''
as $$
  select u
  from public.app_sessions s
  join public.app_users u on u.id = s.user_id
  where s.token = p_token
    and s.expires_at > now()
    and u.active = true
  limit 1;
$$;

create or replace function private.attempt_payload(p_attempt_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'attemptId', a.id,
    'examId', a.exam_id,
    'examTitle', e.title,
    'subject', e.subject,
    'durationMinutes', e.duration_minutes,
    'passingScore', e.passing_score,
    'runtimeQuestions', a.runtime_questions,
    'answers', a.answers,
    'flagged', a.flagged,
    'currentIndex', a.current_index,
    'focusLosses', a.focus_losses,
    'startAt', extract(epoch from a.started_at) * 1000,
    'endAt', extract(epoch from a.end_at) * 1000
  )
  from public.attempts a
  join public.exams e on e.id = a.exam_id
  where a.id = p_attempt_id;
$$;

create or replace function private.finalize_attempt(p_attempt_id uuid, p_time_expired boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.attempts;
  v_exam public.exams;
  v_student public.app_users;
  v_existing public.results;
  v_total integer;
  v_correct integer := 0;
  v_i integer;
  v_question_id uuid;
  v_answer_text text;
  v_correct_index integer;
  v_score integer;
  v_result public.results;
begin
  select * into v_attempt
  from public.attempts
  where id = p_attempt_id
  for update;

  if v_attempt.id is null then
    raise exception 'Pengerjaan tidak ditemukan.';
  end if;

  select * into v_existing from public.results where attempt_id = p_attempt_id;
  if v_existing.id is not null then
    return jsonb_build_object(
      'id', v_existing.id,
      'examId', v_existing.exam_id,
      'examTitle', v_existing.exam_title,
      'userId', v_existing.user_id,
      'studentName', v_existing.student_name,
      'className', v_existing.class_name,
      'correctCount', v_existing.correct_count,
      'totalQuestions', v_existing.total_questions,
      'score', v_existing.score,
      'passingScore', v_existing.passing_score,
      'answers', v_existing.answers,
      'focusLosses', v_existing.focus_losses,
      'startedAt', v_existing.started_at,
      'submittedAt', v_existing.submitted_at,
      'timeExpired', v_existing.time_expired
    );
  end if;

  select * into v_exam from public.exams where id = v_attempt.exam_id;
  select * into v_student from public.app_users where id = v_attempt.user_id;
  if v_exam.id is null or v_student.id is null then
    raise exception 'Data ujian atau siswa tidak ditemukan.';
  end if;

  v_total := jsonb_array_length(v_attempt.runtime_questions);
  if v_total <= 0 then
    raise exception 'Ujian tidak memiliki soal.';
  end if;

  for v_i in 0..(v_total - 1) loop
    v_question_id := (v_attempt.runtime_questions -> v_i ->> 'id')::uuid;
    v_answer_text := v_attempt.answers ->> v_i;
    select q.correct_index into v_correct_index
    from public.questions q
    where q.id = v_question_id and q.exam_id = v_attempt.exam_id;

    if v_answer_text is not null and v_correct_index is not null
       and v_answer_text::integer = v_correct_index then
      v_correct := v_correct + 1;
    end if;
  end loop;

  v_score := round((v_correct::numeric / v_total::numeric) * 100)::integer;

  insert into public.results (
    attempt_id, exam_id, user_id, exam_title, student_name, class_name,
    correct_count, total_questions, score, passing_score, answers,
    focus_losses, started_at, submitted_at, time_expired
  ) values (
    v_attempt.id, v_attempt.exam_id, v_attempt.user_id, v_exam.title,
    v_student.name, v_student.class_name, v_correct, v_total, v_score,
    v_exam.passing_score, v_attempt.answers, v_attempt.focus_losses,
    v_attempt.started_at, now(), p_time_expired
  ) returning * into v_result;

  update public.attempts
  set status = 'submitted', submitted_at = v_result.submitted_at, time_expired = p_time_expired
  where id = v_attempt.id;

  return jsonb_build_object(
    'id', v_result.id,
    'examId', v_result.exam_id,
    'examTitle', v_result.exam_title,
    'userId', v_result.user_id,
    'studentName', v_result.student_name,
    'className', v_result.class_name,
    'correctCount', v_result.correct_count,
    'totalQuestions', v_result.total_questions,
    'score', v_result.score,
    'passingScore', v_result.passing_score,
    'answers', v_result.answers,
    'focusLosses', v_result.focus_losses,
    'startedAt', v_result.started_at,
    'submittedAt', v_result.submitted_at,
    'timeExpired', v_result.time_expired
  );
end;
$$;

create or replace function public.app_login(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_users;
  v_token uuid;
begin
  delete from public.app_sessions where expires_at <= now();

  select * into v_user
  from public.app_users
  where lower(username) = lower(trim(p_username))
    and active = true
  limit 1;

  if v_user.id is null or extensions.crypt(p_password, v_user.password_hash) <> v_user.password_hash then
    raise exception 'Nama pengguna atau kata sandi salah.';
  end if;

  insert into public.app_sessions(user_id)
  values (v_user.id)
  returning token into v_token;

  return jsonb_build_object(
    'token', v_token,
    'user', jsonb_build_object(
      'id', v_user.id,
      'username', v_user.username,
      'name', v_user.name,
      'role', v_user.role,
      'className', v_user.class_name
    )
  );
end;
$$;

create or replace function public.app_logout(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.app_sessions where token = p_token;
  return true;
end;
$$;

create or replace function public.app_bootstrap(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_users;
  v_users jsonb := '[]'::jsonb;
  v_exams jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  select * into v_user from private.session_user(p_token);
  if v_user.id is null then raise exception 'Sesi telah berakhir. Silakan masuk kembali.'; end if;

  update public.app_sessions
  set expires_at = now() + interval '7 days'
  where token = p_token;

  if v_user.role = 'teacher' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'username', u.username, 'name', u.name,
      'role', u.role, 'className', u.class_name, 'active', u.active
    ) order by u.role, u.name), '[]'::jsonb)
    into v_users
    from public.app_users u;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'title', e.title,
      'subject', e.subject,
      'className', e.class_name,
      'durationMinutes', e.duration_minutes,
      'passingScore', e.passing_score,
      'active', e.active,
      'randomizeQuestions', e.randomize_questions,
      'randomizeOptions', e.randomize_options,
      'allowRetake', e.allow_retake,
      'createdAt', e.created_at,
      'updatedAt', e.updated_at,
      'questions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', q.id,
          'text', q.question_text,
          'options', q.options,
          'correctIndex', q.correct_index,
          'position', q.position
        ) order by q.position)
        from public.questions q where q.exam_id = e.id
      ), '[]'::jsonb)
    ) order by e.updated_at desc), '[]'::jsonb)
    into v_exams
    from public.exams e;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'examId', r.exam_id,
      'examTitle', r.exam_title,
      'userId', r.user_id,
      'studentName', r.student_name,
      'className', r.class_name,
      'correctCount', r.correct_count,
      'totalQuestions', r.total_questions,
      'score', r.score,
      'passingScore', r.passing_score,
      'answers', r.answers,
      'focusLosses', r.focus_losses,
      'startedAt', r.started_at,
      'submittedAt', r.submitted_at,
      'timeExpired', r.time_expired
    ) order by r.submitted_at desc), '[]'::jsonb)
    into v_results
    from public.results r;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'title', e.title,
      'subject', e.subject,
      'className', e.class_name,
      'durationMinutes', e.duration_minutes,
      'passingScore', e.passing_score,
      'active', e.active,
      'randomizeQuestions', e.randomize_questions,
      'randomizeOptions', e.randomize_options,
      'allowRetake', e.allow_retake,
      'questionCount', (select count(*) from public.questions q where q.exam_id = e.id),
      'createdAt', e.created_at,
      'updatedAt', e.updated_at
    ) order by e.updated_at desc), '[]'::jsonb)
    into v_exams
    from public.exams e
    where e.active = true
      and (trim(e.class_name) = '' or lower(trim(e.class_name)) = lower(trim(v_user.class_name)));

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'examId', r.exam_id,
      'examTitle', r.exam_title,
      'userId', r.user_id,
      'studentName', r.student_name,
      'className', r.class_name,
      'correctCount', r.correct_count,
      'totalQuestions', r.total_questions,
      'score', r.score,
      'passingScore', r.passing_score,
      'focusLosses', r.focus_losses,
      'startedAt', r.started_at,
      'submittedAt', r.submitted_at,
      'timeExpired', r.time_expired
    ) order by r.submitted_at desc), '[]'::jsonb)
    into v_results
    from public.results r
    where r.user_id = v_user.id;
  end if;

  return jsonb_build_object(
    'user', jsonb_build_object(
      'id', v_user.id, 'username', v_user.username, 'name', v_user.name,
      'role', v_user.role, 'className', v_user.class_name
    ),
    'users', v_users,
    'exams', v_exams,
    'results', v_results
  );
end;
$$;

create or replace function public.app_save_exam(p_token uuid, p_exam jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_users;
  v_exam_id uuid;
  v_question jsonb;
  v_position integer := 0;
  v_options jsonb;
  v_correct integer;
begin
  select * into v_user from private.session_user(p_token);
  if v_user.id is null or v_user.role <> 'teacher' then raise exception 'Akses guru diperlukan.'; end if;

  if nullif(p_exam ->> 'id', '') is not null then
    begin v_exam_id := (p_exam ->> 'id')::uuid;
    exception when invalid_text_representation then v_exam_id := extensions.gen_random_uuid(); end;
  else
    v_exam_id := extensions.gen_random_uuid();
  end if;

  if exists (
    select 1 from public.attempts
    where exam_id = v_exam_id and status = 'in_progress'
  ) then
    raise exception 'Ujian sedang dikerjakan siswa. Tunggu hingga selesai sebelum mengubah soal.';
  end if;

  if trim(coalesce(p_exam ->> 'title', '')) = '' or trim(coalesce(p_exam ->> 'subject', '')) = '' then
    raise exception 'Judul dan mata pelajaran wajib diisi.';
  end if;
  if jsonb_typeof(p_exam -> 'questions') <> 'array' or jsonb_array_length(p_exam -> 'questions') < 1 then
    raise exception 'Ujian harus memiliki minimal satu soal.';
  end if;

  insert into public.exams (
    id, title, subject, class_name, duration_minutes, passing_score, active,
    randomize_questions, randomize_options, allow_retake, created_by, updated_at
  ) values (
    v_exam_id,
    trim(p_exam ->> 'title'), trim(p_exam ->> 'subject'), trim(coalesce(p_exam ->> 'className', '')),
    (p_exam ->> 'durationMinutes')::integer, (p_exam ->> 'passingScore')::integer,
    coalesce((p_exam ->> 'active')::boolean, true),
    coalesce((p_exam ->> 'randomizeQuestions')::boolean, true),
    coalesce((p_exam ->> 'randomizeOptions')::boolean, true),
    coalesce((p_exam ->> 'allowRetake')::boolean, false),
    v_user.id, now()
  )
  on conflict (id) do update set
    title = excluded.title,
    subject = excluded.subject,
    class_name = excluded.class_name,
    duration_minutes = excluded.duration_minutes,
    passing_score = excluded.passing_score,
    active = excluded.active,
    randomize_questions = excluded.randomize_questions,
    randomize_options = excluded.randomize_options,
    allow_retake = excluded.allow_retake,
    updated_at = now();

  delete from public.questions where exam_id = v_exam_id;

  for v_question in select value from jsonb_array_elements(p_exam -> 'questions') loop
    v_position := v_position + 1;
    v_options := v_question -> 'options';
    v_correct := (v_question ->> 'correctIndex')::integer;
    if trim(coalesce(v_question ->> 'text', '')) = ''
       or jsonb_typeof(v_options) <> 'array'
       or jsonb_array_length(v_options) < 2
       or v_correct < 0
       or v_correct >= jsonb_array_length(v_options) then
      raise exception 'Format soal nomor % tidak valid.', v_position;
    end if;
    insert into public.questions(exam_id, position, question_text, options, correct_index)
    values (v_exam_id, v_position, trim(v_question ->> 'text'), v_options, v_correct);
  end loop;

  return jsonb_build_object('id', v_exam_id, 'saved', true);
end;
$$;

create or replace function public.app_set_exam_active(p_token uuid, p_exam_id uuid, p_active boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user public.app_users;
begin
  select * into v_user from private.session_user(p_token);
  if v_user.id is null or v_user.role <> 'teacher' then raise exception 'Akses guru diperlukan.'; end if;
  update public.exams set active = p_active, updated_at = now() where id = p_exam_id;
  return true;
end;
$$;

create or replace function public.app_delete_exam(p_token uuid, p_exam_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user public.app_users;
begin
  select * into v_user from private.session_user(p_token);
  if v_user.id is null or v_user.role <> 'teacher' then raise exception 'Akses guru diperlukan.'; end if;
  if exists(select 1 from public.attempts where exam_id = p_exam_id and status = 'in_progress') then
    raise exception 'Ujian sedang dikerjakan siswa dan belum dapat dihapus.';
  end if;
  delete from public.exams where id = p_exam_id;
  return true;
end;
$$;

create or replace function public.app_save_student(p_token uuid, p_student jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_users;
  v_student_id uuid;
  v_username text;
  v_password text;
  v_saved public.app_users;
begin
  select * into v_user from private.session_user(p_token);
  if v_user.id is null or v_user.role <> 'teacher' then raise exception 'Akses guru diperlukan.'; end if;

  v_username := lower(trim(coalesce(p_student ->> 'username', '')));
  v_password := coalesce(p_student ->> 'password', '');
  if v_username = '' or trim(coalesce(p_student ->> 'name', '')) = '' then
    raise exception 'Nama dan username wajib diisi.';
  end if;

  if nullif(p_student ->> 'id', '') is not null then
    v_student_id := (p_student ->> 'id')::uuid;
    if exists(select 1 from public.app_users where lower(username) = v_username and id <> v_student_id) then
      raise exception 'Nama pengguna sudah dipakai.';
    end if;
    update public.app_users
    set username = v_username,
        name = trim(p_student ->> 'name'),
        class_name = trim(coalesce(p_student ->> 'className', '')),
        password_hash = case when length(v_password) >= 4 then extensions.crypt(v_password, extensions.gen_salt('bf')) else password_hash end,
        updated_at = now()
    where id = v_student_id and role = 'student'
    returning * into v_saved;
    if v_saved.id is null then raise exception 'Siswa tidak ditemukan.'; end if;
  else
    if length(v_password) < 4 then raise exception 'Kata sandi minimal 4 karakter.'; end if;
    if exists(select 1 from public.app_users where lower(username) = v_username) then
      raise exception 'Nama pengguna sudah dipakai.';
    end if;
    insert into public.app_users(username, password_hash, name, role, class_name)
    values (v_username, extensions.crypt(v_password, extensions.gen_salt('bf')), trim(p_student ->> 'name'), 'student', trim(coalesce(p_student ->> 'className', '')))
    returning * into v_saved;
  end if;

  return jsonb_build_object('id', v_saved.id, 'username', v_saved.username, 'name', v_saved.name, 'role', v_saved.role, 'className', v_saved.class_name);
end;
$$;

create or replace function public.app_delete_student(p_token uuid, p_student_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user public.app_users;
begin
  select * into v_user from private.session_user(p_token);
  if v_user.id is null or v_user.role <> 'teacher' then raise exception 'Akses guru diperlukan.'; end if;
  if exists(select 1 from public.attempts where user_id = p_student_id and status = 'in_progress') then
    raise exception 'Siswa sedang mengerjakan ujian dan belum dapat dihapus.';
  end if;
  delete from public.app_users where id = p_student_id and role = 'student';
  return true;
end;
$$;

create or replace function public.app_clear_results(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_user public.app_users;
begin
  select * into v_user from private.session_user(p_token);
  if v_user.id is null or v_user.role <> 'teacher' then raise exception 'Akses guru diperlukan.'; end if;
  delete from public.results;
  delete from public.attempts where status = 'submitted';
  return true;
end;
$$;

create or replace function public.app_start_attempt(p_token uuid, p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_users;
  v_exam public.exams;
  v_attempt public.attempts;
  v_runtime jsonb;
  v_answers jsonb;
  v_flagged jsonb;
begin
  select * into v_user from private.session_user(p_token);
  if v_user.id is null or v_user.role <> 'student' then raise exception 'Akses siswa diperlukan.'; end if;

  select * into v_exam from public.exams where id = p_exam_id and active = true;
  if v_exam.id is null then raise exception 'Ujian tidak tersedia.'; end if;
  if trim(v_exam.class_name) <> '' and lower(trim(v_exam.class_name)) <> lower(trim(v_user.class_name)) then
    raise exception 'Ujian ini bukan untuk kelas Anda.';
  end if;

  select * into v_attempt
  from public.attempts
  where user_id = v_user.id and exam_id = v_exam.id and status = 'in_progress'
  order by started_at desc limit 1;

  if v_attempt.id is not null and v_attempt.end_at <= now() then
    perform private.finalize_attempt(v_attempt.id, true);
    v_attempt.id := null;
  end if;

  if v_attempt.id is not null then
    return private.attempt_payload(v_attempt.id);
  end if;

  if not v_exam.allow_retake and exists(
    select 1 from public.results where user_id = v_user.id and exam_id = v_exam.id
  ) then
    raise exception 'Ujian ini sudah pernah dikerjakan dan tidak dapat diulang.';
  end if;

  select coalesce(jsonb_agg(item order by sort_key), '[]'::jsonb)
  into v_runtime
  from (
    select
      jsonb_build_object(
        'id', q.id,
        'text', q.question_text,
        'options', (
          select jsonb_agg(
            jsonb_build_object('text', opt.value, 'originalIndex', opt.ordinality - 1)
            order by case when v_exam.randomize_options then random() else opt.ordinality::double precision end
          )
          from jsonb_array_elements_text(q.options) with ordinality as opt(value, ordinality)
        )
      ) as item,
      case when v_exam.randomize_questions then random() else q.position::double precision end as sort_key
    from public.questions q
    where q.exam_id = v_exam.id
  ) randomized;

  if jsonb_array_length(v_runtime) < 1 then raise exception 'Ujian belum memiliki soal.'; end if;

  select jsonb_agg('null'::jsonb order by n), jsonb_agg('false'::jsonb order by n)
  into v_answers, v_flagged
  from generate_series(1, jsonb_array_length(v_runtime)) as n;

  insert into public.attempts(
    exam_id, user_id, runtime_questions, answers, flagged, current_index,
    focus_losses, started_at, end_at
  ) values (
    v_exam.id, v_user.id, v_runtime, v_answers, v_flagged, 0, 0,
    now(), now() + make_interval(mins => v_exam.duration_minutes)
  ) returning * into v_attempt;

  return private.attempt_payload(v_attempt.id);
end;
$$;

create or replace function public.app_save_attempt(
  p_token uuid,
  p_attempt_id uuid,
  p_answers jsonb,
  p_flagged jsonb,
  p_current_index integer,
  p_focus_losses integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_users;
  v_attempt public.attempts;
begin
  select * into v_user from private.session_user(p_token);
  if v_user.id is null or v_user.role <> 'student' then raise exception 'Akses siswa diperlukan.'; end if;

  select * into v_attempt from public.attempts
  where id = p_attempt_id and user_id = v_user.id and status = 'in_progress'
  for update;
  if v_attempt.id is null then raise exception 'Pengerjaan aktif tidak ditemukan.'; end if;

  update public.attempts
  set answers = p_answers,
      flagged = p_flagged,
      current_index = greatest(0, p_current_index),
      focus_losses = greatest(0, p_focus_losses)
  where id = v_attempt.id;

  if v_attempt.end_at <= now() then
    return jsonb_build_object('expired', true, 'result', private.finalize_attempt(v_attempt.id, true));
  end if;

  return jsonb_build_object('expired', false, 'saved', true);
end;
$$;

create or replace function public.app_submit_attempt(
  p_token uuid,
  p_attempt_id uuid,
  p_answers jsonb,
  p_flagged jsonb,
  p_current_index integer,
  p_focus_losses integer,
  p_time_expired boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_users;
  v_attempt public.attempts;
  v_expired boolean;
begin
  select * into v_user from private.session_user(p_token);
  if v_user.id is null or v_user.role <> 'student' then raise exception 'Akses siswa diperlukan.'; end if;

  select * into v_attempt from public.attempts
  where id = p_attempt_id and user_id = v_user.id
  for update;
  if v_attempt.id is null then raise exception 'Pengerjaan tidak ditemukan.'; end if;

  if v_attempt.status = 'submitted' then
    return private.finalize_attempt(v_attempt.id, v_attempt.time_expired);
  end if;

  update public.attempts
  set answers = p_answers,
      flagged = p_flagged,
      current_index = greatest(0, p_current_index),
      focus_losses = greatest(0, p_focus_losses)
  where id = v_attempt.id;

  v_expired := p_time_expired or v_attempt.end_at <= now();
  return private.finalize_attempt(v_attempt.id, v_expired);
end;
$$;

-- Hanya fungsi RPC berikut yang boleh dipanggil dengan publishable/anon key.
revoke all on function public.app_login(text, text) from public;
revoke all on function public.app_logout(uuid) from public;
revoke all on function public.app_bootstrap(uuid) from public;
revoke all on function public.app_save_exam(uuid, jsonb) from public;
revoke all on function public.app_set_exam_active(uuid, uuid, boolean) from public;
revoke all on function public.app_delete_exam(uuid, uuid) from public;
revoke all on function public.app_save_student(uuid, jsonb) from public;
revoke all on function public.app_delete_student(uuid, uuid) from public;
revoke all on function public.app_clear_results(uuid) from public;
revoke all on function public.app_start_attempt(uuid, uuid) from public;
revoke all on function public.app_save_attempt(uuid, uuid, jsonb, jsonb, integer, integer) from public;
revoke all on function public.app_submit_attempt(uuid, uuid, jsonb, jsonb, integer, integer, boolean) from public;

grant execute on function public.app_login(text, text) to anon, authenticated;
grant execute on function public.app_logout(uuid) to anon, authenticated;
grant execute on function public.app_bootstrap(uuid) to anon, authenticated;
grant execute on function public.app_save_exam(uuid, jsonb) to anon, authenticated;
grant execute on function public.app_set_exam_active(uuid, uuid, boolean) to anon, authenticated;
grant execute on function public.app_delete_exam(uuid, uuid) to anon, authenticated;
grant execute on function public.app_save_student(uuid, jsonb) to anon, authenticated;
grant execute on function public.app_delete_student(uuid, uuid) to anon, authenticated;
grant execute on function public.app_clear_results(uuid) to anon, authenticated;
grant execute on function public.app_start_attempt(uuid, uuid) to anon, authenticated;
grant execute on function public.app_save_attempt(uuid, uuid, jsonb, jsonb, integer, integer) to anon, authenticated;
grant execute on function public.app_submit_attempt(uuid, uuid, jsonb, jsonb, integer, integer, boolean) to anon, authenticated;

-- Akun demo. Ubah kata sandi setelah aplikasi berhasil dijalankan.
insert into public.app_users(username, password_hash, name, role, class_name)
select 'guru', extensions.crypt('guru123', extensions.gen_salt('bf')), 'Bapak/Ibu Guru', 'teacher', ''
where not exists (select 1 from public.app_users where lower(username) = 'guru');

insert into public.app_users(username, password_hash, name, role, class_name)
select 'siswa01', extensions.crypt('smp123', extensions.gen_salt('bf')), 'Andi Pratama', 'student', 'VIII A'
where not exists (select 1 from public.app_users where lower(username) = 'siswa01');

insert into public.app_users(username, password_hash, name, role, class_name)
select 'siswa02', extensions.crypt('smp123', extensions.gen_salt('bf')), 'Siti Rahma', 'student', 'VIII A'
where not exists (select 1 from public.app_users where lower(username) = 'siswa02');

-- Ujian contoh hanya dibuat saat database belum memiliki ujian.
do $$
declare
  v_exam_id uuid;
  v_teacher_id uuid;
begin
  if not exists (select 1 from public.exams) then
    select id into v_teacher_id from public.app_users where lower(username) = 'guru' limit 1;
    insert into public.exams(
      title, subject, class_name, duration_minutes, passing_score, active,
      randomize_questions, randomize_options, allow_retake, created_by
    ) values (
      'Latihan IPA Kelas VIII', 'Ilmu Pengetahuan Alam', 'VIII A', 15, 75, true,
      true, true, true, v_teacher_id
    ) returning id into v_exam_id;

    insert into public.questions(exam_id, position, question_text, options, correct_index) values
      (v_exam_id, 1, 'Organ utama pada sistem pernapasan manusia adalah …', '["Jantung","Paru-paru","Ginjal","Lambung"]', 1),
      (v_exam_id, 2, 'Perubahan wujud dari cair menjadi gas disebut …', '["Membeku","Mengembun","Menguap","Menyublim"]', 2),
      (v_exam_id, 3, 'Satuan SI untuk gaya adalah …', '["Joule","Watt","Pascal","Newton"]', 3),
      (v_exam_id, 4, 'Bagian tumbuhan yang paling banyak melakukan fotosintesis adalah …', '["Akar","Batang","Daun","Bunga"]', 2),
      (v_exam_id, 5, 'Planet yang paling dekat dengan Matahari adalah …', '["Venus","Merkurius","Bumi","Mars"]', 1),
      (v_exam_id, 6, 'Zat yang memiliki bentuk dan volume tetap termasuk zat …', '["Padat","Cair","Gas","Plasma"]', 0),
      (v_exam_id, 7, 'Alat untuk mengukur kuat arus listrik adalah …', '["Voltmeter","Amperemeter","Ohmmeter","Barometer"]', 1),
      (v_exam_id, 8, 'Hubungan makan dan dimakan dalam suatu ekosistem disebut …', '["Simbiosis","Adaptasi","Rantai makanan","Metamorfosis"]', 2),
      (v_exam_id, 9, 'Contoh sumber energi terbarukan adalah …', '["Batu bara","Minyak bumi","Gas alam","Matahari"]', 3),
      (v_exam_id, 10, 'Rumus kecepatan adalah …', '["jarak × waktu","jarak ÷ waktu","waktu ÷ jarak","massa ÷ volume"]', 1);
  end if;
end $$;
