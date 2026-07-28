import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { storageService } from '~/app/services/storageService';
import { base64Encode } from '~/app/utils/encoding';
import type { StorageLocation } from '~/app/types/storage';

const LOCATION_STORAGE_KEY = 'brewet.selected-location';

interface UseStorageLocationsOptions {
  selectedProject: string | null;
  locationId?: string;
}

interface UseStorageLocationsResult {
  locations: StorageLocation[];
  s3Connected: boolean;
  locationsLoading: boolean;
  refreshLocations: () => Promise<void>;
}

export function useStorageLocations({
  selectedProject,
  locationId,
}: UseStorageLocationsOptions): UseStorageLocationsResult {
  const navigate = useNavigate();
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [s3Connected, setS3Connected] = useState(false);
  const [locationsLoading, setLocationsLoading] = useState(true);

  const activeProjectRef = useRef(selectedProject);
  activeProjectRef.current = selectedProject;

  const restoredPathRef = useRef(false);

  useEffect(() => {
    if (!selectedProject) {
      setLocations([]);
      setLocationsLoading(false);
      return;
    }
    const controller = new AbortController();
    setLocationsLoading(true);
    storageService
      .getLocations(selectedProject, controller.signal)
      .then((result) => {
        if (activeProjectRef.current === selectedProject) {
          setLocations(result.locations);
          setS3Connected(result.s3Connected);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (activeProjectRef.current === selectedProject) {
          setLocations([]);
          setS3Connected(false);
        }
      })
      .finally(() => {
        if (activeProjectRef.current === selectedProject) {
          setLocationsLoading(false);
        }
      });
    return () => controller.abort();
  }, [selectedProject]);

  useEffect(() => {
    if (locationId || locationsLoading || locations.length === 0) return;
    try {
      const raw = localStorage.getItem(LOCATION_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { locationId?: string; path?: string };
      if (!saved.locationId || !locations.some((l) => l.id === saved.locationId && l.status === 'available')) return;
      if (saved.path) {
        restoredPathRef.current = true;
        navigate(`/brewet/storage/browse/${encodeURIComponent(saved.locationId)}/${base64Encode(saved.path)}`);
      } else {
        navigate(`/brewet/storage/browse/${encodeURIComponent(saved.locationId)}`);
      }
    } catch { /* unavailable or invalid JSON */ }
  }, [locationId, locationsLoading, locations, navigate]);

  const refreshLocations = useCallback(async () => {
    if (!selectedProject) return;
    const result = await storageService.refreshLocations(selectedProject);
    if (activeProjectRef.current === selectedProject) {
      setLocations(result.locations);
      setS3Connected(result.s3Connected);
    }
  }, [selectedProject]);

  return {
    locations,
    s3Connected,
    locationsLoading,
    refreshLocations,
  };
}

export { LOCATION_STORAGE_KEY };
