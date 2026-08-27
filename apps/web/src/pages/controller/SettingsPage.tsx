import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, MapPin, XCircle } from 'lucide-react';
import { Badge, Card, Field } from '@/components/ui/primitives';
import { HardwareStatus } from '@/components/panels/HardwareStatus';
import { ChangePassword } from '@/components/settings/ChangePassword';
import { SimulationControl } from '@/components/panels/SimulationControl';
import { ControllerLayout } from '@/components/shell/ControllerLayout';
import { mapsDiagnostics, onMapsHealthChange, readMapsConfig, type MapsDiagnostics } from '@/maps/loader';
import { useAuthStore } from '@/stores/authStore';
import { useOpsStore } from '@/stores/opsStore';

/**
 * Settings and system configuration.
 *
 * Read-only where the value comes from the environment, because changing a
 * Maps key from a browser form would mean the browser could write it — and the
 * key belongs in the deployment, not in application state.
 */
/**
 * How each provider state should be presented.
 *
 * `no-key` is a warning: nothing is broken, the schematic map is doing its job.
 * `unauthorized` and `error` are failures — a key was supplied and Google would
 * not serve it — and must not be shown in the same tone as "not configured",
 * because the remedy is completely different.
 */
const MAPS_PRESENTATION = {
  ready: {
    tone: 'ok' as const,
    title: 'Connected',
    body: 'Google Maps is the map provider. Routes are drawn on real road geometry with traffic-aware travel times.',
  },
  loading: {
    tone: 'warn' as const,
    title: 'Connecting',
    body: 'Waiting for the Maps JavaScript API to load.',
  },
  'no-key': {
    tone: 'warn' as const,
    title: 'No API key configured',
    body: 'The console is running on the schematic fallback map. Every operational capability works, but the geography is not real.',
  },
  unauthorized: {
    tone: 'critical' as const,
    title: 'API key rejected',
    body: 'Google refused the key, so the console has fallen back to the schematic map.',
  },
  error: {
    tone: 'critical' as const,
    title: 'Google Maps unreachable',
    body: 'The Maps JavaScript API could not be loaded, so the console has fallen back to the schematic map.',
  },
};

const TONE_CLASS = {
  ok: { box: 'border-ok-200 bg-ok-50', text: 'text-ok-700', icon: 'text-ok-600' },
  warn: { box: 'border-warn-200 bg-warn-50', text: 'text-warn-700', icon: 'text-warn-600' },
  critical: { box: 'border-critical-200 bg-critical-50', text: 'text-critical-700', icon: 'text-critical-600' },
};

