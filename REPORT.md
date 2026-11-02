# Rapport

## Mesure d'une requête et ajout d'un index

### Remplissage

La table de départ ne contient que 4 réservations, trop peu pour mesurer quoi que ce
soit. On la remplit à 100 000 lignes avec `generate_series`, puis `ANALYZE` pour mettre
à jour les statistiques du planificateur :

```sql
insert into bookings (id, room_id, member_id, start_at, end_at, status)
select
  'gen-' || g,
  'room-' || (g % 4 + 1),
  'member-' || (g % 3 + 1),
  timestamptz '2027-01-01 10:00+00' + (g / 52) * interval '1 day' + (g / 4 % 13) * interval '1 hour',
  timestamptz '2027-01-01 11:00+00' + (g / 52) * interval '1 day' + (g / 4 % 13) * interval '1 hour',
  'confirmed'
from generate_series(0, 99999) as g;
analyze bookings;
```

Chaque ligne est répartie sur les 4 salles, puis sur 13 créneaux d'une heure, puis sur
les jours suivants, donc les réservations générées ne se chevauchent pas et respectent
la contrainte d'exclusion.

### Requête mesurée

Le planning d'une salle sur une semaine, c'est-à-dire la requête de
`GET /rooms/:id/bookings` :

```sql
explain analyze
select * from bookings
where room_id = 'room-1' and status = 'confirmed'
  and end_at > timestamptz '2028-03-01 00:00+00'
  and start_at < timestamptz '2028-03-08 00:00+00'
order by start_at;
```

### Avant l'index

```
 Sort  (cost=3398.76..3409.63 rows=4347 width=51) (actual time=6.281..6.288 rows=91 loops=1)
   Sort Key: start_at
   Sort Method: quicksort  Memory: 32kB
   ->  Seq Scan on bookings  (cost=0.00..3136.08 rows=4347 width=51) (actual time=1.285..6.181 rows=91 loops=1)
         Filter: ((end_at > '2028-03-01 00:00:00+00'::timestamptz) AND (start_at < '2028-03-08 00:00:00+00'::timestamptz) AND (room_id = 'room-1'::text) AND (status = 'confirmed'::text))
         Rows Removed by Filter: 99913
 Planning Time: 0.317 ms
 Execution Time: 6.339 ms
```

PostgreSQL lit toute la table (`Seq Scan`) et jette 99 913 lignes pour n'en garder 91.

### L'index

```sql
create index bookings_room_start on bookings (room_id, start_at);
```

L'index porte sur `room_id` (égalité) puis `start_at` (comparaison), les deux colonnes
les plus sélectives du filtre.

### Après l'index

```
 Sort  (cost=1654.48..1665.33 rows=4340 width=51) (actual time=0.753..0.756 rows=91 loops=1)
   Sort Key: start_at
   Sort Method: quicksort  Memory: 32kB
   ->  Bitmap Heap Scan on bookings  (cost=145.09..1392.27 rows=4340 width=51) (actual time=0.734..0.745 rows=91 loops=1)
         Recheck Cond: ((room_id = 'room-1'::text) AND (start_at < '2028-03-08 00:00:00+00'::timestamptz))
         Filter: ((end_at > '2028-03-01 00:00:00+00'::timestamptz) AND (status = 'confirmed'::text))
         Rows Removed by Filter: 5526
         Heap Blocks: exact=255
         ->  Bitmap Index Scan on bookings_room_start  (cost=0.00..144.01 rows=5559 width=0) (actual time=0.248..0.248 rows=5617 loops=1)
               Index Cond: ((room_id = 'room-1'::text) AND (start_at < '2028-03-08 00:00:00+00'::timestamptz))
 Planning Time: 0.145 ms
 Execution Time: 0.773 ms
```

### Lecture

Le `Seq Scan` est remplacé par un `Bitmap Index Scan` sur `bookings_room_start` : au
lieu de parcourir 100 000 lignes, la base n'en touche que celles de `room-1`, et n'en
écarte plus que 5 526 au moment du recheck (sur `end_at` et `status`). Le temps
d'exécution passe de **6.3 ms à 0.77 ms**. Les deux temps restent de l'ordre de la
milliseconde sur ce jeu de données ; ce qui compte est le changement de plan et le
nombre de lignes lues, qui augmenteront moins vite avec l'index quand la table grossira.
