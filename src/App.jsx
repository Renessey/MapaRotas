import { useState, useCallback } from 'react';
import FileUpload from './components/FileUpload';
import AddressList from './components/AddressList';
import MapView from './components/MapView';
import { geocodeAddresses, clearCache, findItaipuacuQuadra } from './utils/geocoding';
import itaipuacuQuadras from './data/itaipuacuQuadras.json';
import './App.css';

function App() {
  const [addresses, setAddresses] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [geocodingProgress, setGeocodingProgress] = useState(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [notification, setNotification] = useState(null);
  const [mapCenter, setMapCenter] = useState(null);
  const [mapZoom, setMapZoom] = useState(null);
  // Todas as quadras de Itaipuaçu já vêm carregadas por padrão (com persistência de ajustes personalizados)
  const [quadras, setQuadras] = useState(() => {
    try {
      const saved = localStorage.getItem('itaipuacu_quadras_custom');
      const addedSaved = localStorage.getItem('itaipuacu_quadras_added');
      const deletedSaved = localStorage.getItem('itaipuacu_quadras_deleted');

      const customMap = saved ? JSON.parse(saved) : null;
      const deletedSet = new Set(deletedSaved ? JSON.parse(deletedSaved) : []);

      let base = itaipuacuQuadras
        .filter(q => !deletedSet.has(q.id))
        .map(q => {
          const key = q.id || q.rawNumber || q.number;
          if (customMap && customMap[key]) {
            return { ...q, lat: customMap[key].lat, lng: customMap[key].lng };
          }
          return q;
        });

      if (addedSaved) {
        const addedList = JSON.parse(addedSaved);
        if (Array.isArray(addedList)) {
          addedList.forEach(addQ => {
            if (deletedSet.has(addQ.id)) return;
            const alreadyInBase = base.some(
              b =>
                b.id === addQ.id ||
                (b.rawNumber === addQ.rawNumber &&
                  Math.abs(b.lat - addQ.lat) < 0.0002 &&
                  Math.abs(b.lng - addQ.lng) < 0.0002)
            );
            if (!alreadyInBase) {
              base.push({ ...addQ, isCustomAdded: true });
            }
          });
        }
      }
      return base;
    } catch (e) {
      console.warn('Erro ao ler custom quadras do localStorage:', e);
      return itaipuacuQuadras;
    }
  });
  // Abas do painel lateral: 'deliveries' | 'upload'
  const [activeTab, setActiveTab] = useState('upload');
  // Visualização mobile: 'map' | 'sidebar'
  const [mobileView, setMobileView] = useState('map');
  // Painel lateral recolhido no desktop
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const showNotification = useCallback((message, type = 'info', timeout = 4000) => {
    setNotification({ message, type });
    if (timeout) {
      setTimeout(() => setNotification(null), timeout);
    }
  }, []);

  const handleAddressesLoaded = useCallback(async (newAddresses) => {
    // Para endereços que já possuem Quadra informada mas não possuem coordenadas,
    // aplica posicionamento imediato na quadra de Itaipuaçu correspondente
    const prelocatedAddresses = newAddresses.map(addr => {
      if (addr.coordinates) return addr;
      if (addr.quadra) {
        const qMatch = findItaipuacuQuadra(addr.quadra);
        if (qMatch) {
          return {
            ...addr,
            coordinates: { lat: qMatch.lat, lng: qMatch.lng },
            geocoded: true,
            isQuadraLocated: true,
          };
        }
      }
      return addr;
    });

    setAddresses(prelocatedAddresses);
    setSelectedId(prelocatedAddresses[0]?.originalRow || null);
    clearCache();

    // Ativa automaticamente a aba de entregas
    setActiveTab('deliveries');
    setMobileView('map');

    const needsGeocoding = prelocatedAddresses.filter(a => !a.coordinates || a.isQuadraLocated);
    const alreadyGeocoded = prelocatedAddresses.filter(a => a.coordinates && !a.isQuadraLocated).length;

    if (needsGeocoding.length === 0) {
      if (alreadyGeocoded > 0) {
        showNotification(`${alreadyGeocoded} endereços carregados com coordenadas prontas!`, 'success');
      }
      return;
    }

    showNotification(`${newAddresses.length} endereços importados. As quadras de Itaipuaçu já estão ativas no mapa!`, 'info', 3500);
    setIsGeocoding(true);
    setGeocodingProgress({ current: 0, total: needsGeocoding.length, currentAddress: null });

    try {
      const geocodedAddresses = await geocodeAddresses(needsGeocoding, (current, total, currentAddress) => {
        setGeocodingProgress({ current, total, currentAddress });
      });

      const finalAddresses = prelocatedAddresses.map(addr => {
        const updated = geocodedAddresses.find(g => g.originalRow === addr.originalRow);
        if (updated && updated.coordinates) return updated;
        return addr;
      });

      setAddresses(finalAddresses);
      setGeocodingProgress(null);
      const successCount = finalAddresses.filter(a => a.coordinates).length;
      showNotification(`${successCount} de ${finalAddresses.length} paradas posicionadas no mapa de Itaipuaçu!`, 'success');
    } catch (err) {
      showNotification('Erro durante a geocodificação: ' + err.message, 'error', 6000);
      setGeocodingProgress(null);
    } finally {
      setIsGeocoding(false);
    }
  }, [showNotification]);

  const handleFileError = useCallback((err) => {
    showNotification(err, 'error', 5000);
  }, [showNotification]);

  const handleSelect = useCallback((id) => {
    setSelectedId(id);
    const address = addresses.find(a => a.originalRow === id);
    if (address?.coordinates) {
      setMapCenter([address.coordinates.lat, address.coordinates.lng]);
      setMapZoom(17);
      setMobileView('map');
    }
  }, [addresses]);

  const handleSelectQuadra = useCallback((quadraStr) => {
    const qMatch = findItaipuacuQuadra(quadraStr);
    if (qMatch) {
      setMapCenter([qMatch.lat, qMatch.lng]);
      setMapZoom(17);
      setMobileView('map');
      showNotification(`Centralizando na Quadra ${qMatch.rawNumber || qMatch.number} de Itaipuaçu`, 'info', 2500);
    }
  }, [showNotification]);

  const handleRemove = useCallback((id) => {
    setAddresses(prev => prev.filter(a => a.originalRow !== id));
    if (selectedId === id) {
      const remaining = addresses.filter(a => a.originalRow !== id);
      setSelectedId(remaining[0]?.originalRow || null);
    }
  }, [addresses, selectedId]);

  const handleRetryGeocoding = useCallback(async () => {
    const failedAddresses = addresses.filter(a => a.error || (!a.geocoded && !a.coordinates));
    if (failedAddresses.length === 0) {
      showNotification('Todos os endereços já estão geocodificados!', 'info');
      return;
    }

    setIsGeocoding(true);
    setGeocodingProgress({ current: 0, total: failedAddresses.length, currentAddress: null });

    try {
      const geocodedFailed = await geocodeAddresses(failedAddresses, (current, total, currentAddress) => {
        setGeocodingProgress({ current, total, currentAddress });
      });

      setAddresses(prev => prev.map(addr => {
        const updated = geocodedFailed.find(g => g.originalRow === addr.originalRow);
        return updated || addr;
      }));
      setGeocodingProgress(null);
      showNotification('Geocodificação concluída!', 'success');
    } catch (err) {
      showNotification('Erro ao reprocessar: ' + err.message, 'error');
      setGeocodingProgress(null);
    } finally {
      setIsGeocoding(false);
    }
  }, [addresses, showNotification]);

  // Salva oficialmente uma ou várias quadras arrastadas no estado, localStorage e itaipuacuQuadras.json/.js
  const handleUpdateQuadra = useCallback(async (updatedInput) => {
    const items = (Array.isArray(updatedInput) ? updatedInput : [updatedInput]).filter(Boolean);
    if (items.length === 0) return false;

    const cleanItems = items.map(u => ({
      id: u.id,
      number: u.number,
      rawNumber: u.rawNumber,
      lat: u.lat,
      lng: u.lng,
    }));

    setQuadras(prev =>
      prev.map(q => {
        const matched = cleanItems.find(u =>
          u.id
            ? q.id === u.id
            : ((u.rawNumber && q.rawNumber === u.rawNumber) ||
               (u.number && q.number === u.number)) &&
              Math.abs(q.lat - u.lat) < 0.006 &&
              Math.abs(q.lng - u.lng) < 0.006
        );
        return matched ? { ...q, lat: matched.lat, lng: matched.lng } : q;
      })
    );

    // 1. Salva no localStorage para carregamento instantâneo mesmo offline ou no celular
    try {
      const saved = localStorage.getItem('itaipuacu_quadras_custom');
      const customMap = saved ? JSON.parse(saved) : {};
      for (const u of cleanItems) {
        const key = u.id || u.rawNumber || u.number;
        customMap[key] = { lat: u.lat, lng: u.lng };
      }
      localStorage.setItem('itaipuacu_quadras_custom', JSON.stringify(customMap));
    } catch (e) {
      console.warn('Erro ao salvar no localStorage:', e);
    }

    // 2. Salva fisicamente e de forma definitiva no itaipuacuQuadras.json e itaipuacuQuadras.js
    try {
      const res = await fetch('/api/save-quadra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quadras: cleanItems }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (cleanItems.length === 1) {
          const label = cleanItems[0].rawNumber || cleanItems[0].number;
          showNotification(`Quadra #${label} salva oficialmente no JSON!`, 'success', 3500);
        } else {
          showNotification(`${cleanItems.length} quadras salvas oficialmente no JSON!`, 'success', 3500);
        }
        return true;
      }
      showNotification('Erro ao gravar no arquivo JSON do projeto.', 'error', 4000);
      return false;
    } catch (err) {
      console.warn('Erro ao salvar quadra via API:', err);
      showNotification('Posição salva localmente (servidor de gravação indisponível).', 'info', 3500);
      return true;
    }
  }, [showNotification]);

  // Adiciona uma nova quadra inserida pelo botão "Add Número" imediatamente no mapa e salva permanentemente
  const handleAddQuadra = useCallback(async (newQuadra) => {
    const cleanPayload = {
      id: newQuadra.id,
      number: newQuadra.number,
      rawNumber: newQuadra.rawNumber,
      lat: newQuadra.lat,
      lng: newQuadra.lng,
    };

    setQuadras(prev => {
      const exists = prev.some(
        q =>
          q.id === newQuadra.id ||
          (q.rawNumber === newQuadra.rawNumber &&
            Math.abs(q.lat - newQuadra.lat) < 0.0002 &&
            Math.abs(q.lng - newQuadra.lng) < 0.0002)
      );
      if (exists) return prev;
      return [...prev, { ...cleanPayload, isCustomAdded: true }];
    });

    // 1. Salva no localStorage (e garante que não conste na lista de excluídas)
    try {
      const addedSaved = localStorage.getItem('itaipuacu_quadras_added');
      const addedList = addedSaved ? JSON.parse(addedSaved) : [];
      if (!addedList.some(item => item.id === cleanPayload.id)) {
        addedList.push(cleanPayload);
        localStorage.setItem('itaipuacu_quadras_added', JSON.stringify(addedList));
      }

      const deletedSaved = localStorage.getItem('itaipuacu_quadras_deleted');
      if (deletedSaved) {
        const deletedList = JSON.parse(deletedSaved).filter(id => id !== cleanPayload.id);
        localStorage.setItem('itaipuacu_quadras_deleted', JSON.stringify(deletedList));
      }
    } catch (e) {
      console.warn('Erro ao salvar no localStorage:', e);
    }

    // 2. Salva fisicamente em itaipuacuQuadras.json e itaipuacuQuadras.js via API
    try {
      const res = await fetch('/api/save-quadra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanPayload),
      });
      const data = await res.json();
      if (data.success) {
        showNotification(`Quadra #${newQuadra.rawNumber || newQuadra.number} adicionada e salva permanentemente!`, 'success', 3500);
      }
    } catch (err) {
      console.warn('Erro ao salvar nova quadra via API:', err);
    }
  }, [showNotification]);

  // Exclui uma quadra do mapa imediatamente e remove do localStorage + itaipuacuQuadras.json/.js
  const handleDeleteQuadra = useCallback(async (targetQuadra) => {
    if (!targetQuadra) return;
    const label = targetQuadra.rawNumber || targetQuadra.number;

    setQuadras(prev => {
      const hasExactId = Boolean(targetQuadra.id && prev.some(q => q.id === targetQuadra.id));
      return prev.filter(q => {
        if (hasExactId) return q.id !== targetQuadra.id;
        return !(
          (q.rawNumber === targetQuadra.rawNumber || q.number === targetQuadra.number) &&
          Math.abs(q.lat - targetQuadra.lat) < 0.0005 &&
          Math.abs(q.lng - targetQuadra.lng) < 0.0005
        );
      });
    });

    // 1. Atualiza localStorage
    try {
      const addedSaved = localStorage.getItem('itaipuacu_quadras_added');
      if (addedSaved) {
        const filteredAdded = JSON.parse(addedSaved).filter(
          item => item.id !== targetQuadra.id
        );
        localStorage.setItem('itaipuacu_quadras_added', JSON.stringify(filteredAdded));
      }

      const customSaved = localStorage.getItem('itaipuacu_quadras_custom');
      if (customSaved) {
        const customMap = JSON.parse(customSaved);
        const key = targetQuadra.id || targetQuadra.rawNumber || targetQuadra.number;
        delete customMap[key];
        localStorage.setItem('itaipuacu_quadras_custom', JSON.stringify(customMap));
      }

      if (targetQuadra.id) {
        const deletedSaved = localStorage.getItem('itaipuacu_quadras_deleted');
        const deletedList = deletedSaved ? JSON.parse(deletedSaved) : [];
        if (!deletedList.includes(targetQuadra.id)) {
          deletedList.push(targetQuadra.id);
          localStorage.setItem('itaipuacu_quadras_deleted', JSON.stringify(deletedList));
        }
      }
    } catch (e) {
      console.warn('Erro ao atualizar localStorage na exclusão:', e);
    }

    // 2. Remove fisicamente do itaipuacuQuadras.json e itaipuacuQuadras.js via API
    try {
      const res = await fetch('/api/delete-quadra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: targetQuadra.id,
          number: targetQuadra.number,
          rawNumber: targetQuadra.rawNumber,
          lat: targetQuadra.lat,
          lng: targetQuadra.lng,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showNotification(`Quadra #${label} excluída permanentemente!`, 'info', 3000);
      } else {
        showNotification(`Quadra #${label} removida do mapa!`, 'info', 3000);
      }
    } catch (err) {
      console.warn('Erro ao excluir quadra via API:', err);
      showNotification(`Quadra #${label} removida do mapa!`, 'info', 3000);
    }
  }, [showNotification]);

  const handleClearRoute = () => {
    if (window.confirm('Deseja realmente limpar a rota atual e começar de novo?')) {
      setAddresses([]);
      setSelectedId(null);
      setGeocodingProgress(null);
      setActiveTab('upload');
      showNotification('Rota limpa com sucesso.', 'info');
    }
  };

  return (
    <div className="app-root">
      {/* Top Navbar */}
      <header className="app-topbar">
        <div className="topbar-brand">
          <div className="brand-logo-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
              <path d="M12 16v-4" />
              <path d="M12 16h4" />
            </svg>
          </div>
          <div className="brand-titles">
            <div className="brand-name-row">
              <span className="brand-name">Rota Scanner</span>
              <span className="brand-version-badge">Itaipuaçu</span>
            </div>
            <span className="brand-subtitle">Mapa de Loteamento & Rotas de Entrega</span>
          </div>
        </div>

        {/* Status ao Vivo de Entregas */}
        {addresses.length > 0 && (
          <div className="topbar-route-summary">
            <div className="summary-pill">
              <span className="summary-num">{addresses.length}</span>
              <span className="summary-lbl">paradas</span>
            </div>
            <div className="summary-pill success">
              <span className="summary-num">{addresses.filter(a => a.coordinates).length}</span>
              <span className="summary-lbl">no mapa</span>
            </div>
            {addresses.some(a => a.quadra || a.lote) && (
              <div className="summary-pill quadra">
                <span className="summary-num">{addresses.filter(a => a.quadra || a.lote).length}</span>
                <span className="summary-lbl">com Qd/Lt</span>
              </div>
            )}
          </div>
        )}

        {/* Ações da Barra Superior */}
        <div className="topbar-actions">
          {addresses.length > 0 && (
            <button
              type="button"
              className="btn-topbar-action danger"
              onClick={handleClearRoute}
              title="Limpar rota atual"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>Nova Rota</span>
            </button>
          )}

          {/* Toggle de recolher sidebar no desktop */}
          <button
            type="button"
            className="btn-topbar-action toggle-sidebar"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Expandir painel' : 'Recolher painel'}
          >
            {sidebarCollapsed ? 'Mostrar Painel ⮞' : 'Recolher Painel ⮜'}
          </button>
        </div>
      </header>

      {/* Segmented Control para Telas Mobile / Tablets Pequenos */}
      <div className="mobile-view-tabs">
        <button
          className={`mobile-tab-btn ${mobileView === 'map' ? 'active' : ''}`}
          onClick={() => setMobileView('map')}
        >
          <span className="tab-icon">🗺️</span>
          <span>Mapa {addresses.length > 0 ? `(${addresses.filter(a => a.coordinates).length})` : ''}</span>
        </button>
        <button
          className={`mobile-tab-btn ${mobileView === 'sidebar' ? 'active' : ''}`}
          onClick={() => setMobileView('sidebar')}
        >
          <span className="tab-icon">📋</span>
          <span>Entregas ({addresses.length})</span>
        </button>
      </div>

      {/* Notificação Toast */}
      {notification && (
        <div className={`toast-banner ${notification.type}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {notification.type === 'success' && '✓'}
              {notification.type === 'error' && '✕'}
              {notification.type === 'info' && 'ℹ'}
            </span>
            <span className="toast-text">{notification.message}</span>
          </div>
          <button className="toast-close" onClick={() => setNotification(null)} aria-label="Fechar">
            ✕
          </button>
        </div>
      )}

      {/* Layout Principal: Painel Lateral + Seção do Mapa */}
      <main className={`app-workspace ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''} mobile-${mobileView}`}>
        {/* Painel Lateral */}
        <aside className="workspace-sidebar">
          {/* Navegação por Abas do Painel */}
          <div className="sidebar-tabs-nav">
            <button
              type="button"
              className={`sidebar-nav-tab ${activeTab === 'deliveries' ? 'active' : ''}`}
              onClick={() => setActiveTab('deliveries')}
            >
              <span>📋 Entregas</span>
              {addresses.length > 0 && (
                <span className="tab-counter-badge">{addresses.length}</span>
              )}
            </button>
            <button
              type="button"
              className={`sidebar-nav-tab ${activeTab === 'upload' ? 'active' : ''}`}
              onClick={() => setActiveTab('upload')}
            >
              <span>📥 Planilha</span>
            </button>
          </div>

          {/* Conteúdo da Aba Ativa */}
          <div className="sidebar-tab-content">
            {activeTab === 'deliveries' && (
              addresses.length > 0 ? (
                <AddressList
                  addresses={addresses}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                  onRemove={handleRemove}
                  onSelectQuadra={handleSelectQuadra}
                  geocodingProgress={geocodingProgress}
                />
              ) : (
                <div className="empty-deliveries-state">
                  <div className="empty-state-icon">📋</div>
                  <h4>Nenhuma entrega carregada</h4>
                  <p>As {quadras.length} quadras de Itaipuaçu já estão ativas no mapa ao lado! Importe uma planilha para traçar sua rota.</p>
                  <button 
                    className="btn-go-import" 
                    onClick={() => setActiveTab('upload')}
                  >
                    Importar Planilha de Entregas ➔
                  </button>
                </div>
              )
            )}

            {activeTab === 'upload' && (
              <FileUpload
                onAddressesLoaded={handleAddressesLoaded}
                onError={handleFileError}
              />
            )}
          </div>

          {/* Rodapé do Painel (Reprocessar / Cache) */}
          {activeTab === 'deliveries' && addresses.length > 0 && addresses.some(a => !a.coordinates) && (
            <div className="sidebar-docked-footer">
              <button
                className="btn-docked-footer"
                onClick={handleRetryGeocoding}
                disabled={isGeocoding}
              >
                🔄 Reprocessar pendentes ({addresses.filter(a => !a.coordinates).length})
              </button>
              <button
                className="btn-docked-footer secondary"
                onClick={() => {
                  clearCache();
                  handleRetryGeocoding();
                }}
                disabled={isGeocoding}
              >
                Limpar cache e reprocessar tudo
              </button>
            </div>
          )}
        </aside>

        {/* Seção do Mapa (Visualização Principal) */}
        <section className="workspace-map-section">
          <MapView
            addresses={addresses}
            selectedId={selectedId}
            onSelect={handleSelect}
            center={mapCenter}
            zoom={mapZoom}
            quadras={quadras}
            onUpdateQuadra={handleUpdateQuadra}
            onAddQuadra={handleAddQuadra}
            onDeleteQuadra={handleDeleteQuadra}
          />
        </section>
      </main>
    </div>
  );
}

export default App;
