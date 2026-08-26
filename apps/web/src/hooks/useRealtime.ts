import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useOpsStore } from '@/stores/opsStore';

/**
 * Open the realtime channel once the operator is authenticated, and close it
 * on sign-out. Every dashboard mounts this; the store guards against opening
 * more than one socket.
 */
export function useRealtime(): void {
  const token = useAuthStore((state) => state.token);
  const connect = useOpsStore((state) => state.connect);
  const disconnect = useOpsStore((state) => state.disconnect);

  useEffect(() => {
    if (!token) return;
    connect(token);
    return () => disconnect();
  }, [token, connect, disconnect]);
}
