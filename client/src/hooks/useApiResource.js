import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api.js';

// GET requests only: writes keep their explicit confirmation and retry rules.
export default function useApiResource(path, params = {}, fallback = 'Unable to load data. Please try again.') {
  const query = JSON.stringify(params);
  const key = path + ':' + query;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ key: '', data: null, loading: true, error: '' });
  const refetch = useCallback(() => setRevision(value => value + 1), []);
  const setData = useCallback(update => setState(current => ({ ...current, data: typeof update === 'function' ? update(current.data) : update })), []);
  useEffect(() => {
    const controller = new AbortController();
    setState({ key, data: null, loading: true, error: '' });
    api.get(path, { params: JSON.parse(query), signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setState({ key, data, loading: false, error: '' });
    }).catch(failure => {
      if (!controller.signal.aborted) setState({ key, data: null, loading: false, error: failure.response?.data?.error?.message || fallback });
    });
    return () => controller.abort();
  }, [path, query, key, revision, fallback]);
  return { data: state.key === key ? state.data : null, loading: state.key !== key || state.loading, error: state.key === key ? state.error : '', refetch, setData };
}
