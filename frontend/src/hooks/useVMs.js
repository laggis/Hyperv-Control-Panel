import { useState, useEffect, useCallback, useRef } from 'react';
import { listVMsWithMeta } from '../api';

export function useVMs(pollInterval = 5000) {
  const [vms, setVMs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const intervalRef = useRef(null);

  const fetch = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await listVMsWithMeta();
      setVMs(Array.isArray(data.vms) ? data.vms : []);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // After a VM action, poll quickly to catch state transitions
  const refresh = useCallback(async () => {
    await fetch();
    setTimeout(() => fetch(true), 2000);
    setTimeout(() => fetch(true), 4000);
  }, [fetch]);

  useEffect(() => {
    fetch();
    // Background poll — default 10 s to keep request count well under the rate limit.
    // The dashboard passes 10000; callers that need tighter refresh can pass a lower value.
    intervalRef.current = setInterval(() => fetch(true), pollInterval);
    return () => {
      clearInterval(intervalRef.current);
    };
  }, [fetch, pollInterval]);

  return { vms, loading, error, lastUpdated, refresh };
}
