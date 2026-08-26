import { useEffect, useState } from 'react';
import type { Vehicle } from '@smart-er/core';
import { api, type VehicleWithState } from '@/api/client';

/**
 * The vehicle register.
 *
 * Vehicle records (call sign, type, registration, operator) do not change
 * during a shift, so they are fetched once rather than carried in every
 * realtime snapshot. Live position and status come from the ops store.
 */
export function useVehicleIndex(): { vehicleById: Map<string, Vehicle>; vehicles: VehicleWithState[]; loading: boolean } {
  const [vehicles, setVehicles] = useState<VehicleWithState[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void api
      .vehicles()
      .then((result) => {
        if (!cancelled) setVehicles(result);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    vehicleById: new Map(vehicles.map((vehicle) => [vehicle.id, vehicle as Vehicle])),
    vehicles,
    loading,
  };
}
