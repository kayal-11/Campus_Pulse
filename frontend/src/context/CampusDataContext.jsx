import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  connectWebSocket,
  fetchAlerts,
  fetchBuildings,
  fetchDashboardOverview,
  fetchDashboardTrend,
  fetchEnergyData,
  fetchPredictions,
} from '../services/api';
import { useAuth } from './AuthContext';

const CampusDataContext = createContext(null);

export function CampusDataProvider({ children }) {
  const { isAuthenticated, user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [trend, setTrend] = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [energy, setEnergy] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [liveStatus, setLiveStatus] = useState('offline');
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const [ov, tr, bld, en, pred, al] = await Promise.all([
        fetchDashboardOverview(),
        fetchDashboardTrend(),
        fetchBuildings(),
        fetchEnergyData(),
        fetchPredictions(),
        fetchAlerts(),
      ]);
      setOverview(ov);
      setTrend(tr);
      setBuildings(bld);
      setEnergy(en);
      setPredictions(pred);
      setAlerts(al);
    } catch {
      /* handled per-page */
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      setOverview(null);
      setTrend([]);
      setBuildings([]);
      setEnergy([]);
      setPredictions([]);
      setAlerts([]);
      setLoading(false);
      return undefined;
    }

    loadAll();
    const ws = connectWebSocket(() => loadAll());
    ws.onopen = () => setLiveStatus('live');
    ws.onclose = () => setLiveStatus('offline');
    ws.onerror = () => setLiveStatus('offline');

    const interval = setInterval(loadAll, 30000);
    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [isAuthenticated, user?.id, loadAll]);

  const value = useMemo(
    () => ({
      overview,
      trend,
      buildings,
      energy,
      predictions,
      alerts,
      liveStatus,
      loading,
      refresh: loadAll,
    }),
    [overview, trend, buildings, energy, predictions, alerts, liveStatus, loading, loadAll],
  );

  return <CampusDataContext.Provider value={value}>{children}</CampusDataContext.Provider>;
}

export function useCampusData() {
  const ctx = useContext(CampusDataContext);
  if (!ctx) throw new Error('useCampusData must be used within CampusDataProvider');
  return ctx;
}
