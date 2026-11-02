# Décisions de conception

## Les couches

```
        HTTP (Express)
          routes, lecture du corps, validation de forme,
          traduction en codes de statut
                |
        Services
          orchestration, transactions, verrous,
          reçoivent l'horloge en paramètre
            /         \
     Domaine          Repositories
     (pur)            (SQL via pg)
     règles métier    accès PostgreSQL
     aucune I/O
                |
     Infra : pool pg, client redis, config
```

Les dépendances vont du haut vers le bas. Le domaine ne dépend de rien (pas de base,
pas d'Express, pas d'horloge système). Les services appellent le domaine pour décider
et les repositories pour lire/écrire. Les handlers HTTP restent fins : ils lisent la
requête, appellent un service et choisissent le code de statut.

L'horloge n'est jamais lue dans le domaine. Une valeur `now: Date` est calculée à
l'entrée (handler HTTP en vrai, horloge fixe dans les tests) et descend en paramètre.

## Où vit chaque règle

| Règle métier | Où | Pourquoi |
|---|---|---|
| Durée de 1 h à 4 h, début à l'heure pleine, entre 10 h et 23 h | Domaine (validation pure) + `CHECK (end_at > start_at)` en base | C'est la forme du créneau, ça ne dépend ni de l'état de la base ni de l'heure |
| Deux réservations d'une même salle ne se chevauchent jamais, même en concurrence | PostgreSQL : contrainte d'exclusion GiST sur `room_id` + `tstzrange(start_at, end_at)`, bornes `[)` | Seule la base tient l'invariant quand deux requêtes arrivent en même temps. Les bornes demi-ouvertes laissent un créneau commencer à l'heure exacte où le précédent finit. Le service fait en plus une vérification de courtoisie pour renvoyer un 409 lisible |
| Un membre a au plus 2 réservations à venir | Service, dans une transaction, avec `SELECT ... FOR UPDATE` sur la ligne du membre | Invariant d'agrégat sur plusieurs lignes, filtré par l'horloge (« à venir ») : pas exprimable par une contrainte de ligne. Voir ADR 2 |
| Annulation → `cancelled`, ou `late_cancelled` si moins de 24 h avant le début ; pas deux fois | Domaine (choix du statut depuis `now`) + repository pour l'`UPDATE` | « moins de 24 h » dépend de l'horloge injectée ; « pas deux fois » = on n'annule que depuis `confirmed` |
| Une salle en maintenance refuse toute réservation qui empiète sur la période | Domaine (comparaison de deux plages) | Règle pure entre la plage demandée et la fenêtre de maintenance de la salle |

La limite de 2 réservations est la seule règle qui regarde plusieurs lignes à la fois
et qui bouge avec l'heure. Elle ne peut pas descendre dans une contrainte `CHECK`
(qui ne voit qu'une ligne) ni dans la contrainte d'exclusion (qui ne compte pas). Elle
reste donc dans le service, sous verrou, pour rester correcte en concurrence.

## Codes de statut (POST /rooms/:id/bookings)

- Corps mal formé ou créneau qui ne respecte pas la forme (durée, heure pleine,
  plage 10 h–23 h, `end` avant `start`) → **400**
- Salle ou membre inexistant → **404**
- Chevauchement, limite de 2 réservations atteinte, salle en maintenance → **409**

Pour `DELETE /bookings/:id` : 204 si l'annulation passe, 404 si la réservation
n'existe pas, 409 si elle est déjà annulée.

## Modèle relationnel

```
rooms
  id               text  PK
  name             text  not null
  capacity         integer not null
  maintenance_start timestamptz  null
  maintenance_end   timestamptz  null

members
  id    text  PK
  name  text  not null

bookings
  id         text  PK
  room_id    text  not null -> rooms(id)
  member_id  text  not null -> members(id)
  start_at   timestamptz  not null
  end_at     timestamptz  not null
  status     text  not null  default 'confirmed'
             check status in ('confirmed','cancelled','late_cancelled')
  check (end_at > start_at)
  exclude using gist (room_id with =, tstzrange(start_at, end_at) with &&)
         where (status = 'confirmed')
```

La fenêtre de maintenance est portée par deux colonnes nullables sur `rooms` (plutôt
qu'une table séparée) : il y a au plus une période par salle dans l'énoncé. La
contrainte d'exclusion ne filtre que les réservations `confirmed`, donc une annulation
libère tout de suite le créneau pour une nouvelle réservation.

## ADR 1 — Driver `pg` et SQL écrit à la main, pas d'ORM

**Contexte.** Il faut accéder à PostgreSQL depuis TypeScript. Le point délicat du sujet
est une contrainte d'exclusion GiST avec `tstzrange` et l'extension `btree_gist`, qui
ne fait partie d'aucun modèle d'ORM courant.

**Décision.** On utilise le driver `pg` et on écrit le SQL. La migration est un fichier
`.sql` appliqué par un petit script.

**Pourquoi pas un ORM.** Un ORM (Prisma, TypeORM) apporterait des entités et des
migrations générées, mais la contrainte d'exclusion devrait quand même être écrite à la
main dans une migration brute, et l'ORM masquerait le SQL qu'on cherche justement à
mesurer plus tard (`EXPLAIN ANALYZE`, index). Le gain serait faible pour une surcouche
en plus. On refuse donc l'ORM ici.

**Conséquences.** Plus de SQL à écrire et à relire, mais un contrôle total du schéma et
des requêtes. Les requêtes sont paramétrées pour éviter les injections.

## ADR 2 — La limite « 2 réservations à venir » vit dans le service, pas en base

**Contexte.** Un membre ne peut pas avoir plus de 2 réservations à venir. « À venir »
se calcule par rapport à l'instant courant, et la règle compte plusieurs lignes.

**Décision.** La règle est vérifiée dans le service, dans la même transaction que
l'insertion. On verrouille d'abord la ligne du membre (`SELECT ... FOR UPDATE`), on
compte ses réservations `confirmed` dont `start_at > now`, et on refuse si on atteint
déjà 2.

**Pourquoi pas un trigger ou une contrainte.** Une contrainte `CHECK` ne voit qu'une
ligne, elle ne peut pas compter. Un trigger pourrait compter, mais il devrait lire
l'heure en base (`now()`), alors qu'on veut une horloge injectée et testable avec une
valeur fixe. Mettre la règle dans le service garde l'heure à un seul endroit et rend la
règle testable sans la base.

**Conséquences.** Deux requêtes simultanées pour le même membre se sérialisent grâce au
verrou de ligne, donc on ne peut pas dépasser 2 par une course. Le verrou est pris par
membre, il ne bloque pas les réservations des autres membres.
