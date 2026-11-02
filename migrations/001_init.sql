create extension if not exists btree_gist;

create table rooms (
  id text primary key,
  name text not null,
  capacity integer not null,
  maintenance_start timestamptz,
  maintenance_end timestamptz
);

create table members (
  id text primary key,
  name text not null
);

create table bookings (
  id text primary key,
  room_id text not null references rooms(id),
  member_id text not null references members(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled', 'late_cancelled')),
  check (end_at > start_at),
  constraint bookings_no_overlap exclude using gist (
    room_id with =,
    tstzrange(start_at, end_at) with &&
  ) where (status = 'confirmed')
);
