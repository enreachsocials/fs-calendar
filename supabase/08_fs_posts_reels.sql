-- Future Schooling: 8 wpisów Post/Rolka (22.09–08.10.2026), godz. 11:00, do uzupełnienia (temat + materiały dodane później).
with ins as (
  insert into public.posts (client_id, kind, title, publish_date, publish_time, review_status, internal_status)
  select c.id, v.k, '(do uzupełnienia)', v.d::date, '11:00'::time, 'pending', 'draft'
  from public.clients c, (values
    ('post', '2026-09-22'),
    ('reel', '2026-09-24'),
    ('post', '2026-09-28'),
    ('reel', '2026-09-30'),
    ('post', '2026-10-01'),
    ('reel', '2026-10-05'),
    ('post', '2026-10-07'),
    ('post', '2026-10-08')
  ) as v(k, d)
  where c.name ilike 'Future%'
    and not exists (select 1 from public.posts p where p.client_id = c.id and p.kind = v.k and p.publish_date = v.d::date)
  returning 1
)
select count(*) as dodano from ins;
