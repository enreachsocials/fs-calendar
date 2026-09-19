-- Znacznik "do skończenia" (tylko dla administratora) z krótką notatką, czego brakuje
alter table public.posts add column if not exists to_finish boolean not null default false;
alter table public.posts add column if not exists to_finish_note text;
