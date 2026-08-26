import { IncidentKind, VehicleKind } from '@smart-er/core';
import { DispatchConsole } from '@/pages/dispatch/DispatchConsole';

export function PoliceApp() {
  return (
    <DispatchConsole
      title="Police control room"
      vehicleKind={VehicleKind.POLICE_UNIT}
      incidentKind={IncidentKind.LAW_ENFORCEMENT}
      unitNoun="Unit"
    />
  );
}
