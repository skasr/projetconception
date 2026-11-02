# Décisions de conception

## Les couches

```
HTTP (Express)   -> routes, validation de forme, codes de statut
Services         -> transactions, verrous, reçoit l'horloge
Domaine          -> règles métier, pur, aucune I/O
Repositories     -> SQL via pg
```

Les dépendances vont vers le bas. Le domaine dépend de rien (ni base, ni Express, ni
heure), donc testable tout seul. Les services font le lien. Les handlers HTTP sont bêtes :
lire la requête, appeler un service, renvoyer le code.

Important : l'heure est jamais lue dans le domaine. On passe un `now: Date` depuis l'entrée
(vrai `new Date()` dans le serveur, date fixe dans les tests). Sinon les règles au temps
seraient pas testables.

## Où vit chaque règle

| Règle | Où | Pourquoi |
|---|---|---|
| Durée 1–4 h, heure pleine, 10 h–23 h | Domaine + `CHECK (end_at > start_at)` | Juste la forme du créneau, dépend pas de la base ni de l'heure |
| Pas de chevauchement, même en concurrence | Postgres : exclusion GiST (`room_id` + `tstzrange`), bornes `[)` | Y'a que la base qui tient ça quand 2 requêtes arrivent en même temps. Bornes `[)` = un créneau peut commencer pile à la fin du précédent. Le service vérifie avant aussi, pour un 409 plus clair |
| Max 2 résas à venir par membre | Service, transaction + `SELECT ... FOR UPDATE` sur le membre | Compte plusieurs lignes et dépend de l'heure, pas faisable en contrainte de ligne. Voir ADR 2 |
| Annulation → `cancelled` / `late_cancelled` (<24 h), pas 2 fois | Domaine (statut selon `now`) + repo pour l'`UPDATE` | Le <24 h dépend de l'horloge ; on annule que depuis `confirmed` |
| Maintenance : refus si chevauchement | Domaine (compare 2 plages) | Règle pure entre le créneau demandé et la fenêtre de maintenance |

La limite des 2 c'est la seule un peu chiante : elle regarde plusieurs lignes et dépend de
l'heure. Pas possible en `CHECK` (voit 1 ligne) ni dans l'exclusion (compte pas). Donc dans
le service, sous verrou.

## Codes de statut (POST /rooms/:id/bookings)

- 400 : corps mal formé, ou créneau hors règles de forme
- 404 : salle ou membre inconnu
- 409 : chevauchement, limite de 2 atteinte, maintenance

`DELETE /bookings/:id` : 204 ok, 404 inconnue, 409 déjà annulée.

## Modèle relationnel

```
rooms(id PK, name, capacity, maintenance_start null, maintenance_end null)
members(id PK, name)
bookings(id PK, room_id -> rooms, member_id -> members,
         start_at, end_at, status default 'confirmed',
         check status in ('confirmed','cancelled','late_cancelled'),
         check (end_at > start_at),
         exclude gist (room_id =, tstzrange(start_at,end_at) &&) where status='confirmed')
```

Maintenance = 2 colonnes nullables sur `rooms`, pas une table à part (au plus 1 période par
salle dans l'énoncé). L'exclusion filtre que les `confirmed`, donc une annulation libère le
créneau direct.

## ADR 1 — driver `pg` et SQL à la main, pas d'ORM

Le point relou du sujet c'est l'exclusion GiST avec `tstzrange` + `btree_gist`, qui rentre
dans aucun ORM. Donc driver `pg` et SQL écrit à la main, migration en fichier `.sql`.

Un ORM (Prisma, TypeORM) ferait les entités et les migrations, mais l'exclusion faudrait
quand même l'écrire en SQL brut, et l'ORM cacherait les requêtes que justement je veux
regarder avec `EXPLAIN ANALYZE`. Pas assez de gain pour une couche en plus, donc non.

Conséquence : plus de SQL à écrire, mais contrôle total. Tout est paramétré (pas
d'injection).

## ADR 2 — la limite « 2 à venir » dans le service, pas en base

« À venir » se calcule par rapport à maintenant, et la règle compte plusieurs lignes. Je la
mets dans le service, dans la transaction de l'insert : verrou sur le membre
(`SELECT ... FOR UPDATE`), je compte ses résas `confirmed` avec `start_at > now`, refus s'il
en a déjà 2.

Pourquoi pas en base : un `CHECK` sait pas compter, et un trigger devrait lire `now()` en
base alors que je veux une horloge injectée et testable. Du coup l'heure reste à un seul
endroit.

Conséquence : avec le verrou, 2 requêtes en même temps pour le même membre se mettent à la
queue, pas moyen de passer à 3. Et ça bloque pas les autres membres.
