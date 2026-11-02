# Rapport

## La requête et l'index

Avec 4 lignes y'a rien à mesurer, Postgres lit tout de toute façon. J'ai rempli la table à
100 000 lignes avec `generate_series` :

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

Chaque ligne tombe sur une salle, un créneau d'une heure, puis le jour d'après, donc ça se
chevauche pas et ça passe l'exclusion. Le `analyze` remet les stats à jour sinon le plan est
faux.

Requête mesurée = le planning d'une salle sur une semaine (`GET /rooms/:id/bookings`) :

```sql
explain analyze
select * from bookings
where room_id = 'room-1' and status = 'confirmed'
  and end_at > timestamptz '2028-03-01 00:00+00'
  and start_at < timestamptz '2028-03-08 00:00+00'
order by start_at;
```

**Avant l'index :**

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

`Seq Scan` : lit 100 000 lignes, en jette 99 913 pour en garder 91.

Index ajouté :

```sql
create index bookings_room_start on bookings (room_id, start_at);
```

**Après :**

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

Maintenant `Bitmap Index Scan`, la base touche que les lignes de `room-1`, plus que 5 526
jetées. **6.3 ms -> 0.77 ms.** Les 2 temps reste petits sur 100k lignes, mais le point c'est
le plan : sans index ça grimpe avec la table, avec l'index non. L'index est dans la migration
`002_index_bookings.sql`.

## Le cache Valkey

Le planning d'une salle c'est la ressource la plus lue, donc je le met en cache. Une clé par
salle `planning:<roomId>` = sa liste de résas `confirmed`, TTL 300 s. Le filtre `from`/`to`
est appliqué après sur la liste, du coup une seule clé par salle suffit.

Le TTL c'est juste un filet, je compte pas dessus. À chaque création/annulation le handler
fait `del planning:<roomId>`, donc la lecture d'après repart de Postgres. Une résa ou une
annulation se voit tout de suite.

Si Valkey tombe, l'API continue : client sans file hors-ligne, chaque appel cache dans un
`try/catch` qui fait rien si erreur. Du coup `get` renvoie `null`, on lit Postgres. Testé en
arretant le conteneur : `GET` reste 200, `POST` reste 201.

Ce qui reste dans Postgres = les réservations. Valkey a qu'une copie jetable. Je mettrais pas
les résas que dans Valkey :

- le non-chevauchement tient sur l'exclusion GiST, qui existe pas en clé-valeur ;
- Valkey est en mémoire, il peut tout perdre au redémarrage, une résa doit durer ;
- transactions et requêtes par salle/membre/période = boulot d'une base relationnelle.

Donc Valkey = cache de lecture, la référence c'est Postgres.

## Sauvegarde et restauration

`backup.sh` = `pg_dump -Fc` dans le conteneur, fichier daté dans `backups/`. `restore.sh`
crée une base `studio_riff_restore` à coté, restaure dedans, et compare le nombre de lignes.
Donc on restaure dans une base séparée, jamais par dessus l'originale.

```
rooms : origine=4 restaurée=4
members : origine=3 restaurée=3
bookings : origine=4 restaurée=4
```

### RPO, RTO, rétention

Studio Riff = une asso, 4 salles, peu d'écritures, rien de financier. Pas les besoins d'une
banque.

- **RPO 24 h** : une sauvegarde par nuit suffit. Au pire on perd une journée de résas, les
  membres refont. De la réplication pour gagner quelques minutes = exagéré ici.
- **RTO 4 h** : la restauration prend quelques secondes, les 4 h c'est la marge pour qu'un
  bénévole s'en occupe. En attendant on note sur un carnet comme avant.
- **Rétention 30 jours** : un dump fait quelques Ko, garder un mois coûte rien et permet de
  revenir en arrière si une bêtise est vue plusieurs jours après.
