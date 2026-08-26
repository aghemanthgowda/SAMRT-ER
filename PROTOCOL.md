# SMART-ER hardware protocol

The contract between the SMART-ER server and the physical devices that will
replace the simulator in Phase 2.

Nothing in this document is implemented as firmware yet. It is written now
because the software was built against these interfaces, and the point of the
exercise is that adding real hardware should not require changing anything
above the abstraction layer.

---

## 1. Where the boundary is

```
  routing engine
  conflict engine
  corridor engine
  safety validator
────────────────────────────────  ← the boundary. Nothing above knows what is below.
  hardware abstraction layer        packages/core/src/hardware/interfaces.ts
────────────────────────────────
  Phase 1   simulated.ts            in-process, models latency and failure
  Phase 2   esp32.ts                MQTT / WebSocket to real controllers
```

The interfaces are defined once, in
[`packages/core/src/hardware/interfaces.ts`](packages/core/src/hardware/interfaces.ts):

| Interface | Responsibility |
| --- | --- |
| `GpsProvider` | Position fixes for a vehicle |
| `VehicleTelemetryProvider` | Full telemetry frames — position, emergency state, link quality |
| `JunctionController` | Drives the signal heads of one junction |
| `SignalController` | Registry of every junction controller; dispatches validated commands |
| `EmergencyButton` | Physical button in the cab |
| `HardwareStatusProvider` | Device inventory and health |
| `Watchdog` | Liveness tracking; a silent controller is not trusted |
| `HardwareBundle` | All of the above, assembled once at boot |

Phase 2 adds `createEsp32Hardware(...)` returning the same `HardwareBundle`
shape as `createSimulatedHardware(...)`. The only file that changes outside the
hardware directory is the one line in `apps/server/src/db/store.ts` that picks
which factory to call, driven by `HARDWARE_TRANSPORT`.

**A device may be swapped individually.** The bundle can mix implementations —
a single real ESP32 at J2 while every other junction stays simulated. That is
the intended way to bring hardware up: one junction at a time, on a live
system, with the rest of the network still running.

---

## 2. Transport

MQTT over TLS is the expected transport. WebSocket is supported as an
alternative where an MQTT broker is impractical.

```
  broker:   mqtts://<host>:8883
  auth:     per-device username and password, or client certificate
  QoS:      1 for commands and acknowledgements, 0 for heartbeats
  retain:   false on every topic — a retained green is a hazard
```

`retain` must be false everywhere. A retained signal command would be
re-delivered to a controller on reconnect, potentially setting a green for a
vehicle that passed twenty minutes earlier.

### Topics

| Topic | Direction | Payload |
| --- | --- | --- |
| `smarter/v1/junction/<junctionId>/command` | server → device | `SignalCommand` |
| `smarter/v1/junction/<junctionId>/ack` | device → server | `SignalAcknowledgement` |
| `smarter/v1/junction/<junctionId>/heartbeat` | device → server | `Heartbeat` |
| `smarter/v1/junction/<junctionId>/state` | device → server | `JunctionReport` |
| `smarter/v1/vehicle/<vehicleId>/telemetry` | device → server | `VehicleTelemetry` |
| `smarter/v1/vehicle/<vehicleId>/button` | device → server | `ButtonPress` |
| `smarter/v1/vehicle/<vehicleId>/notice` | server → device | `DriverNotice` |

The `v1` segment is deliberate. Firmware in the field cannot be updated as
easily as a server, so the topic namespace carries a version and the server
must be able to speak two versions at once during a rollout.

---

## 3. Message formats

All payloads are UTF-8 JSON. Field names match the TypeScript types in
[`packages/core/src/types/domain.ts`](packages/core/src/types/domain.ts) so the
same definitions serve both sides.

### 3.1 SignalCommand — server → junction

