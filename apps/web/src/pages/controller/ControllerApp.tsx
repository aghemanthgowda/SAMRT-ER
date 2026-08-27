import { Route, Routes } from 'react-router-dom';
import { useRealtime } from '@/hooks/useRealtime';
import { AlertsPage } from './AlertsPage';
import { DashboardPage } from './DashboardPage';
import { IncidentsPage } from './IncidentsPage';
import { JunctionsPage } from './JunctionsPage';
import { LiveMapPage } from './LiveMapPage';
import { ReportsPage } from './ReportsPage';
import { RequestsPage } from './RequestsPage';
import { SettingsPage } from './SettingsPage';
import { VehiclesPage } from './VehiclesPage';

/**
 * The controller application.
 *
 * One realtime subscription for the whole console, opened here rather than per
 * page, so navigating between pages does not tear down and rebuild the socket
 * — and the operator never loses events while a route transition is in flight.
 */
export function ControllerApp() {
  useRealtime();

  return (
    <Routes>
      <Route index element={<DashboardPage />} />
      <Route path="map" element={<LiveMapPage />} />
      <Route path="requests" element={<RequestsPage />} />
      <Route path="vehicles" element={<VehiclesPage />} />
      <Route path="junctions" element={<JunctionsPage />} />
      <Route path="incidents" element={<IncidentsPage />} />
      <Route path="alerts" element={<AlertsPage />} />
      <Route path="reports" element={<ReportsPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="*" element={<DashboardPage />} />
    </Routes>
  );
}
