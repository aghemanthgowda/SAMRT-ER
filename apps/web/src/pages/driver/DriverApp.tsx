import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  Clock,
  LogOut,
  MapPin,
  Navigation,
  Radio,
  RefreshCw,
  SatelliteDish,
  ShieldAlert,
  Siren,
} from 'lucide-react';
import type { Facility, Severity as SeverityType, VehicleVerification } from '@smart-er/core';
import {
  DestinationKind,
  RequestStatus,
  Severity,
  VehicleStatus,
  formatDistance,
  formatEta,
} from '@smart-er/core';
import { ApiError, api } from '@/api/client';
import { getSocket } from '@/api/socket';
import { Button } from '@/components/ui/primitives';
import { useRealtime } from '@/hooks/useRealtime';
import { SEVERITY_STYLE } from '@/lib/status';
import { useAuthStore } from '@/stores/authStore';
import { useOpsStore } from '@/stores/opsStore';

/**
 * The driver handset.
 *
 * Mobile-first and deliberately spare. The person using this is driving, or
 * about to be, often one-handed, sometimes at night. So: one decision per
 * screen, targets big enough to hit without looking, no scrolling to reach the
 * primary action, and the three facts that matter — ETA, next junction,
 * corridor state — always visible without interaction.
 *
 * Everything that could be a setting is instead decided by the system: the
 * vehicle is identified from the account, GPS is automatic, the route is the
 * controller's. The driver's only inputs are where they are going, how urgent
 * it is, and when they have arrived.
 */

type Screen = 'verify' | 'home' | 'destination' | 'severity' | 'pending' | 'active' | 'arrived';

