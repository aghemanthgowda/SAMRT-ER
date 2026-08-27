# SMART-ER architecture

Why the system is shaped the way it is. [README.md](README.md) covers running
it; [PROTOCOL.md](PROTOCOL.md) covers the Phase 2 hardware contract.

---

## The central idea

Google Maps knows the roads. It does not know which traffic signals this system
can hold, how urgent a call is, or that another ambulance is about to need the
same junction. Those are the questions SMART-ER exists to answer, so the
division of labour is:

| Google Maps | SMART-ER |
| --- | --- |
| road network and geography | emergency priority |
| route geometry | junction reservation and scheduling |
| traffic-aware travel times | shared-junction conflict detection |
| alternative routes | conflict resolution strategy |
| distances and ETAs | the rolling green corridor |
| the traffic layer | signal safety validation |
| | public traffic impact |

Everything in the right-hand column runs over SMART-ER's own junction graph,
because a corridor is a reservation over *those* nodes. Google geometry is
adopted for drawing and for ETA; it never decides which junctions are held.

---

## Layers

```
┌──────────────────────────────────────────────────────────────────┐
│ apps/web            controller · driver · hospital · fire · police│
│                     Google Maps + SMART-ER overlay                │
└───────────────────────────────┬──────────────────────────────────┘
                                │ REST + Socket.IO
┌───────────────────────────────▼──────────────────────────────────┐
│ apps/server         dispatch · routing · corridor runtime         │
│                     simulation · notifications · timeline         │
└───────────────────────────────┬──────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────┐
│ packages/core       routing · priority · conflict · corridor      │
│                     safety · impact · road graph · geometry       │
├──────────────────────────────────────────────────────────────────┤
│                     HARDWARE ABSTRACTION LAYER                    │
├───────────────────────────┬──────────────────────────────────────┤
│ Phase 1  simulated        │ Phase 2  ESP32                        │
└───────────────────────────┴──────────────────────────────────────┘
```

`packages/core` has no I/O, no framework, and no knowledge of Express, React or
Socket.IO. Every engine is a pure function of its inputs, which is why the
scenario tests can drive a complete emergency without opening a port.

---

## The decision pipeline

Every corridor follows the same path, in this order:

```
  request  →  verification  →  routing  →  conflict  →  corridor
                                                            │
                                                            ▼
                                                   SAFETY VALIDATOR
                                                            │
                                                            ▼
                                                   signal command
                                                            │
                                                            ▼
                                              junction (simulated / ESP32)
```

Nothing downstream re-checks the safety validator's decisions, and in Phase 2
the thing downstream is a traffic light on a live road. So the validator fails
closed: an unknown junction, an unregistered approach, or an unreachable
controller is a rejection, not a warning.

---

## Routing

`GraphRouteProvider` runs Yen's k-shortest-paths over Dijkstra, with edge
weights in **traffic-aware travel time** rather than distance. Distance never
appears in the objective; it only shows up through travel time.

The composite cost is expressed entirely in ETA-equivalent seconds, so the
trade-offs are legible:

```
  cost = eta
       + 45 s  per junction already reserved by a higher-priority corridor
       + 0.06  per unit of public impact score
       + 2.5 s per junction on the route          (corridor setup cost)
       + 25 s  per soft-avoided junction
```

Expressing every penalty in seconds means a controller can read a rejection as
"this route costs 45 seconds more because it fights AMB-01 at J2" rather than
as an opaque score.

Crossing a junction without a corridor costs time — 8 s in normal traffic, 32 s
in heavy. That penalty is exactly what a corridor buys back, and it is why the
engine will accept a longer route with fewer junctions.

### Google enrichment

When a route is created the browser calls `Route.computeRoutes` (or
`DirectionsService` on the weekly channel) and posts the resulting polyline and
traffic-aware ETA back to `POST /api/routes/:id/geometry`. The server adopts
the geometry and the ETA; `junctionIds` and `segments` are left untouched.

The simulation then drives vehicles along that polyline, so a simulated
ambulance follows real roads.

---

## Priority

Conflicts are settled on a numeric score rather than on vehicle type, because
"fire always beats ambulance" is wrong as often as it is right.

```
  score = severity weight          CRITICAL 100 · HIGH 70 · MEDIUM 45 · LOW 20
        + vehicle premium          fire 14 · ambulance 12 · police 8
        + ageing                   +1 per 10 s waiting, capped at 25
        + proximity                up to +8 for a vehicle about to arrive
        + incumbency               +5 for an already-active corridor
```

Ageing prevents starvation: a queued medium-severity call eventually outranks a
stream of newer high-severity ones. Proximity is worth having because finishing
a nearly-complete run frees the network sooner than holding it behind a slower
unit. Incumbency stops the system thrashing a corridor it has just armed.

---

## Conflict detection and resolution

A conflict is **not** "two routes share a junction". Two ambulances thirty
minutes apart share junctions all day, and two units crossing the same junction
head-on need the same signal phase, so serving both at once costs nothing. Two
conditions have to hold together.

