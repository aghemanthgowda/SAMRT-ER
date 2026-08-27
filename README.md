# SMART-ER

Emergency traffic corridor management. SMART-ER gives an ambulance, fire
appliance or police unit a rolling green corridor through a city's signalised
junctions — holding only the junction being crossed and the one immediately
ahead, resolving contention when two emergencies need the same junction, and
handing every junction straight back to public traffic the moment the vehicle
has passed.

**Phase 1 (this repository) is complete and runs entirely in software.** No
physical hardware is required: vehicles, GPS, junction controllers and traffic
signals are all simulated behind the same interfaces real hardware will
implement. Google Maps is the map. Phase 2 replaces the simulator with ESP32
devices without changing anything above the hardware abstraction layer.

---

## Quick start

Requires **Node 22.5 or newer** — storage uses the built-in `node:sqlite`.

```bash
git clone https://github.com/aghemanthgowda/SAMRT-ER.git
cd SAMRT-ER
npm install
cp .env.example .env      # optional — the system runs without a Maps key
npm run dev
```

Open <http://localhost:5173> and sign in.

### Accounts

Operator accounts live in the database, not in the interface. The sign-in
screen shows no account list, no password and no role picker — the API has no
endpoint that would supply them, and the authenticated role comes from the
user record rather than from anything the browser asserts.

On first boot the server seeds one account per role. Their addresses are:

| Role | Account | What it is |
| --- | --- | --- |
| Controller | `controller@smart-er.example` | The operations console |
| Driver | `ravi.kumar@abc-ems.example` | AMB-01's handset |
| Driver | `anand.shetty@bfes.example` | FIRE-01's handset |
| Hospital | `ops@citygeneral.example` | City General emergency desk |
| Fire | `watch@bfes.example` | Central Fire Station watch room |
| Police | `control@bcp.example` | Police HQ control room |

Every seeded account is given the value of `SEED_PASSWORD`, bcrypt-hashed
before it is stored. Set it in `.env` before you start:

```bash
SEED_PASSWORD=pick-your-own-long-one
```

Unset, it falls back to a development default so a fresh clone still runs. It
has to satisfy the same policy as a chosen password — at least 12 characters —
and outside production a value that does not is reported and replaced with the
default rather than producing accounts nobody can change the password of.

Seeding happens once, into an empty database. After that the stored accounts
are authoritative: changing `SEED_PASSWORD` does nothing, because re-seeding
over a live database would discard every password anyone had since chosen.