export function SettingsPage() {
  const user = useAuthStore((state) => state.user);
  const config = readMapsConfig();
  const simulation = useOpsStore((state) => state.simulation);
  const junctions = useOpsStore((state) => state.junctions.length);

  // Health, not configuration: Google reports a rejected key asynchronously,
  // so this has to track the provider rather than read an env var once.
  const [maps, setMaps] = useState<MapsDiagnostics>(() => mapsDiagnostics());
  useEffect(() => onMapsHealthChange(setMaps), []);
  useEffect(() => setMaps(mapsDiagnostics()), []);

  const presentation = MAPS_PRESENTATION[maps.health];
  const tone = TONE_CLASS[presentation.tone];
  const needsSetup = maps.health === 'no-key';

  return (
    <ControllerLayout title="Settings" subtitle="Configuration, hardware and simulation">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {/* Maps configuration — the one that most often needs attention. */}
        <Card title="Google Maps">
          <div className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${tone.box}`}>
            {presentation.tone === 'ok' ? (
              <CheckCircle2 className={`mt-px size-4 shrink-0 ${tone.icon}`} />
            ) : presentation.tone === 'critical' ? (
              <XCircle className={`mt-px size-4 shrink-0 ${tone.icon}`} />
            ) : (
              <AlertTriangle className={`mt-px size-4 shrink-0 ${tone.icon}`} />
            )}
            <div className="min-w-0">
              <p className={`text-[13px] font-medium ${tone.text}`}>{presentation.title}</p>
              <p className={`mt-0.5 text-[12px] leading-relaxed ${tone.text}`}>{presentation.body}</p>
              {/* Google's own diagnosis, when it gave one. */}
              {maps.message && <p className={`mt-1 text-[12px] leading-relaxed ${tone.text}`}>{maps.message}</p>}
            </div>
          </div>

          {needsSetup && (
            <div className="mt-3 rounded-lg border border-line bg-surface-muted p-3">
              <p className="text-[12.5px] font-medium text-ink-800">To enable Google Maps</p>
              <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-ink-600">
                <li>
                  Create an API key in the Google Cloud console and enable <strong>Maps JavaScript API</strong> and{' '}
                  <strong>Routes API</strong>.
                </li>
                <li>Restrict the key to this application&rsquo;s origins.</li>
                <li>
                  Add it to <code className="rounded bg-surface-sunken px-1 font-mono text-[11px]">.env</code> at the
                  repository root:
                </li>
              </ol>
              <pre className="mt-2 overflow-x-auto rounded border border-line bg-surface px-2.5 py-2 font-mono text-[11px] text-ink-700">
{`VITE_GOOGLE_MAPS_API_KEY=your-key
VITE_GOOGLE_MAPS_VERSION=beta`}
              </pre>
              <p className="mt-2 text-[11.5px] text-ink-500">
                Then restart the dev server. The key is read from the environment and is never committed — only{' '}
                <code className="font-mono text-[11px]">.env.example</code> is in the repository.
              </p>
              <a
                href="https://developers.google.com/maps/documentation/javascript/get-api-key"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-brand-600 hover:underline"
              >
                Google Maps key documentation
                <ExternalLink className="size-3" />
              </a>
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="API version channel" value={config.version} mono />
            <Field label="Map ID" value={config.mapId ?? 'Not set (using inline style)'} mono />
            <Field
              label="Routes library"
              value={
                maps.routesLibrary === 'available'
                  ? 'Loaded'
                  : maps.routesLibrary === 'unavailable'
                    ? 'Not on this channel — DirectionsService fallback'
                    : config.version === 'beta'
                      ? 'Published on beta — not yet loaded'
                      : 'DirectionsService fallback'
              }
            />
            <Field label="Key source" value="Environment variable" />
          </div>
        </Card>

        {/* Operator */}
        <Card title="Signed-in operator">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" value={user?.displayName ?? '—'} />
            <Field label="Call sign" value={user?.callSign ?? '—'} mono />
            <Field label="Role" value={user?.role.replace('_', ' ') ?? '—'} />
            <Field label="Account" value={user?.email ?? '—'} />
            <Field
              label="Status"
              value={<Badge className="bg-ok-50 text-ok-700 border-ok-200">{user?.active ? 'Active' : 'Inactive'}</Badge>}
            />
            <Field label="User ID" value={user?.id ?? '—'} mono />
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-ink-500">
            Accounts, roles and password hashes are held server-side. This console never receives a credential and
            cannot change a role — authority comes from the account record.
          </p>
        </Card>

        {/* Security */}
        <Card title="Password">
          <ChangePassword />
        </Card>

        {/* Network */}
        <Card title="Junction network">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Junctions modelled" value={String(junctions)} mono />
            <Field label="Demonstration area" value="Central Bengaluru" />
            <Field
              label="Coordinates"
              value={
                <span className="flex items-center gap-1">
                  <MapPin className="size-3 text-ink-400" />
                  Real WGS-84
                </span>
              }
            />
            <Field label="Configured in" value="apps/server/src/db/network.ts" mono />
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-ink-500">
            Junction coordinates, road links and per-approach conflict matrices live in one file on the server, not
            scattered across components. Corridors are reservations over these nodes.
          </p>
        </Card>

        {/* Simulation */}
        <Card
          title="Simulation"
          actions={
            <Badge className={simulation?.running ? 'bg-ok-50 text-ok-700 border-ok-200' : 'bg-surface-sunken text-ink-600 border-line'}>
              {simulation?.running ? 'Running' : 'Paused'}
            </Badge>
          }
          noPadding
        >
          <SimulationControl />
        </Card>

        {/* Hardware */}
        <Card title="Hardware" className="xl:col-span-2" noPadding>
          <HardwareStatus />
        </Card>
      </div>
    </ControllerLayout>
  );
}