**First, the movements must be physically incompatible.** Each allocation
records the approach the vehicle enters on. `approachConflictMatrix()` derives,
per junction, which approaches can be green simultaneously: opposing movements
share a phase, crossing movements do not. Allocations on compatible approaches
are dismissed before any arithmetic — the pair is not contention, it is one
green serving two vehicles.

**Second, the arrivals must overlap** inside one clearance window:

```
  headway = (arrival₂ − arrival₁) − occupancy₁ − clearance
```

Negative headway is a conflict, and its magnitude is exactly the shortfall to
be absorbed. Occupancy is the same `greenLead + occupancy` figure the corridor
runtime actually holds a junction for, so prediction and runtime agree; when
they disagree, contention arrives at the signal head undetected and the
junction has to refuse it.

Resolution, in strict order of preference:

1. **Reroute** the lower-priority vehicle onto a conflict-free alternative,
   if that alternative is faster, or slower by less than the time it would
   otherwise spend waiting.
2. **Time-slot** the single contended junction. Both vehicles keep their
   routes; only that junction is coordinated, and the deferred allocation's
   window is shifted so the corridor engine will not claim it early.
3. **Priority hold** — the lower-priority vehicle waits. Only when no
   alternative helps and the delay exceeds what time-slotting can absorb, and
   always flagged for controller attention.

The order matters. Blocking a fire appliance until an ambulance has finished is
the worst possible outcome for *total* response time, which is why it is last.

Every outcome carries a prose explanation naming the junction, both units, the
alternatives considered and the seconds saved or lost. It is rendered verbatim
in the conflict monitor, because "the system rerouted the fire appliance" is
not something a controller can defend afterwards.

Detection does not only run at approval. Routes drift: traffic changes, a
vehicle is delayed, a reroute moves an arrival. The simulation re-sweeps every
active route pair every five seconds and resolves anything new, keyed so an
already-handled contention is not re-reported on each pass. A conflict that
did not exist when both corridors were granted is still a conflict when it
appears.

---

## The rolling green corridor

The engine's defining property is what it refuses to do. Holding twelve
junctions for one ambulance would stop a district for the length of the run.
Instead a short window travels with the vehicle:

```
  behind      RELEASED    handed straight back to public traffic
  at          GREEN       the one junction actually being crossed
  just ahead  PREPARING   clearing its queue so it is empty on arrival
  beyond      NORMAL      untouched, running its own programme
```

Tuning:

| Parameter | Value | Why |
| --- | --- | --- |
| `prepareLeadSeconds` | 35 | Long enough to clear a standing queue |
| `greenLeadSeconds` | 12 | The green itself should be as brief as possible |
| `occupancySeconds` | 8 | How long the vehicle occupies the junction |
| `maxPreparingJunctions` | 1 | The window never widens |
| `releaseDistanceM` | 35 | Metres past a junction before it is released |

PREPARING and GREEN both mean "give the emergency approach green"; the
difference is lead time, not aspect. A green that appears one second before an
ambulance reaches a full junction achieves nothing.

Two details worth knowing:

- **Junction distances are projected onto the route polyline**, not taken from
  the graph. Those two lengths differ whenever Google geometry is in use, and
  measuring progress in one space against junction positions in another is how
  a corridor releases a junction the vehicle has not reached yet.
- **A released junction never re-enters the corridor.** A stale or reflected
  GPS fix that puts the vehicle back at the start must not re-reserve junctions
  that have just been handed back.

---

## Safety validation

Checks, in order, on every command:

1. The junction addressed is the junction being commanded.
2. The approach is registered at that junction.
3. The controller is reachable — an unconfirmable green is never assumed.
4. No conflicting approach is still green or amber within its clearance.
5. No other emergency vehicle holds an overlapping window at that junction.
6. Minimum green (4 s) has elapsed before any change away from green, and
   amber (3 s) precedes red.
7. The hold is within 0–180 s.

A rejection is recorded on the incident timeline and the transition is queued
for re-assertion on the next tick, rather than dropped. Dropping it would leave
a junction showing green while the corridor believed it released — cross
traffic stopped with nothing coming. Retries are bounded and abandonment is
logged.

---

## Public traffic impact

Standard uniform-arrival delay: with arrivals at a constant rate over a red of
length *r*, the average wait of a stopped vehicle is *r/2* and the number
stopped is *(arrival rate × r)*. Only cross-street traffic is counted — the
emergency vehicle's own approach is being served, not stopped.

The panel exists to make the cost of a corridor visible. Two junctions held out
of fourteen is a very different intervention from fourteen, and without the
number the difference is invisible — which is precisely the pressure that would
otherwise push the system toward over-reserving.

---

## The shared clock

Signal safety is expressed in seconds: minimum green, amber, all-red clearance.
The simulation can run at 4× for a demonstration, and the test harness runs it
as fast as the CPU allows.

