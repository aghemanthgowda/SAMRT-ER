import { useEffect, useRef, useState } from 'react';
import { hasApiKey, loadMapsLibrary, readMapsConfig, type MapsAvailability } from './loader';
import { DEFAULT_CENTER, DEFAULT_ZOOM, OPERATIONS_MAP_STYLE } from './mapStyle';

export interface UseGoogleMapResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  map: google.maps.Map | undefined;
  availability: MapsAvailability;
  error?: string;
  /** True when Google's live traffic layer is shown. */
  trafficVisible: boolean;
  setTrafficVisible(visible: boolean): void;
}

/**
 * Create and own a Google map instance for a container.
 *
 * Deliberately imperative: the Maps API manages its own DOM, so wrapping it in
 * React state would mean tearing down and rebuilding the map on every render —
 * which on a dashboard that updates once a second is both slow and visibly
 * janky. The map is created once and mutated in place by the overlay layer.
 */
export function useGoogleMap(options: { center?: google.maps.LatLngLiteral; zoom?: number } = {}): UseGoogleMapResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | undefined>(undefined);
  const trafficRef = useRef<google.maps.TrafficLayer | undefined>(undefined);

  const [map, setMap] = useState<google.maps.Map | undefined>();
  const [availability, setAvailability] = useState<MapsAvailability>(hasApiKey() ? 'loading' : 'unavailable');
  const [error, setError] = useState<string | undefined>();
  const [trafficVisible, setTrafficVisibleState] = useState(true);

  useEffect(() => {
    if (!hasApiKey()) {
      setAvailability('unavailable');
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const { Map } = await loadMapsLibrary<google.maps.MapsLibrary>('maps');
        if (cancelled || !containerRef.current) return;

        const config = readMapsConfig();
        const instance = new Map(containerRef.current, {
          center: options.center ?? DEFAULT_CENTER,
          zoom: options.zoom ?? DEFAULT_ZOOM,
          // A Map ID means styling is managed in the cloud console; supplying
          // both is an error the Maps API warns about.
          ...(config.mapId ? { mapId: config.mapId } : { styles: OPERATIONS_MAP_STYLE }),
          disableDefaultUI: true,
          zoomControl: true,
          zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
          gestureHandling: 'greedy',
          clickableIcons: false,
          keyboardShortcuts: true,
          backgroundColor: '#f4f6f9',
        });

        mapRef.current = instance;
        setMap(instance);
        setAvailability('ready');
      } catch (loadError) {
        if (cancelled) return;
        setError((loadError as Error).message);
        setAvailability('error');
      }
    })();

    return () => {
      cancelled = true;
    };
    // The map is created once for the lifetime of the component; changing the
    // initial centre later should pan it, not rebuild it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map) return;
    if (trafficVisible) {
      if (!trafficRef.current) trafficRef.current = new google.maps.TrafficLayer();
      trafficRef.current.setMap(map);
    } else {
      trafficRef.current?.setMap(null);
    }
  }, [map, trafficVisible]);

  useEffect(
    () => () => {
      trafficRef.current?.setMap(null);
      trafficRef.current = undefined;
      mapRef.current = undefined;
    },
    [],
  );

  return {
    containerRef,
    map,
    availability,
    error,
    trafficVisible,
    setTrafficVisible: setTrafficVisibleState,
  };
}
