import { useCallback, useEffect, useState } from 'react';
import { cb } from '../ai/actions';
import type { DeviceCodeInfo } from '../drive/driveClient';
import type { StorageConnectionInfo } from '../storage/connections';
import type { ProjectFolder } from '../storage/types';

/** The storage connections for Settings, re-read whenever the projects or a Drive sign-in change. */
export function useStorageConnections(
  projects: ProjectFolder[],
  deviceCode: DeviceCodeInfo | null
) {
  const [connections, setConnections] = useState<StorageConnectionInfo[]>([]);

  const refreshConnections = useCallback(() => {
    void cb().storage.listConnections().then(setConnections);
  }, []);

  useEffect(() => {
    refreshConnections();
  }, [projects, deviceCode, refreshConnections]);

  return { connections, refreshConnections };
}
