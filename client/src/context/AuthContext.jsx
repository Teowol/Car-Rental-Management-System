import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../services/api.js';
const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function refresh(signal) {
    setLoading(true); setError('');
    try { const response = await api.get('/me', { signal }); if (!signal?.aborted) setUser(response.data.user); }
    catch (failure) { if (!signal?.aborted) { setUser(null); if (failure.response?.status !== 401) setError('Unable to check your session. Please try again.'); } }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => { const controller = new AbortController(); refresh(controller.signal); return () => controller.abort(); }, []);
  useEffect(() => {
    const interceptor = api.interceptors.response.use(response => response, failure => {
      if (failure.response?.status === 401 && !failure.config.url.startsWith('/auth/')) setUser(null);
      return Promise.reject(failure);
    });
    return () => api.interceptors.response.eject(interceptor);
  }, []);
  async function authenticate(action, values) {
    setUser((await api.post('/auth/' + action, values)).data.user); setError('');
  }
  async function logout() { await api.post('/auth/logout', {}); setUser(null); window.location.hash = '#/login'; }
  async function updateProfile(values) { setUser((await api.patch('/me', values)).data.user); }
  return <AuthContext.Provider value={{ user, loading, error, refresh, authenticate, logout, updateProfile }}>{children}</AuthContext.Provider>;
}