Forgotten a password? **Forgot password?** on the sign-in screen issues a
single-use link that expires in 30 minutes. In Phase 1 the link is written to
the server log — see [Password recovery](#password-recovery).

The driver screens are mobile-first — open them on a phone, or in a narrow
browser window.

---

## The five-minute demonstration

1. Sign in as the **controller**. The dashboard opens on live network state.
2. Go to **Settings** in the sidebar and find **Simulation**.
3. Start **"Crossing movements, shared junction"**.

What to watch, in order:

- **AMB-01 is verified** — driver, operator licence and telemetry unit all
  confirmed before anything is granted. The timeline records each check.
- **A route is calculated** and the reasoning is shown in full. Open the route
  in the detail panel: the rejected alternatives are listed with the ETA
  difference that decided against them, including any that were *shorter*.
- **City General is notified** the instant the request is approved. Sign in as
  the hospital in another window and the inbound ambulance is already there.
- **The corridor rolls.** Watch the junction network strip: exactly one
  junction green, one preparing ahead of it, everything behind released. Never
  the whole route.
- **POL-02 crosses AMB-01's route at right angles.** The conflict monitor shows
  the contention detected at the shared junction, and what SMART-ER did about
  it — in prose, with the numbers. Only the one contended junction is
  time-slotted; the rest of both corridors run untouched.
- **Public traffic impact** stays at one or two junctions out of fourteen
  throughout. That figure is the argument for the rolling window.

Contrast it with **"Ambulance + fire, opposing movements"**, where two units
share every junction on MG Road and none of them is a conflict: opposing
movements run on the same signal phase, so both are held green together. The
engine flags only contention it would actually have to resolve.

Other scenarios worth running: **Road closure mid-run** (automatic reroute with
the reason recorded), **GPS loss mid-corridor** (the corridor holds the last
confirmed position rather than guessing), **Junction controller unreachable**
(the vehicle is routed around a green that cannot be confirmed), and
**Unauthorised driver** (sign-on refused, with the failed links named).

Run the simulation at 4× to see a complete run in about ninety seconds.

---

## Google Maps

Google Maps is the map provider. The application uses the **Maps JavaScript
API** with the current **Routes library** (`google.maps.routes`), which
provides `Route.computeRoutes` and `RouteMatrix.computeRouteMatrix` with
traffic-aware travel times and alternative routes.

To enable it:

1. Create a key in the [Google Cloud console](https://console.cloud.google.com/google/maps-apis/credentials).
2. Enable **Maps JavaScript API** and **Routes API** on the project.
3. Restrict the key to your origins.
4. Put it in `.env`:

```bash
GOOGLE_MAPS_API_KEY=your-key
VITE_GOOGLE_MAPS_API_KEY=your-key
VITE_GOOGLE_MAPS_VERSION=beta      # the Routes library ships on the beta channel
```

The Routes library is published on the `beta` channel. On `weekly` the
application falls back to `DirectionsService` and `DistanceMatrixService`,
which still give real road geometry and traffic-aware ETAs. The detail panel
always states which provider answered, so an ETA is never attributed to a
source it did not come from.

**A key that Google rejects is reported as a failure, not as success.** An
invalid key, an origin missing from the allow-list, disabled billing or an
un-enabled API all produce a 200 from Google and a grey map, so the loader
watches for Google's `gm_authFailure` callback and reports the provider as
offline in **System status** and **Settings** rather than showing "Connected"
over an empty panel. A load that never answers times out after fifteen seconds
instead of leaving the console on a spinner.

**Without a key the application still boots and runs completely.** It renders a
clearly labelled schematic **demo map** instead. Every capability — routing,
conflict resolution, the rolling corridor, the simulation — works identically;
only real geography is missing.

### What Google supplies, and what SMART-ER decides

Google Maps provides the road network, geometry, traffic-aware travel times,
alternative routes and distances. That is the geographic layer.

SMART-ER decides everything else, because Google has no idea which signals this
system controls or who else is running:

- emergency priority between contending vehicles
- which junctions a route reserves, and in what order
- shared-junction conflict detection and resolution
- the rolling corridor window and junction scheduling
- signal safety validation
- public traffic impact

When a route is planned, the browser asks Google for the real road polyline and
traffic-aware ETA and posts them back to the server, so simulated vehicles
follow actual roads. The junction sequencing is untouched: a corridor is a
reservation over SMART-ER's own junction network.

---

## Storage

Operational state is held in SQLite at `data/smart-er.db`, created on first
boot. Nothing to install and nothing to provision — `node:sqlite` is built into
Node — so the property that made the original in-memory store attractive
survives the system gaining a database. Node prints an experimental-feature
warning for it on startup; that is Node being accurate about its own API, not a
fault in the application.

What persists: accounts and password hashes, vehicles, drivers, facilities,
incidents, requests, routes, corridors, conflicts, the timeline, and the
response-improvement history. A restart picks up where the last run left off.

Two things are deliberately *not* restored:

- **Corridors that were still active.** A corridor is a claim on signals that
  are physically held. The process holding them is gone and this boot has a
  fresh hardware bundle with every junction back under normal control, so a
  stored active corridor describes a state that exists nowhere. The record is
  kept — it is the run history — but it is closed and its junctions released.
- **Device health.** The stored rows describe hardware that answered during the
  last run. This boot does not know what is reachable until it is told.

`data/` is git-ignored: the file contains password hashes and must never be
committed. Set `DATABASE_PATH=` (empty) to run entirely in memory instead;
tests always do.

---

## Password recovery

**Forgot password?** on the sign-in screen issues a recovery link. The token is
32 random bytes, stored only as a SHA-256 hash, single-use, and expires in 30
minutes; requesting a second link retires the first. It is never returned
through the API that created it, and the request is answered identically
whether or not the address has an account — an endpoint that says "no such
account" is an account-enumeration oracle that needs no credentials.

Delivery is a port, `PasswordResetDelivery`, for the same reason the hardware
is: Phase 1 has no mail relay, and the flow around it should not have to change
when one arrives. The Phase 1 adapter writes the link to the **server log**,
which is right for an operator at the machine and wrong everywhere else — so in
production it records that a reset was requested and withholds the link. Ship a
real deployment with an adapter that emails or texts it.

Signed-in operators can change their own password under **Settings → Password**.
The current password is required even though the form is behind a session: a
console left unlocked should not be enough to take an account away from the
person who owns it. Passwords must be at least 12 characters and may not
contain the account's address or the name of the system.

---

## How it works

```
  driver handset ─────┐
  fire / police  ─────┼──▶ dispatch ──▶ routing ──▶ conflict ──▶ corridor
  controller     ─────┘                                              │
                                                                     ▼
                                                            SAFETY VALIDATOR
                                                                     │
                                                                     ▼
                                                    hardware abstraction layer
                                                                     │
                                              Phase 1 ───────────────┴─────────── Phase 2
                                              simulated junctions          ESP32 controllers
```

**Routing optimises minimum response time, never shortest distance.** A 6.0 km
route arriving in 6:45 beats a 5.2 km route arriving in 8:10, and the
comparison panel shows exactly that trade-off whenever it occurs.

**Conflict resolution prefers rerouting to blocking.** When two vehicles need
the same junction inside one clearance window, SMART-ER first looks for a
conflict-free alternative for the lower-priority unit. Only if no alternative
improves on waiting does it time-slot the single contended junction — and only
if that delay is unacceptable does it hold anything. Blocking a fire appliance
until an ambulance finishes is the worst outcome for total response time, so it
is the last resort rather than the first.

**The corridor rolls.** Junctions ahead prepare, the one being crossed is
green, those behind are released immediately. Holding a whole route green would
stop a district for the duration of a run.

**The safety validator is the last gate.** No signal command reaches hardware
without passing it: no conflicting greens, minimum green enforced, amber before
red, all-red clearance respected, and no two emergency vehicles holding one
junction. It fails closed — an unknown junction or approach is a rejection.

Fuller detail in [ARCHITECTURE.md](ARCHITECTURE.md). The Phase 2 hardware
contract is in [PROTOCOL.md](PROTOCOL.md).

---

## Repository layout

```
packages/core/          domain model and decision engines — no I/O, no framework
  types/                entities, enums, realtime event contract
  geo/                  geometry, polyline encoding, projection
  graph/                junction network
  routing/              ETA-optimal k-shortest paths, cost model
  priority/             severity-dominant priority scoring
  conflict/             contention detection and resolution
  corridor/             the rolling green corridor
  safety/               signal safety validator
  impact/               public traffic delay model
  hardware/             the Phase 1 / Phase 2 boundary

apps/server/            Express + Socket.IO
  db/                   junction network, seed data, repositories, SQLite
  auth/                 authentication, passwords, the vehicle identity chain
  services/             dispatch, routing, corridor runtime, analytics,
                        notifications
  simulation/           tick loop and demonstration scenarios
  realtime/             event bus and socket gateway
  routes/               REST API

apps/web/               React + Vite
  maps/                 Google Maps loader, Routes service, overlay, demo map
  components/shell/     sidebar, page header, controller layout
  components/dashboard/ stat cards, active emergencies, queue, alerts,
                        system status, response chart
  components/panels/    operational panels shared across consoles
  components/settings/  change password
  hooks/                dashboard data fetching
  pages/controller/     dashboard, map, requests, vehicles, junctions,
                        incidents, alerts, reports, settings
  pages/auth/           forgot password, reset password
  pages/                driver, hospital, fire, police
  stores/               auth and realtime operational state
```

---

## Commands

```bash
npm run dev          # server on :4000 and web on :5173
npm run dev:server   # server only
npm run dev:web      # web only

npm test             # 250 tests across all three packages
npm run typecheck
npm run lint
npm run build        # production build of all packages
npm run verify       # typecheck + lint + test + build

npm start            # run the built server
```

---

## Environment

Every variable is documented in [`.env.example`](.env.example). The system runs
with none of them set.

| Variable | Purpose |
| --- | --- |
| `GOOGLE_MAPS_API_KEY` | Maps Platform key |
| `VITE_GOOGLE_MAPS_API_KEY` | The same key, as the browser reads it |
| `VITE_GOOGLE_MAPS_VERSION` | Maps JS channel; `beta` for the Routes library |
| `VITE_GOOGLE_MAPS_MAP_ID` | Optional cloud-styled Map ID |
| `PORT`, `HOST` | Server bind address |
| `JWT_SECRET` | Token signing secret — **required in production** |
| `SEED_PASSWORD` | Password given to seeded accounts, bcrypt-hashed on write |
| `CORS_ORIGIN` | Allowed browser origins |
| `APP_BASE_URL` | Where the browser reaches the app; password-reset links point here |
| `DATABASE_PATH` | SQLite file; empty string runs in memory |
| `SIM_TICK_MS`, `SIM_SPEED` | Simulation cadence |
| `VITE_API_BASE_URL` | API base URL as seen from the browser |

No key is ever hard-coded. `.env` is git-ignored; only `.env.example` is
committed. In production the server refuses to start without a real
`JWT_SECRET` rather than falling back to a constant.

Passwords are stored as bcrypt hashes and nothing else. No API response
contains a password, a hash, or a list of accounts, and the browser is never
given a secret of any kind.

---

## Testing

250 tests, run with `npm test`.

- **72 core tests** — routing (including that a longer, faster route wins),
  the rolling corridor (including that it never holds the whole route),
  conflict detection and each resolution strategy — including that opposing
  movements through one junction are *not* a conflict — the safety validator's
  refusals, the public impact model, geometry, and simulated hardware
  including its failure modes.
- **104 server tests** — the nineteen scenarios from the specification driven
  end to end through the real services, plus authentication, authorization,
  the REST surface, and that no endpoint will enumerate accounts or return a
  password. Password recovery is covered end to end: single use, expiry,
  supersession, policy, and that the endpoint answers identically for a known
  and an unknown address. Durability is tested by opening a store against a
  real file, closing it, and opening a second one over the same file.
- **74 web tests** — route comparison, conflict monitor, request queue, the
  demo map, the status colour contract, the realtime store, the recovery
  screens, and the Maps loader — including that a key Google rejects is
  reported as a failed provider rather than a healthy one.

---

## Status

Phase 1 is complete: the software runs the full emergency lifecycle on
simulated vehicles, GPS, junctions and signals, with Google Maps as the map.

Phase 2 — ESP32 controllers, real GPS, physical emergency buttons, traffic
light output and a prototype ambulance — has not been started. The interfaces
it will implement are defined and documented in [PROTOCOL.md](PROTOCOL.md).

## Licence

MIT.
