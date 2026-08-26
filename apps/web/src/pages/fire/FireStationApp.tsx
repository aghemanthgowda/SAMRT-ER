import { IncidentKind, VehicleKind } from '@smart-er/core';
import { DispatchConsole } from '@/pages/dispatch/DispatchConsole';

export function FireStationApp() {
  return (
    <DispatchConsole
      title="Fire station watch room"
      vehicleKind={VehicleKind.FIRE_TRUCK}
      incidentKind={IncidentKind.FIRE}
      unitNoun="Appliance"
    />
  );
}
