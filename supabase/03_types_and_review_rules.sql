-- Zasady typów publikacji i terminu próśb o zmiany
-- 1) godzina końca (nagrywki, wydarzenia)
alter table public.posts add column if not exists end_time time;

-- 2) zatwierdzanie / prośba o zmiany:
--    - tylko dla post / story / reel / video (nagrywki i wydarzenia to sama informacja)
--    - prośbę o zmiany klient może dodać najpóźniej 24 h przed publikacją (czas: Europe/Warsaw)
create or replace function public.set_review(p_post uuid, p_status text, p_comment text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.posts%rowtype;
begin
  if p_status not in ('approved','changes') then raise exception 'bad status'; end if;
  select * into v from public.posts where id = p_post;
  if not found or not public.can_see_post(p_post) then raise exception 'forbidden'; end if;
  if v.kind not in ('post','story','reel','video') then raise exception 'not reviewable'; end if;
  if p_status = 'changes' and coalesce(btrim(p_comment), '') = '' then raise exception 'comment required'; end if;
  if p_status = 'changes' and not public.is_admin()
     and ((v.publish_date + coalesce(v.publish_time, time '00:00'))::timestamp at time zone 'Europe/Warsaw') - now() < interval '24 hours' then
    raise exception 'too late';
  end if;
  update public.posts set review_status = p_status where id = p_post;
  insert into public.review_log (post_id, client_id, user_id, from_status, to_status)
    values (p_post, v.client_id, auth.uid(), v.review_status, p_status);
  if coalesce(btrim(p_comment), '') <> '' then
    insert into public.comments (post_id, client_id, author_id, author_role, body)
    values (p_post, v.client_id, auth.uid(), case when public.is_admin() then 'admin' else 'client' end, btrim(p_comment));
  end if;
end $$;
