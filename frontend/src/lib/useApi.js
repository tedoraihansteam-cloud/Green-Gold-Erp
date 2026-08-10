import { useCallback, useEffect, useState } from 'react';
import { api } from './apiClient';

/**
 * Fetches `path` on mount (and whenever refreshKey changes), exposing a
 * reload() function so pages can refetch after a create/update action
 * without a full page reload.
 */
export function useApi(path) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

    useEffect(() => {
        if (!path) { setData(null); setLoading(false); return; }
        let cancelled = false;
        setLoading(true);
        setError(null);
        api.get(path)
            .then((d) => { if (!cancelled) setData(d); })
            .catch((e) => { if (!cancelled) setError(e.message); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [path, refreshKey]);

    return { data, loading, error, reload };
}
