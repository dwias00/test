-- PERINGATAN: Menghapus seluruh data CBT pada project Supabase ini.
-- Gunakan hanya bila database versi demo belum dipakai dan Anda ingin mulai bersih.

begin;

drop function if exists public.app_submit_attempt(uuid, uuid, jsonb, jsonb, integer, integer, boolean) cascade;
drop function if exists public.app_save_attempt(uuid, uuid, jsonb, jsonb, integer, integer) cascade;
drop function if exists public.app_start_attempt(uuid, uuid) cascade;
drop function if exists public.app_clear_results(uuid) cascade;
drop function if exists public.app_change_password(uuid, text, text) cascade;
drop function if exists public.app_save_settings(uuid, jsonb) cascade;
drop function if exists public.app_bulk_save_students(uuid, jsonb) cascade;
drop function if exists public.app_delete_student(uuid, uuid) cascade;
drop function if exists public.app_save_student(uuid, jsonb) cascade;
drop function if exists public.app_delete_exam(uuid, uuid) cascade;
drop function if exists public.app_set_exam_active(uuid, uuid, boolean) cascade;
drop function if exists public.app_save_exam(uuid, jsonb) cascade;
drop function if exists public.app_bootstrap(uuid) cascade;
drop function if exists public.app_logout(uuid) cascade;
drop function if exists public.app_login(text, text) cascade;
drop function if exists public.app_initial_setup(text, text, text, text, text, text, text) cascade;
drop function if exists public.app_public_info() cascade;

drop table if exists public.results cascade;
drop table if exists public.attempts cascade;
drop table if exists public.questions cascade;
drop table if exists public.exams cascade;
drop table if exists public.app_sessions cascade;
drop table if exists public.app_users cascade;
drop table if exists public.app_settings cascade;

drop schema if exists private cascade;

commit;

-- Setelah ini selesai, jalankan seluruh isi database.sql.