If signal timing read `Date.now()` while vehicles moved on simulated time, a
junction would appear to have been green for zero seconds no matter how far the
ambulance had travelled, and the validator would refuse every aspect change.
That is not hypothetical — it is what happened, and it is why
`packages/core/src/util/clock.ts` exists.

One `SimulationClock` is owned by the store, advanced by the simulation each
tick, and read by everything that stamps or compares a time: signal changes,
corridor windows, timeline entries, the watchdog. Movement and timing stay on
one timebase at any speed.

---

## Identity and authentication

Two chains, deliberately separate.

**Operators** authenticate with an email address and a password. Passwords are
stored as bcrypt hashes; the plaintext exists only for as long as it takes to
compare it. The token that comes back carries the user's id and role, and the
role is read from the user record on every request — the browser can ask for
any screen it likes, but authorisation is decided server-side against the
stored role, never against a claim the client makes.

Nothing in the API will enumerate accounts. There is no endpoint that lists
users, returns a password or a hash, or reveals which addresses exist; a failed
sign-in gives the same answer whether the address is unknown or the password is
wrong. The sign-in screen therefore cannot display accounts or hints, because
there is nothing for it to display. A test asserts each of those endpoints
stays absent.

**Vehicles** authenticate through the identity chain:

```
  driver → licence → vehicle → organization → telemetry unit
```

Every link is checked before a corridor is granted, and a break in any of them
is a refusal that names the link that failed. A signed-on driver is not
sufficient: the driver has to be authorised for *that* vehicle, the vehicle's
organization has to be active, and the vehicle's telemetry unit has to be
reporting. This is what makes an unauthorised sign-on a routing decision rather
than a login error.

---

## Realtime

One Socket.IO channel carries all operational state. Clients authenticate with
the same token as the REST API, receive a full `state.snapshot` on connect,
then apply deltas. Nothing in the product polls or refreshes.

Rooms scope what each role sees: signal commands, acknowledgements and hardware
health go only to control-room accounts. A hospital receives vehicle and
corridor updates because it is tracking an inbound unit, but signal traffic
would be noise on the wire.

On the client, entities are held in maps keyed by id. Updates arrive one entity
at a time, and rebuilding an array on every vehicle tick would re-render every
row in the console. Derived views are exposed as hooks wrapped in `useShallow`
for the same reason — a selector returning a fresh array on every store
notification re-renders continuously and can drive React into an update loop.

---

## Derived figures

The dashboard shows totals, counts and a response-improvement trend. None of
them is a constant in the interface. Every figure the operator reads is
computed from live state at the moment it is rendered — active emergencies from
the route table, junctions online from controller health, units linked from the
identity chain — and the interface's job is only to display it.

`services/analytics.ts` owns the two figures that need history rather than a
snapshot. Each completed run reports its baseline ETA (what the trip would have
taken without a corridor) and its actual duration; the difference is that run's
improvement, and the service keeps a day-bucketed series alongside a seeded
fortnight so the trend has a shape on a freshly-started system.

A day with no completed runs is a gap, not a zero. The chart breaks the line
across it and marks the axis tick hollow, because drawing 0% would read as
"the system saved nothing that day" rather than "nothing ran".

`systemStatus()` derives its rows the same way, and reports the map provider as
unknown rather than healthy when the browser has no API key — a component that
cannot be reached is not a component that is working.

---

## Persistence

Phase 1 uses in-memory repositories behind the interfaces in
`apps/server/src/db/repositories.ts`. Everything the application does goes
through `Repositories`, so moving to Postgres or SQLite is a new implementation
of that file plus different wiring in `store.ts` — no service changes.

The choice is deliberate: the point of Phase 1 is a system that starts with
`npm run dev` and demonstrates end to end, and a database to provision would
work against that. The timeline and notification repositories are ring buffers
with retention caps, since both are written on every state transition.

---

## The hardware boundary

`packages/core/src/hardware/interfaces.ts` is the single seam between
decision-making and the physical world. Everything above it is written against
those interfaces and has no idea whether it is talking to a simulator or an
ESP32 on a pole.

The Phase 1 implementations are not perfect stubs. A stub that always succeeds
instantly teaches the system nothing about how it behaves when a junction is
slow to acknowledge or a receiver loses lock, so the simulator models
acknowledgement latency, command rejection, watchdog expiry and GPS dropout —
and each of those has a corresponding behaviour above the line and a test that
exercises it.

Vehicles and junction controllers each carry a `Provisioning` value —
`PHYSICAL` or `SIMULATED` — so the distinction is a property of the record
rather than of the deployment. Phase 1 seeds one physically-provisioned unit
alongside simulated ones precisely so the interface has to render the
difference before any hardware exists; the dashboard badges it on the unit, and
system status counts the two populations separately.

Phase 2 adds `createEsp32Hardware(...)` returning the same `HardwareBundle`.
The bundle can mix implementations, so hardware comes up one junction at a time
on a live system, and a `PHYSICAL` record is what tells the operator which
junctions those are. See [PROTOCOL.md](PROTOCOL.md) for the wire format, the
firmware safety requirements and the bring-up sequence.
