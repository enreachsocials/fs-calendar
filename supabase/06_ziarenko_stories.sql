-- Ziarenko Wielkości: 14 wpisów Story (22.09–09.10.2026, dni robocze, 10:00, do akceptacji).
-- Grafiki dodaje Weronika ręcznie przez "Edytuj". Skrypt pomija wpisy, które już istnieją.
with ins as (
  insert into public.posts (client_id, kind, title, publish_date, publish_time, review_status, internal_status)
  select c.id, 'story', v.t, v.d::date, '10:00'::time, 'pending', 'draft'
  from public.clients c, (values
    ('Story 1 – Spokój i kontakt z naturą',                                   '2026-09-22'),
    ('Story z posta 1 – Twoje dziecko nie potrzebuje więcej zabawek',         '2026-09-23'),
    ('Story 2 – Bezpieczeństwo i łagodna adaptacja',                          '2026-09-24'),
    ('Story z posta 2 – Niech Krzysiu tłucze te talerze',                     '2026-09-25'),
    ('Story 3 – Pisanie przed czytaniem',                                     '2026-09-28'),
    ('Story z posta 3 – Dziecko nie musi być grzeczne',                       '2026-09-29'),
    ('Story 4 – Kontrola błędu i nauka z szacunkiem',                         '2026-09-30'),
    ('Story z posta 5 – Nie pomagaj dziecku, jeśli potrafi zrobić to samo',   '2026-10-01'),
    ('Story 5 – Jakie zabawki wspierają rozwój',                              '2026-10-02'),
    ('Story z posta 6 – Brudne spodnie to bardzo dobry znak',                 '2026-10-05'),
    ('Story 6 – Być po prostu dzieckiem',                                     '2026-10-06'),
    ('Story z posta 7 – Czasem najlepsza reakcja na błąd jest brak reakcji',  '2026-10-07'),
    ('Story z posta 8 – Dzieci najpierw uczą się pisać',                      '2026-10-08'),
    ('Story z posta 9 – Współczesne rodzicielstwo i potencjał dzieci',        '2026-10-09')
  ) as v(t, d)
  where c.name ilike 'Ziarenko%'
    and not exists (select 1 from public.posts p where p.client_id = c.id and p.kind = 'story' and p.title = v.t)
  returning 1
)
select count(*) as dodano from ins;
