-- 1) Oznaczenie "zaplanowane w Meta" (FB/IG) – ustawiane przez administratora, klient go nie widzi w aplikacji
alter table public.posts add column if not exists meta_scheduled boolean not null default false;

-- 2) Podpis autora komentarza (e-mail klienta albo "Agencja"), ustawiany automatycznie przy dodaniu komentarza
alter table public.comments add column if not exists author_label text;

create or replace function public.comments_set_label() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.author_role = 'admin' then
    new.author_label := 'Agencja';
  else
    select u.email into new.author_label from auth.users u where u.id = new.author_id;
  end if;
  return new;
end $$;

drop trigger if exists comments_label_trg on public.comments;
create trigger comments_label_trg before insert on public.comments
  for each row execute function public.comments_set_label();

-- uzupełnienie ewentualnych istniejących komentarzy
update public.comments c set author_label = case
  when c.author_role = 'admin' then 'Agencja'
  else (select u.email from auth.users u where u.id = c.author_id) end
where c.author_label is null;
