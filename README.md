# Studio Riff

API de réservation des salles de répèt' de l'asso Studio Riff. TypeScript + Express,
Postgres pour les données, Valkey pour cacher le planning.

## Prérequis

- Node.js 20+
- Docker + Docker Compose

## Installation

```bash
npm install
cp .env.example .env
```

Le `.env.example` a aucun vrai secret, c'est le modèle. Les valeurs par défaut marchent.

## Lancer les bases

```bash
docker compose up -d --wait
```

Postgres sur `localhost:5432`, Valkey sur `localhost:6379` (localhost seulement). L'appli
tourne hors Docker et se connecte avec `DATABASE_URL` et `VALKEY_URL`.

## Préparer la base

```bash
npm run migrate   # schéma (tables, contraintes, index)
npm run seed      # données de départ
```

Le seed vide avant de réinsérer, donc relançable autant de fois qu'on veut.

## Lancer l'API

```bash
npm run dev       # reload auto
# ou
npm run start
```

API sur `http://localhost:3000` (port changeable avec `PORT`).

## Tests

Les bases doivent tourner. Chaque test repart des données de départ, horloge fixée au lundi
2 novembre 2026 9 h (sinon les règles au temps changeraient selon le jour).

```bash
npm test
```

## Routes

| Méthode | Route | Codes |
|---|---|---|
| GET | `/rooms` | 200 |
| GET | `/rooms/:id/bookings?from=…&to=…` | 200, 404 |
| POST | `/rooms/:id/bookings` | 201, 400, 404, 409 |
| GET | `/bookings/:id` | 200, 404 |
| DELETE | `/bookings/:id` | 204, 404, 409 |
| GET | `/members/:id/bookings` | 200, 404 |

Exemple création :

```bash
curl -X POST http://localhost:3000/rooms/room-1/bookings \
  -H "content-type: application/json" \
  -d '{"memberId":"member-3","start":"2026-11-04T14:00:00Z","end":"2026-11-04T16:00:00Z"}'
```

## Sauvegarde / restauration

```bash
./backup.sh            # backups/<db>-<horodatage>.dump
./restore.sh           # restaure le dernier dump dans studio_riff_restore
./restore.sh un.dump   # ou un dump précis
```

Le restore se fait dans une base à part et compare le nombre de lignes des 2 cotés.

## Rangement

Le code est dans `src/` (domaine, services, db, cache, http), les migrations dans
`migrations/`, les scripts migrate/seed dans `scripts/`, les tests dans `tests/`.

Choix de conception dans `DECISIONS.md`, mesures dans `REPORT.md`.
