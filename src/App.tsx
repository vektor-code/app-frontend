import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { api, type NamespaceStats } from './api/client';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import TraceExplorer from './pages/TraceExplorer';
import TraceDetail from './pages/TraceDetail';
import ServiceMap from './pages/ServiceMap';
import LiveStream from './pages/LiveStream';

export default function App() {
  const [namespaces, setNamespaces] = useState<NamespaceStats[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [connected, setConnected] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const navigate = useNavigate();

  const loadStats = useCallback(async () => {
    try {
      const data = await api.getStats();
      setNamespaces(data.namespaces || []);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, [loadStats]);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
      setIsDark(true);
      document.body.classList.add('dark-theme');
    } else {
      setIsDark(false);
      document.body.classList.remove('dark-theme');
    }
  }, []);

  const toggleTheme = () => {
    if (isDark) {
      document.body.classList.remove('dark-theme');
      localStorage.setItem('theme', 'light');
      setIsDark(false);
    } else {
      document.body.classList.add('dark-theme');
      localStorage.setItem('theme', 'dark');
      setIsDark(true);
    }
  };

  return (
    <div className="app-layout">
      <Sidebar
        namespaces={namespaces}
        selectedNamespace={selectedNamespace}
        onNamespaceChange={(ns) => {
          setSelectedNamespace(ns);
          navigate('/');
        }}
      />
      <div className="app-main">
        <header className="app-header">
          <div className="header-title">
            {selectedNamespace ? (
              <><span className="badge badge-ns">{selectedNamespace}</span> Trace Overview</>
            ) : (
              'All Namespaces'
            )}
          </div>
          <div className="header-actions">
            <button className="btn btn-ghost" onClick={toggleTheme} style={{ borderRadius: '50%', width: '36px', height: '36px', padding: 0, justifyContent: 'center', fontSize: '16px' }}>
              {isDark ? '☀️' : '🌙'}
            </button>
            <div className="header-badge">
              <div className={`live-dot${connected ? '' : ' '}`} style={connected ? {} : { background: 'var(--accent-rose)' }} />
              {connected ? 'Connected' : 'Disconnected'}
            </div>
          </div>
        </header>
        <main className="app-content">
          <Routes>
            <Route path="/" element={<Dashboard namespaces={namespaces} selectedNamespace={selectedNamespace} onSelectNamespace={setSelectedNamespace} />} />
            <Route path="/traces" element={<TraceExplorer namespace={selectedNamespace} />} />
            <Route path="/traces/:traceId" element={<TraceDetail />} />
            <Route path="/servicemap" element={<ServiceMap namespace={selectedNamespace} />} />
            <Route path="/live" element={<LiveStream namespace={selectedNamespace} />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