```jsonc
{
  "id": "CMD-K3A9012",           // echoed in the acknowledgement
  "junctionId": "J2",
  "deviceId": "HW-J2",
  "approachId": "J2-N",          // which movement to hold
  "aspect": "GREEN",             // GREEN | AMBER | RED | ALL_RED | FLASHING_RED
  "holdSeconds": 20,             // 0–180
  "corridorId": "COR-K3A9007",
  "vehicleId": "AMB-01",
  "issuedAt": "2026-08-26T10:32:10.412Z",
  "safetyApproved": true,        // MUST be true; see §4
  "safetyNotes": ["GREEN on J2-N at J2 is safe to issue."]
}
```

**The device must reject any command with `safetyApproved: false`.** The server
already refuses to dispatch one — `SignalController.dispatch` throws — but the
check is repeated in firmware because this is the last point before a real
signal head, and a defence that exists in only one place is not a defence.

### 3.2 SignalAcknowledgement — junction → server

```jsonc
{
  "commandId": "CMD-K3A9012",
  "junctionId": "J2",
  "deviceId": "HW-J2",
  "accepted": true,
  "appliedAspect": "GREEN",      // what the head is ACTUALLY showing
  "latencyMs": 41,
  "receivedAt": "2026-08-26T10:32:10.453Z",
  "error": null                  // string when accepted is false
}
```

`appliedAspect` is what the signal is displaying, not what was asked for. If a
lamp has failed, or a local interlock overrode the command, the acknowledgement
must report the truth. The server treats a disagreement between `aspect` and
`appliedAspect` as a fault and routes corridors around the junction.

Acknowledge within **250 ms**. Beyond that the corridor engine has already
moved on and the green is no longer useful.

### 3.3 Heartbeat — junction → server

Every **2 seconds**:

```jsonc
{
  "deviceId": "HW-J2",
  "firmwareVersion": "esp32-1.0.0",
  "uptimeSeconds": 86412,
  "signalStrength": -61,         // dBm
  "aspects": { "J2-N": "RED", "J2-E": "GREEN", "J2-S": "RED", "J2-W": "GREEN" },
  "faults": [],                  // e.g. ["LAMP_FAIL:J2-N:AMBER"]
  "at": "2026-08-26T10:32:12.000Z"
}
```

### 3.4 VehicleTelemetry — vehicle unit → server

Every **1 second** while the emergency system is engaged, every 10 seconds
otherwise:

```jsonc
{
  "vehicleId": "AMB-01",
  "gps": {
    "position": { "lat": 12.97463, "lng": 77.60946 },
    "heading": 271.4,
    "speedKph": 46.2,
    "accuracy": 4.5,             // metres
    "at": "2026-08-26T10:32:12.000Z",
    "valid": true                // false when the receiver has no lock
  },
  "emergencyActive": true,       // light bar / siren engaged
  "supplyVoltage": 13.8,
  "linkQuality": 88,             // 0–100
  "at": "2026-08-26T10:32:12.000Z"
}
```

`valid: false` is not the same as omitting the frame. It tells the server the
unit is alive but cannot fix its position, which is a different situation from
the unit being unreachable, and the corridor engine handles the two differently:
a lost fix freezes the vehicle at its last confirmed position rather than
dead-reckoning it through a junction.

### 3.5 ButtonPress — vehicle unit → server

```jsonc
{
  "vehicleId": "AMB-01",
  "deviceId": "HW-AMB-01",
  "at": "2026-08-26T10:31:58.000Z"
}
```

A press raises a request. It does **not** grant a corridor: the request still
goes to the controller, and the identity chain is still verified. A button on a
dashboard is not authorisation.

### 3.6 DriverNotice — server → vehicle unit

```jsonc
{
  "vehicleId": "AMB-01",
  "kind": "CORRIDOR_APPROVED",   // APPROVED | REROUTED | RELEASED | DECLINED
  "etaSeconds": 342,
  "nextJunctionId": "J2",
  "corridorState": "GREEN",
  "message": "Corridor approved to City General Hospital.",
  "at": "2026-08-26T10:32:11.000Z"
}
```

---

## 4. Safety requirements

These are requirements on the firmware, not on the server. The server enforces
its own copy of each; the firmware must not rely on that.

1. **Never display conflicting greens.** Each junction's approach conflict
   matrix is provisioned on the device. A `GREEN` for an approach whose
   conflicting movement is not already red must be refused, and the refusal
   acknowledged with `accepted: false`.

