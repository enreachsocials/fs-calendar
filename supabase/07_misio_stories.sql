-- Misio Bazik: 13 wpisów Story (22.09–08.10.2026, dni robocze, 10:00, do akceptacji).
-- Tytuły = nazwy folderów z Dysku (GOTOWY CONTENT / STORIES WRZESIEŃ). Grafiki dodaje Weronika przez "Edytuj".
with ins as (
  insert into public.posts (client_id, kind, title, publish_date, publish_time, review_status, internal_status)
  select c.id, 'story', v.t, v.d::date, '10:00'::time, 'pending', 'draft'
  from public.clients c, (values
    ('Stories – Wycieczki', '2026-09-22'),
    ('Stories – Emocje malucha w żłobku', '2026-09-23'),
    ('Stories – Wizyta zapoznawcza', '2026-09-24'),
    ('Stories – Ruch to ważna część rozwoju', '2026-09-25'),
    ('Stories – Co wyróżnia dobry żłobek', '2026-09-28'),
    ('Stories – Jak wybrać żłobek', '2026-09-29'),
    ('Stories – Nie tylko lista zajęć', '2026-09-30'),
    ('Stories – Angielski', '2026-10-01'),
    ('Stories – Emocje', '2026-10-02'),
    ('Stories – Jakie zajęcia wspierają rozwój', '2026-10-05'),
    ('Stories – Opinie rodziców', '2026-10-06'),
    ('Stories – Nauka ukryta w zabawie', '2026-10-07'),
    ('Stories – Oswajanie ze żłobkiem', '2026-10-08')
  ) as v(t, d)
  where c.name ilike 'Misio%'
    and not exists (select 1 from public.posts p where p.client_id = c.id and p.kind = 'story' and p.title = v.t)
  returning 1
)
select count(*) as dodano from ins;
