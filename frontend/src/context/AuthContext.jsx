import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from '../lib/apiClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [permissions, setPermissions] = useState(new Set());
    const [loading, setLoading] = useState(true);

    const loadMe = useCallback(async () => {
        if (!getToken()) { setUser(null); setLoading(false); return; }
        try {
            const data = await api.get('/auth/me');
            setUser(data.user);
            setPermissions(new Set(data.permissions));
        } catch {
            setToken(null);
            setUser(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadMe();
        const onUnauthorized = () => { setUser(null); setPermissions(new Set()); };
        window.addEventListener('ggerp:unauthorized', onUnauthorized);
        return () => window.removeEventListener('ggerp:unauthorized', onUnauthorized);
    }, [loadMe]);

    const login = async (username, password) => {
        const data = await api.post('/auth/login', { username, password });
        setToken(data.token);
        await loadMe();
    };

    const logout = () => {
        setToken(null);
        setUser(null);
        setPermissions(new Set());
    };

    const can = (code) => permissions.has(code);

    return (
        <AuthContext.Provider value={{ user, permissions, can, login, logout, loading, refresh: loadMe }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