2. **Honour minimum green.** At least **4 seconds** of green before any change
   away from it. Reject an earlier change; the server retries.

3. **Amber before red.** At least **3 seconds**, always. Never green → red.

4. **All-red clearance.** At least the junction's configured
   `clearanceSeconds` (6–8 s in the seeded network) between conflicting
   movements.

5. **Watchdog.** An independent hardware watchdog, not a software timer. If the
   MCU stops servicing it, or if no command is received for **10 seconds** while
   a corridor green is being held, the junction reverts to its local programme.
   If it cannot, it fails to **flashing red** — an all-way stop.

6. **Bounded hold.** No aspect held longer than **180 seconds** under any
   circumstance, regardless of what the server asks for.

7. **Local programme is the default.** A junction with no active corridor runs
   its own signal plan. SMART-ER is an override, not a replacement, and a
   junction must be fully functional with the server switched off.

Requirement 7 is the important one. The system must degrade to "ordinary
traffic lights" and not to "dark junction".

---

## 5. Provisioning and identity

Each device is registered before it can participate:

```
  HardwareDevice {
    id:              "HW-J2"
    kind:            JUNCTION_CONTROLLER | VEHICLE_UNIT | EMERGENCY_BUTTON
    serial:          matches the firmware's compiled-in identity
    mode:            SIMULATED | ESP32
    boundEntityId:   "J2"          the junction or vehicle it drives
    firmwareVersion: "esp32-1.0.0"
  }
```

A device whose `serial` does not match its `boundEntityId`'s registration is
rejected. This is the hardware link of the identity chain a controller verifies
before approving a request:

```
  Driver → Vehicle → Organization → HardwareDevice
```

An unregistered telemetry unit fails verification, and the request is declined
with the reason shown to both the controller and the crew.

---

## 6. Reference hardware

The interfaces do not require this hardware; it is what the protocol was
designed against.

**Junction controller**
- ESP32-WROOM-32 or ESP32-S3
- Relay board driving the existing signal contactors, in parallel with the
  local controller rather than replacing it
- Opto-isolated feedback on each lamp circuit, so `appliedAspect` reports what
  is actually lit
- External watchdog IC (e.g. TPL5010) — not a software timer
- Wi-Fi or LTE, with the local programme continuing unchanged when offline

**Vehicle unit**
- ESP32 with a u-blox NEO-M8N or similar GNSS module
- 1 Hz position fix minimum
- Emergency button on a debounced input
- Powered from the vehicle's 12 V supply, with a supercapacitor or small
  battery so a frame reporting loss of power can still be sent

**Prototype ambulance**
- Any chassis with the vehicle unit aboard is enough to exercise the full
  pipeline end to end.

---

## 7. Bringing hardware up

The order matters, and each step is independently reversible:

1. **Register the device.** Add the `HardwareDevice` record. It appears in the
   controller's hardware panel as `ESP32` rather than `SIMULATED`.
2. **Heartbeat only.** Firmware connects and heartbeats; it accepts no
   commands. Confirm it appears online and the watchdog tracks it.
3. **Shadow mode.** The server sends commands; the device acknowledges them but
   does not drive the relays. Compare `appliedAspect` against what the simulator
   would have done.
4. **Live, one junction.** Enable relay output for a single junction. Every
   other junction stays simulated. The corridor engine does not know or care.
5. **Widen.** One junction at a time.

At every step the system remains fully operable, because the abstraction layer
means a mixed fleet is not a special case.

---

## 8. What Phase 2 must not change

If implementing the ESP32 layer requires editing any of these, the abstraction
has been broken and the change is wrong:

- `packages/core/src/routing/`
- `packages/core/src/conflict/`
- `packages/core/src/corridor/`
- `packages/core/src/safety/`
- `packages/core/src/impact/`
- `apps/server/src/services/`
- `apps/web/`

The only files Phase 2 should touch are a new
`packages/core/src/hardware/esp32.ts`, the factory selection in
`apps/server/src/db/store.ts`, and configuration.