export function DriverApp() {
  useRealtime();

  const user = useAuthStore((state) => state.user);
  const driver = useAuthStore((state) => state.driver);
  const authVehicles = useAuthStore((state) => state.vehicles);
  const logout = useAuthStore((state) => state.logout);

  const vehiclesMap = useOpsStore((state) => state.vehicles);
  const requestsMap = useOpsStore((state) => state.requests);
  const routesMap = useOpsStore((state) => state.routes);
  const corridorsMap = useOpsStore((state) => state.corridors);
  const junctions = useOpsStore((state) => state.junctions);
  const connection = useOpsStore((state) => state.connection);

  const [vehicleId, setVehicleId] = useState<string | undefined>(authVehicles[0]?.id);
  const [verification, setVerification] = useState<VehicleVerification | undefined>();
  const [verifying, setVerifying] = useState(false);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [destination, setDestination] = useState<Facility | undefined>();
  const [severity, setSeverity] = useState<SeverityType>(Severity.CRITICAL);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const state = vehicleId ? vehiclesMap[vehicleId] : undefined;
  const request = state?.activeRequestId ? requestsMap[state.activeRequestId] : undefined;
  const route = state?.activeRouteId ? routesMap[state.activeRouteId] : undefined;
  const corridor = state?.corridorId ? corridorsMap[state.corridorId] : undefined;

  // Verify the vehicle as soon as one is selected — the driver should never
  // reach the request screen only to be told the unit is not cleared.
  useEffect(() => {
    if (!vehicleId || !driver) return;
    setVerifying(true);
    void api
      .verifyVehicle(vehicleId, driver.id)
      .then(setVerification)
      .catch(() => setVerification(undefined))
      .finally(() => setVerifying(false));
  }, [vehicleId, driver]);

  useEffect(() => {
    void api
      .facilities()
      .then((all) => setFacilities(all.filter((facility) => facility.kind === DestinationKind.HOSPITAL)))
      .catch(() => undefined);
  }, []);

  // Offer the handset's own GPS. The simulator drives the vehicle until a real
  // fix arrives, at which point the server hands control to the handset.
  useEffect(() => {
    if (!state || state.status === VehicleStatus.OFFLINE) return;
    if (!('geolocation' in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        getSocket()?.emit('driver.position', {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          heading: position.coords.heading ?? undefined,
          speedKph: position.coords.speed !== null ? position.coords.speed * 3.6 : undefined,
          accuracy: position.coords.accuracy,
        });
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 12000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [state?.vehicleId, state?.status, state]);

  /**
   * The screen the vehicle's own state demands.
   *
   * Server state wins over local navigation: if the controller approves while
   * the crew is still on the destination picker, the handset moves to the live
   * route immediately. A driver must never be looking at a stale screen.
   */
  const requiredScreen: Screen | undefined = useMemo(() => {
    if (!verification?.verified) return 'verify';
    if (!state || state.status === VehicleStatus.OFFLINE) return 'verify';
    if (state.status === VehicleStatus.ARRIVED || state.status === VehicleStatus.COMPLETED) return 'arrived';
    if (state.status === VehicleStatus.ACTIVE || state.status === VehicleStatus.REROUTING) return 'active';
    if (request?.status === RequestStatus.PENDING) return 'pending';
    // Standby: the crew is free to move through the request flow themselves.
    return undefined;
  }, [verification, state, request]);

  // Local navigation, used only while the vehicle is on standby.
  const [manualScreen, setManualScreen] = useState<Screen | undefined>();
  const activeScreen: Screen = requiredScreen ?? manualScreen ?? 'home';

  // Drop stale local navigation the moment the server takes over.
  useEffect(() => {
    if (requiredScreen) setManualScreen(undefined);
  }, [requiredScreen]);

  const guard = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof ApiError ? actionError.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const signOn = () =>
    guard(async () => {
      if (!vehicleId) return;
      await api.signOn(vehicleId);
      setManualScreen(undefined);
    });

  const submit = () =>
    guard(async () => {
      if (!vehicleId || !destination) return;
      await api.submitRequest({
        vehicleId,
        severity,
        destinationFacilityId: destination.id,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setManualScreen(undefined);
    });

  const cancel = () =>
    guard(async () => {
      if (!vehicleId) return;
      await api.cancelRequest(vehicleId, 'Cancelled by the crew.');
      setDestination(undefined);
      setNote('');
      setManualScreen(undefined);
    });

  // Returning to standby has to change server state, not just this screen —
  // otherwise the unit stays COMPLETED and the crew can never take another call.
  const returnToStandby = () =>
    guard(async () => {
      if (!vehicleId) return;
      await api.returnToStandby(vehicleId);
      setDestination(undefined);
      setNote('');
      setManualScreen(undefined);
    });

  const junctionCode = (id?: string) =>
    id ? (junctions.find((junction) => junction.id === id)?.code ?? id) : '—';

  const corridorState = corridor?.activeJunctionId
    ? { label: 'Green', tone: 'text-ok-600' }
    : corridor?.preparingJunctionIds.length
      ? { label: 'Preparing', tone: 'text-warn-600' }
      : corridor
        ? { label: 'Armed', tone: 'text-ink-600' }
        : { label: 'None', tone: 'text-ink-9000' };

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      {/* Header — compact, always shows link state */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-brand-600">
            <Radio className="size-3.5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="tnum truncate font-mono text-sm font-semibold leading-tight text-ink-900">
              {vehicleId ?? 'SMART-ER'}
            </p>
            <p className="truncate text-[10px] leading-tight text-ink-500">{driver?.name ?? user?.displayName}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`size-2 rounded-full ${connection === 'live' ? 'bg-ok-500' : 'bg-critical-500'}`}
            title={connection === 'live' ? 'Connected' : 'Connection lost'}
          />
          <button
            type="button"
            onClick={logout}
            aria-label="Sign out"
            className="flex size-9 items-center justify-center rounded-lg border border-line bg-surface-muted text-ink-600"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col p-3">
        {error && (
          <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-critical-200 bg-critical-50 px-3 py-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-critical-600" />
            <p className="text-xs text-critical-600">{error}</p>
          </div>
        )}

        {activeScreen === 'verify' && (
          <VerifyScreen
            vehicles={authVehicles}
            vehicleId={vehicleId}
            onSelect={setVehicleId}
            verification={verification}
            verifying={verifying}
            signedOn={Boolean(state && state.status !== VehicleStatus.OFFLINE)}
            busy={busy}
            onSignOn={() => void signOn()}
          />
        )}

        {activeScreen === 'home' && state && (
          <HomeScreen
            vehicleId={vehicleId!}
            gpsOk={state.gpsOk}
            accuracy={state.gpsAccuracy}
            onRequest={() => setManualScreen('destination')}
          />
        )}

        {activeScreen === 'destination' && (
          <DestinationScreen
            facilities={facilities}
            selected={destination}
            onSelect={(facility) => {
              setDestination(facility);
              setManualScreen('severity');
            }}
            onBack={() => setManualScreen('home')}
          />
        )}

        {activeScreen === 'severity' && destination && (
          <SeverityScreen
            destination={destination}
            severity={severity}
            note={note}
            busy={busy}
            onSeverity={setSeverity}
            onNote={setNote}
            onBack={() => setManualScreen('destination')}
            onSubmit={() => void submit()}
          />
        )}

        {activeScreen === 'pending' && request && (
          <PendingScreen request={request} busy={busy} onCancel={() => void cancel()} />
        )}

        {activeScreen === 'active' && state && request && (
          <ActiveScreen
            etaSeconds={state.etaSeconds}
            distanceRemainingM={state.distanceRemainingM}
            destinationName={request.destination.name}
            nextJunction={junctionCode(state.nextJunctionId)}
            corridorLabel={corridorState.label}
            corridorTone={corridorState.tone}
            gpsOk={state.gpsOk}
            rerouted={route?.reason?.startsWith('REROUTED') ?? false}
            rerouteExplanation={route?.explanation}
            busy={busy}
            onCancel={() => void cancel()}
          />
        )}

        {activeScreen === 'arrived' && (
          <ArrivedScreen
            destinationName={request?.destination.name ?? 'destination'}
            busy={busy}
            onReset={() => void returnToStandby()}
          />
        )}
      </main>
    </div>
  );
}

// -- screens ------------------------------------------------------------------

function VerifyScreen({
  vehicles,
  vehicleId,
  onSelect,
  verification,
  verifying,
  signedOn,
  busy,
  onSignOn,
}: {
  vehicles: { id: string; callSign: string }[];
  vehicleId?: string;
  onSelect(id: string): void;
  verification?: VehicleVerification;
  verifying: boolean;
  signedOn: boolean;
  busy: boolean;
  onSignOn(): void;
}) {
  const checks: { label: string; ok: boolean }[] = verification
    ? [
        { label: 'Driver authorised for this vehicle', ok: verification.driverAuthorized },
        { label: 'Operator licence current', ok: verification.driverLicenceValid },
        { label: 'Vehicle in active service', ok: verification.vehicleActive },
        { label: 'Operator registration active', ok: verification.organizationActive },
        { label: 'Telemetry unit registered', ok: verification.hardwareRegistered },
        { label: 'Telemetry unit reachable', ok: verification.hardwareOnline },
      ]
    : [];

  return (
    <div className="flex flex-1 flex-col">
      <h2 className="text-lg font-semibold text-ink-900">Vehicle verification</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">
        Your vehicle is identified from your account. Emergency privileges are granted only when every link in the
        chain checks out.
      </p>

      {vehicles.length > 1 && (
        <div className="mt-4 space-y-2">
          {vehicles.map((vehicle) => (
            <button
              key={vehicle.id}
              type="button"
              onClick={() => onSelect(vehicle.id)}
              className={`flex h-12 w-full items-center justify-between rounded-lg border px-3 text-left ${
                vehicleId === vehicle.id
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-line bg-surface-muted'
              }`}
            >
              <span className="tnum font-mono text-sm font-semibold text-ink-900">{vehicle.callSign}</span>
              {vehicleId === vehicle.id && <BadgeCheck className="size-4 text-brand-600" />}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-line bg-surface p-3">
        {verifying ? (
          <p className="text-xs text-ink-500">Checking identity chain…</p>
        ) : (
          <ul className="space-y-2">
            {checks.map((check) => (
              <li key={check.label} className="flex items-center gap-2">
                {check.ok ? (
                  <CheckCircle2 className="size-4 shrink-0 text-ok-600" />
                ) : (
                  <ShieldAlert className="size-4 shrink-0 text-critical-600" />
                )}
                <span className={`text-xs ${check.ok ? 'text-ink-700' : 'text-critical-600'}`}>
                  {check.label}
                </span>
              </li>
            ))}
          </ul>
        )}

        {verification && !verification.verified && verification.failures.length > 0 && (
          <div className="mt-3 border-t border-line pt-2">
            {verification.failures.map((failure) => (
              <p key={failure} className="text-[11px] leading-relaxed text-critical-600">
                {failure}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="mt-auto pt-4">
        <Button
          variant="primary"
          size="lg"
          className="h-14 w-full text-base"
          disabled={busy || !verification?.verified || signedOn}
          onClick={onSignOn}
        >
          {signedOn ? 'Signed on' : 'Sign on to vehicle'}
        </Button>
      </div>
    </div>
  );
}

function HomeScreen({
  vehicleId,
  gpsOk,
  accuracy,
  onRequest,
}: {
  vehicleId: string;
  gpsOk: boolean;
  accuracy: number;
  onRequest(): void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="tnum font-mono text-2xl font-semibold text-ink-900">{vehicleId}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ok-600">
              <BadgeCheck className="size-3.5" />
              Verified
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-ink-500">GPS</p>
            <p className={`flex items-center gap-1 text-sm font-medium ${gpsOk ? 'text-ok-600' : 'text-violet-500'}`}>
              <SatelliteDish className="size-3.5" />
              {gpsOk ? 'Connected' : 'No lock'}
            </p>
            {gpsOk && <p className="tnum font-mono text-[10px] text-ink-9000">±{Math.round(accuracy)} m</p>}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-line bg-surface p-4">
        <p className="text-xs text-ink-500">Status</p>
        <p className="mt-0.5 text-lg font-medium text-ink-800">Standby</p>
        <p className="mt-2 text-xs leading-relaxed text-ink-500">
          No active emergency. Request a green corridor when you are responding to a call.
        </p>
      </div>

      <div className="mt-auto pt-4">
        <Button variant="danger" size="lg" className="h-16 w-full text-base font-semibold" onClick={onRequest}>
          <Siren className="size-5" />
          Request green corridor
        </Button>
      </div>
    </div>
  );
}

function DestinationScreen({
  facilities,
  selected,
  onSelect,
  onBack,
}: {
  facilities: Facility[];
  selected?: Facility;
  onSelect(facility: Facility): void;
  onBack(): void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 self-start text-xs text-ink-500">
        <ArrowLeft className="size-4" />
        Back
      </button>

      <h2 className="text-lg font-semibold text-ink-900">Destination</h2>
      <p className="mt-1 text-xs text-ink-500">The receiving hospital is notified as soon as your request is approved.</p>

      <div className="mt-4 space-y-2">
        {facilities.map((facility) => (
          <button
            key={facility.id}
            type="button"
            onClick={() => onSelect(facility)}
            className={`flex min-h-14 w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left ${
              selected?.id === facility.id ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface-muted'
            }`}
          >
            <MapPin className="mt-0.5 size-4 shrink-0 text-critical-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-900">{facility.name}</p>
              <p className="truncate text-[11px] text-ink-500">{facility.address}</p>
              {facility.specialities && (
                <p className="truncate text-[10px] text-ink-9000">{facility.specialities.join(' · ')}</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function SeverityScreen({
  destination,
  severity,
  note,
  busy,
  onSeverity,
  onNote,
  onBack,
  onSubmit,
}: {
  destination: Facility;
  severity: SeverityType;
  note: string;
  busy: boolean;
  onSeverity(value: SeverityType): void;
  onNote(value: string): void;
  onBack(): void;
  onSubmit(): void;
}) {
  const options: SeverityType[] = [Severity.CRITICAL, Severity.HIGH, Severity.MEDIUM, Severity.LOW];

  return (
    <div className="flex flex-1 flex-col">
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 self-start text-xs text-ink-500">
        <ArrowLeft className="size-4" />
        Back
      </button>

      <h2 className="text-lg font-semibold text-ink-900">Severity</h2>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
        <MapPin className="size-3.5" />
        {destination.name}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {options.map((option) => {
          const style = SEVERITY_STYLE[option];
          const active = severity === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onSeverity(option)}
              className={`flex h-16 flex-col items-center justify-center rounded-lg border ${
                active ? 'border-2' : 'border-line bg-surface-muted'
              }`}
              style={active ? { borderColor: style.hex, backgroundColor: `${style.hex}18` } : undefined}
            >
              <span className="text-sm font-semibold" style={{ color: active ? style.hex : undefined }}>
                {style.label}
              </span>
            </button>
          );
        })}
      </div>

      <label htmlFor="note" className="mt-4 block text-[11px] font-medium uppercase tracking-wider text-ink-500">
        Note for the control room (optional)
      </label>
      <textarea
        id="note"
        value={note}
        onChange={(event) => onNote(event.target.value)}
        rows={3}
        maxLength={200}
        placeholder="e.g. cardiac arrest, 62M, CPR in progress"
        className="mt-1 w-full resize-none rounded-lg border border-line bg-surface-muted px-2.5 py-2 text-sm text-ink-800 outline-none placeholder:text-ink-9000 focus:border-brand-500"
      />

      <div className="mt-auto pt-4">
        <Button
          variant="danger"
          size="lg"
          className="h-16 w-full text-base font-semibold"
          disabled={busy}
          onClick={onSubmit}
        >
          <Siren className="size-5" />
          {busy ? 'Submitting…' : 'Submit request'}
        </Button>
      </div>
    </div>
  );
}

function PendingScreen({
  request,
  busy,
  onCancel,
}: {
  request: { id: string; destination: { name: string }; severity: SeverityType };
  busy: boolean;
  onCancel(): void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <Clock className="size-12 animate-pulse text-warn-600" />
        <h2 className="mt-4 text-xl font-semibold text-ink-900">Awaiting approval</h2>
        <p className="mt-2 max-w-[30ch] text-sm leading-relaxed text-ink-500">
          The control room is verifying your vehicle and planning a corridor to {request.destination.name}.
        </p>
        <p className="tnum mt-3 font-mono text-xs text-ink-9000">{request.id}</p>
      </div>

      <Button variant="default" size="lg" className="h-12 w-full" disabled={busy} onClick={onCancel}>
        Cancel request
      </Button>
    </div>
  );
}

function ActiveScreen({
  etaSeconds,
  distanceRemainingM,
  destinationName,
  nextJunction,
  corridorLabel,
  corridorTone,
  gpsOk,
  rerouted,
  rerouteExplanation,
  busy,
  onCancel,
}: {
  etaSeconds?: number;
  distanceRemainingM?: number;
  destinationName: string;
  nextJunction: string;
  corridorLabel: string;
  corridorTone: string;
  gpsOk: boolean;
  rerouted: boolean;
  rerouteExplanation?: string;
  busy: boolean;
  onCancel(): void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      {/* The three figures that matter, sized to be read at a glance. */}
      <div className="rounded-lg border border-ok-200 bg-ok-50 p-4 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-ok-600">Corridor approved</p>
        <p className="tnum mt-1 font-mono text-5xl font-bold leading-none text-ink-900">{formatEta(etaSeconds)}</p>
        <p className="mt-1.5 text-xs text-ink-600">
          {destinationName}
          {distanceRemainingM !== undefined && ` · ${formatDistance(distanceRemainingM)}`}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-line bg-surface p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-ink-500">Next junction</p>
          <p className="tnum mt-1 flex items-center justify-center gap-1.5 font-mono text-2xl font-semibold text-ink-900">
            <Navigation className="size-4 text-ink-500" />
            {nextJunction}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-ink-500">Corridor</p>
          <p className={`mt-1 text-2xl font-semibold ${corridorTone}`}>{corridorLabel}</p>
        </div>
      </div>

      {!gpsOk && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-violet-100 bg-violet-50 px-3 py-2">
          <SatelliteDish className="mt-0.5 size-4 shrink-0 text-violet-500" />
          <p className="text-xs text-violet-600">
            GPS lock lost. The control room is holding your last confirmed position — junctions ahead will not be
            released until the fix returns.
          </p>
        </div>
      )}

      {rerouted && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-info-200 bg-info-50 px-3 py-2">
          <RefreshCw className="mt-0.5 size-4 shrink-0 text-info-600" />
          <div>
            <p className="text-xs font-medium text-info-600">Route updated</p>
            {rerouteExplanation && (
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-600">{rerouteExplanation}</p>
            )}
          </div>
        </div>
      )}

      <div className="mt-auto pt-4">
        <Button variant="default" size="lg" className="h-12 w-full" disabled={busy} onClick={onCancel}>
          Stand down
        </Button>
      </div>
    </div>
  );
}

function ArrivedScreen({
  destinationName,
  busy,
  onReset,
}: {
  destinationName: string;
  busy: boolean;
  onReset(): void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <CheckCircle2 className="size-14 text-ok-600" />
        <h2 className="mt-4 text-xl font-semibold text-ink-900">Arrived</h2>
        <p className="mt-2 max-w-[32ch] text-sm leading-relaxed text-ink-500">
          You have reached {destinationName}. The corridor has been released and all junctions have returned to their
          normal programme.
        </p>
      </div>

      <Button variant="primary" size="lg" className="h-14 w-full text-base" disabled={busy} onClick={onReset}>
        Return to standby
      </Button>
    </div>
  );
}
