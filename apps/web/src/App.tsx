import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Role } from '@smart-er/core';
import { Spinner } from '@/components/ui/primitives';
import { useAuthStore } from '@/stores/authStore';
import { LoginPage } from '@/pages/LoginPage';
import { ControllerApp } from '@/pages/controller/ControllerApp';
import { DriverApp } from '@/pages/driver/DriverApp';
import { HospitalApp } from '@/pages/hospital/HospitalApp';
import { FireStationApp } from '@/pages/fire/FireStationApp';
import { PoliceApp } from '@/pages/police/PoliceApp';

/**
 * Role routing.
 *
 * Each role gets its own application, not a shared dashboard with sections
 * hidden. A driver's screen is built for a phone in a moving vehicle; a
 * controller's is built for a wall of monitors. Those are different products
 * that happen to share a data model, and pretending otherwise produces a
 * console that serves neither well.
 */
const HOME_FOR_ROLE: Record<Role, string> = {
  [Role.CONTROLLER]: '/controller',
  [Role.ADMIN]: '/controller',
  [Role.DRIVER]: '/driver',
  [Role.HOSPITAL]: '/hospital',
  [Role.FIRE_STATION]: '/fire',
  [Role.POLICE]: '/police',
};

export function App() {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const restore = useAuthStore((state) => state.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  if (status === 'restoring') {
    return (
      <div className="flex min-h-full items-center justify-center bg-canvas">
        <Spinner label="Restoring session" />
      </div>
    );
  }

  if (!user) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </BrowserRouter>
    );
  }

  const home = HOME_FOR_ROLE[user.role];

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to={home} replace />} />
        <Route path="/login" element={<Navigate to={home} replace />} />

        <Route
          path="/controller/*"
          element={
            user.role === Role.CONTROLLER || user.role === Role.ADMIN ? (
              <ControllerApp />
            ) : (
              <Navigate to={home} replace />
            )
          }
        />
        <Route path="/driver/*" element={user.role === Role.DRIVER ? <DriverApp /> : <Navigate to={home} replace />} />
        <Route
          path="/hospital/*"
          element={user.role === Role.HOSPITAL ? <HospitalApp /> : <Navigate to={home} replace />}
        />
        <Route
          path="/fire/*"
          element={user.role === Role.FIRE_STATION ? <FireStationApp /> : <Navigate to={home} replace />}
        />
        <Route path="/police/*" element={user.role === Role.POLICE ? <PoliceApp /> : <Navigate to={home} replace />} />

        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </BrowserRouter>
  );
}
