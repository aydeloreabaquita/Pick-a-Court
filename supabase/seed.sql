insert into public.venues (name, slug, address)
values ('Downtown Mandaue', 'downtown-mandaue', 'Mandaue City, Cebu');

insert into public.courts (venue_id, name, sport, court_type, hourly_rate)
select id, 'Court 1', 'Pickleball', 'Indoor AC', 50000 from public.venues where slug = 'downtown-mandaue'
union all select id, 'Court 2', 'Pickleball', 'Indoor', 50000 from public.venues where slug = 'downtown-mandaue'
union all select id, 'Court 3', 'Pickleball', 'Covered', 45000 from public.venues where slug = 'downtown-mandaue'
union all select id, 'Court 4', 'Pickleball', 'Outdoor', 35000 from public.venues where slug = 'downtown-mandaue';
