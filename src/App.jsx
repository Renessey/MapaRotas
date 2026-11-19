import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import FileUpload from './components/FileUpload';
import AddressList from './components/AddressList';
import DeliveryHistory from './components/DeliveryHistory';
import MapView from './components/MapView';
import { geocodeAddresses, clearCache, findItaipuacuQuadra } from './utils/geocoding';
import { groupDeliveryAddressesForMap } from './utils/addressGrouping';
import itaipuacuQuadras from './data/itaipuacuQuadras.json';
import './App.css';

const ACTIVE_ROUTE_STORAGE_KEY = 'rota_scanner_active_route';
const DELIVERY_OVERRIDES_STORAGE_KEY = 'rota_scanner_delivery_overrides';

function getStopOverrideKey(addr) {
  if (!addr) return null;
  const oid = String(addr.orderId || '').trim();
  const hasRealOrderId = oid && !/^(PED|SHOPEE)-\d+$/i.test(oid);
  if (hasRealOrderId) return `order:${oid.toUpperCase()}`;
  const streetPart = String(addr.street || '').trim().toLowerCase();
  const recipientPart = String(addr.recipient || '').trim().toLowerCase();
  const qPart = String(addr.quadra || '').trim().toUpperCase();
  const lPart = String(addr.lote || '').trim().toUpperCase();
  if (!streetPart && !recipientPart) return null;
  return `addr:${streetPart}|${recipientPart}|${qPart}|${lPart}`;
}

function readSavedActiveRoute() {
  try {
    const raw = localStorage.getItem(ACTIVE_ROUTE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.addresses) && parsed.addresses.length > 0) {
      return parsed;
    }
  } catch (e) {
    console.warn('Erro ao restaurar rota ativa do localStorage:', e);
  }
  return null;
}

function loadDeliveryOverrides() {
  try {
    const raw = localStorage.getItem(DELIVERY_OVERRIDES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDeliveryOverride(addr, coords) {
  const key = getStopOverrideKey(addr);
  if (!key || !coords) return;
  try {
    const map = loadDeliveryOverrides();
    map[key] = { lat: coords.lat, lng: coords.lng };
    localStorage.setItem(DELIVERY_OVERRIDES_STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('Erro ao salvar posição ajustada da entrega:', e);
  }
}

function removeDeliveryOverride(addr) {
  const key = getStopOverrideKey(addr);
  if (!key) return;
  try {
    const map = loadDeliveryOverrides();
    if (key in map) {
      delete map[key];
      localStorage.setItem(DELIVERY_OVERRIDES_STORAGE_KEY, JSON.stringify(map));
    }
  } catch (e) {
    console.warn('Erro ao remover posição ajustada da entrega:', e);
  }
}

function buildUpdatedFullAddress(addr) {
  let full = addr.street || '';
  if (addr.number) full += `, ${addr.number}`;
  if (addr.quadra) full += `, Qd ${addr.quadra}`;
  if (addr.lote) full += `, Lt ${addr.lote}`;
  if (addr.complement) full += `, ${addr.complement}`;
  if (addr.neighborhood) full += `, ${addr.neighborhood}`;
  if (addr.city) full += `, ${addr.city}`;
  if (addr.state) full += `, ${addr.state}`;
  if (addr.zipCode) full += `, CEP: ${addr.zipCode}`;
  return full;
}

function App() {
  const [savedInitialRoute] = useState(() => readSavedActiveRoute());
  const [addresses, setAddresses] = useState(() => savedInitialRoute?.addresses || []);
  const [selectedId, setSelectedId] = useState(() => savedInitialRoute?.addresses?.[0]?.originalRow || null);
  const [geocodingProgress, setGeocodingProgress] = useState(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [importedSpreadsheet, setImportedSpreadsheet] = useState(() => savedInitialRoute?.importedSpreadsheet || null);
  const [routeVersion, setRouteVersion] = useState(() => (savedInitialRoute?.addresses?.length ? 1 : 0));
  const [notification, setNotification] = useState(null);
  const [mapCenter, setMapCenter] = useState(null);
  const [mapZoom, setMapZoom] = useState(null);
  const [quadraHighlightRequest, setQuadraHighlightRequest] = useState(null);
  const routeSessionRef = useRef(0);
  const geocodeAbortRef = useRef(null);
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
  // Abas do painel lateral: 'deliveries' | 'history' | 'upload'
  const [activeTab, setActiveTab] = useState(() =>
    savedInitialRoute?.addresses?.length ? 'deliveries' : 'upload'
  );
  // Visualização mobile: 'map' | 'sidebar'
  const [mobileView, setMobileView] = useState('map');
  // Painel lateral recolhido no desktop
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Persiste a rota importada e as posições ajustadas dos pinos no localStorage
  useEffect(() => {
    try {
      if (addresses.length > 0) {
        localStorage.setItem(
          ACTIVE_ROUTE_STORAGE_KEY,
          JSON.stringify({ addresses, importedSpreadsheet })
        );
      } else {
        localStorage.removeItem(ACTIVE_ROUTE_STORAGE_KEY);
      }
    } catch (e) {
      console.warn('Erro ao salvar rota ativa no localStorage:', e);
    }
  }, [addresses, importedSpreadsheet]);

  // Sincroniza qualquer customização ou quadras salvas no localStorage do PC diretamente no banco SQLite
  useEffect(() => {
    // Carrega a base atualizada diretamente do banco SQLite na inicialização
    fetch('/api/pontos?limit=3000')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.success && Array.isArray(data.quadras) && data.quadras.length > 0) {
          setQuadras(data.quadras);
        }
      })
      .catch((e) => console.warn('Aviso ao carregar quadras do SQLite:', e));
  }, []);

  useEffect(() => {
    try {
      const hasCustom = localStorage.getItem('itaipuacu_quadras_custom');
      const hasAdded = localStorage.getItem('itaipuacu_quadras_added');
      const hasDeleted = localStorage.getItem('itaipuacu_quadras_deleted');

      // Se houver qualquer customização local no navegador, sincroniza a base completa atual para o banco SQLite
      if (hasCustom || hasAdded || hasDeleted) {
        fetch('/api/sync-all-quadras', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quadras }),
        }).catch((e) => console.warn('Erro ao sincronizar quadras com banco SQLite:', e));
      }
    } catch (e) {
      console.warn('Erro ao verificar sincronização de quadras:', e);
    }
  }, [quadras]);

  const showNotification = useCallback((message, type = 'info', timeout = 4000) => {
    setNotification({ message, type });
    if (timeout) {
      setTimeout(() => setNotification(null), timeout);
    }
  }, []);

  const handleAddressesLoaded = useCallback(async (newAddresses, fileType = 'auto', fileName = '') => {
    if (geocodeAbortRef.current) {
      geocodeAbortRef.current.abort();
    }
    const controller = new AbortController();
    geocodeAbortRef.current = controller;
    const sessionId = ++routeSessionRef.current;

    const resolvedName =
      fileName || (fileType === 'demo' ? 'Exemplo (Itaipuaçu)' : 'Planilha importada');
    setImportedSpreadsheet({
      name: resolvedName,
      count: newAddresses.length,
      type: fileType,
    });
    setRouteVersion(v => v + 1);

    const overridesMap = loadDeliveryOverrides();

    // Para endereços que já possuem ajuste manual salvo ou Quadra informada sem coordenadas,
    // aplica o posicionamento correspondente antes de consultar o servidor OSM
    const prelocatedAddresses = newAddresses.map(addr => {
      let baseAddr = addr;
      if (!addr.coordinates && addr.quadra) {
        const qMatch = findItaipuacuQuadra(addr.quadra);
        if (qMatch) {
          baseAddr = {
            ...addr,
            coordinates: { lat: qMatch.lat, lng: qMatch.lng },
            geocoded: true,
            isQuadraLocated: true,
          };
        }
      }

      const overrideKey = getStopOverrideKey(baseAddr);
      const savedOverride = overrideKey ? overridesMap[overrideKey] : null;
      if (savedOverride && typeof savedOverride.lat === 'number' && typeof savedOverride.lng === 'number') {
        return {
          ...baseAddr,
          originalCoordinates: baseAddr.coordinates ? { ...baseAddr.coordinates } : null,
          coordinates: { lat: savedOverride.lat, lng: savedOverride.lng },
          geocoded: true,
          isManuallyAdjusted: true,
        };
      }

      return baseAddr;
    });

    setAddresses(prelocatedAddresses);
    setSelectedId(prelocatedAddresses[0]?.originalRow || null);
    setMapCenter(null);
    setMapZoom(null);
    clearCache();

    // Ativa automaticamente a aba de entregas
    setActiveTab('deliveries');
    setMobileView('map');

    const needsGeocoding = prelocatedAddresses.filter(
      a => !a.isManuallyAdjusted && (!a.coordinates || a.isQuadraLocated)
    );
    const alreadyGeocoded = prelocatedAddresses.filter(
      a => a.coordinates && (!a.isQuadraLocated || a.isManuallyAdjusted)
    ).length;

    if (needsGeocoding.length === 0) {
      setIsGeocoding(false);
      setGeocodingProgress(null);
      if (alreadyGeocoded > 0) {
        showNotification(`${alreadyGeocoded} endereços carregados com coordenadas prontas!`, 'success');
      }
      return;
    }

    showNotification(`${newAddresses.length} endereços importados. Você já pode arrastar qualquer pino no mapa!`, 'info', 3500);
    setIsGeocoding(true);
    setGeocodingProgress({ current: 0, total: needsGeocoding.length, currentAddress: null });

    try {
      const geocodedAddresses = await geocodeAddresses(
        needsGeocoding,
        (current, total, currentAddress) => {
          if (sessionId === routeSessionRef.current) {
            setGeocodingProgress({ current, total, currentAddress });
          }
        },
        controller.signal
      );

      if (sessionId !== routeSessionRef.current || controller.signal.aborted) {
        return;
      }

      // Usa atualização funcional para preservar pinos arrastados manualmente durante a geocodificação
      setAddresses(prev =>
        prev.map(addr => {
          if (addr.isManuallyAdjusted) return addr;
          const updated = geocodedAddresses.find(g => g.originalRow === addr.originalRow);
          if (updated && updated.coordinates) return updated;
          return addr;
        })
      );
      setGeocodingProgress(null);
      const newlyLocated = geocodedAddresses.filter(a => a.coordinates).length + alreadyGeocoded;
      showNotification(`${newlyLocated} de ${prelocatedAddresses.length} paradas posicionadas no mapa de Itaipuaçu!`, 'success');
    } catch (err) {
      if (sessionId === routeSessionRef.current) {
        showNotification('Erro durante a geocodificação: ' + err.message, 'error', 6000);
        setGeocodingProgress(null);
      }
    } finally {
      if (sessionId === routeSessionRef.current) {
        setIsGeocoding(false);
      }
    }
  }, [showNotification]);

  const handleFileError = useCallback((err) => {
    showNotification(err, 'error', 5000);
  }, [showNotification]);

  const handleSelect = useCallback((id, options = {}) => {
    const { pan = true } = options;
    setSelectedId(id);
    if (!pan) return;
    const address = addresses.find(a => a.originalRow === id);
    if (address?.coordinates) {
      setMapCenter([address.coordinates.lat, address.coordinates.lng]);
      setMapZoom(17);
      setMobileView('map');
    }
  }, [addresses]);

  const handleSelectQuadra = useCallback((quadraStr) => {
    if (!quadraStr) return;
    setQuadraHighlightRequest((prev) => ({
      term: String(quadraStr),
      seq: (prev?.seq || 0) + 1,
    }));
    setMobileView('map');
    showNotification(`Destacando Quadra ${quadraStr} sem mover sua tela`, 'info', 2500);
  }, [showNotification]);

  // Agrupa pacotes para o mesmo endereço em pinos únicos no mapa
  const groupedStops = useMemo(() => groupDeliveryAddressesForMap(addresses), [addresses]);

  // Separa pacotes pendentes (Entregas) e pacotes já entregues (Histórico)
  const pendingAddresses = useMemo(
    () => addresses.filter((a) => !a.delivered),
    [addresses]
  );
  const deliveredAddresses = useMemo(
    () => addresses.filter((a) => Boolean(a.delivered)),
    [addresses]
  );

  // Marca entrega como concluída (movendo para Histórico e deixando pino cinza no mapa) ou desfaz
  const handleConfirmDelivery = useCallback((targetRows, delivered = true) => {
    const rowSet = new Set(Array.isArray(targetRows) ? targetRows : [targetRows]);
    if (rowSet.size === 0) return;

    const matchedGroup = groupedStops.find((g) => g.rowIds.some((r) => rowSet.has(r)));
    const nowIso = delivered ? new Date().toISOString() : null;
    const affectedRows = [];

    setAddresses((prev) =>
      prev.map((addr) => {
        if (!rowSet.has(addr.originalRow)) return addr;
        affectedRows.push(addr.originalRow);
        return {
          ...addr,
          delivered: Boolean(delivered),
          deliveredAt: delivered ? nowIso : null,
        };
      })
    );

    const rowsList = affectedRows.length > 0 ? affectedRows : Array.from(rowSet);
    const rowsLabel = rowsList.slice(0, 4).map((r) => `#${r}`).join(', ') +
      (rowsList.length > 4 ? ` +${rowsList.length - 4}` : '');
    const count = rowsList.length;

    if (delivered) {
      const pinInfo = matchedGroup ? `Pino #${matchedGroup.stopNumber} (${rowsLabel})` : rowsLabel;
      showNotification(
        count > 1
          ? `✓ ${count} pacotes entregues — ${pinInfo} movidos para Histórico!`
          : `✓ Entrega ${rowsLabel} concluída e movida para Histórico!`,
        'success',
        3500
      );
    } else {
      showNotification(
        count > 1
          ? `↩️ ${count} pacotes (${rowsLabel}) reabertos na lista de Entregas.`
          : `↩️ Entrega ${rowsLabel} movida de volta para Entregas.`,
        'info',
        3000
      );
    }
  }, [groupedStops, showNotification]);

  // Atualiza posição (ao arrastar, aceitando 1 ou múltiplos pacotes do mesmo pino) ou dados editados
  const handleUpdateAddress = useCallback((targetRows, updates, silentToast = false) => {
    const rowSet = new Set(Array.isArray(targetRows) ? targetRows : [targetRows]);
    let targetGroupLabel = '';
    let matchedCount = 0;
    let actionKind = 'edit';

    const matchedGroup = groupedStops.find(g => g.rowIds.some(r => rowSet.has(r)));
    if (matchedGroup) {
      targetGroupLabel = `#${matchedGroup.stopNumber}`;
    }

    setAddresses(prev =>
      prev.map((addr, idx) => {
        if (!rowSet.has(addr.originalRow)) return addr;
        matchedCount += 1;
        if (!targetGroupLabel) targetGroupLabel = `#${idx + 1}`;

        if (updates.restoreOriginal && addr.originalCoordinates) {
          actionKind = 'restore';
          removeDeliveryOverride(addr);
          return {
            ...addr,
            coordinates: { ...addr.originalCoordinates },
            isManuallyAdjusted: false,
            geocoded: true,
            error: null,
          };
        }

        const nextCoords = updates.coordinates
          ? {
              lat: Number(updates.coordinates.lat),
              lng: Number(updates.coordinates.lng),
            }
          : addr.coordinates;

        const hasValidNewCoords =
          nextCoords && !isNaN(nextCoords.lat) && !isNaN(nextCoords.lng);

        const coordsChanged = Boolean(updates.coordinates && hasValidNewCoords);
        const originalCoords =
          addr.originalCoordinates ||
          (addr.coordinates && !addr.isManuallyAdjusted ? { ...addr.coordinates } : null);

        const nextAddr = {
          ...addr,
          recipient: updates.recipient !== undefined ? updates.recipient : addr.recipient,
          street: updates.street !== undefined ? updates.street : addr.street,
          number: updates.number !== undefined ? updates.number : addr.number,
          quadra: updates.quadra !== undefined ? updates.quadra : addr.quadra,
          lote: updates.lote !== undefined ? updates.lote : addr.lote,
          complement: updates.complement !== undefined ? updates.complement : addr.complement,
          neighborhood: updates.neighborhood !== undefined ? updates.neighborhood : addr.neighborhood,
          phone: updates.phone !== undefined ? updates.phone : addr.phone,
          coordinates: hasValidNewCoords ? nextCoords : addr.coordinates,
          originalCoordinates: originalCoords,
          geocoded: hasValidNewCoords ? true : addr.geocoded,
          error: hasValidNewCoords ? null : addr.error,
          isManuallyAdjusted:
            updates.isManuallyAdjusted !== undefined
              ? updates.isManuallyAdjusted
              : coordsChanged
                ? true
                : addr.isManuallyAdjusted,
        };

        nextAddr.hasQuadraLote = Boolean(nextAddr.quadra || nextAddr.lote);
        nextAddr.fullAddress = buildUpdatedFullAddress(nextAddr);

        if (coordsChanged && hasValidNewCoords) {
          actionKind = 'move';
          saveDeliveryOverride(addr, nextCoords);
          if (getStopOverrideKey(nextAddr) !== getStopOverrideKey(addr)) {
            saveDeliveryOverride(nextAddr, nextCoords);
          }
        }

        return nextAddr;
      })
    );

    if (!silentToast && matchedCount > 0) {
      let msg = '';
      if (actionKind === 'restore') {
        msg = `Pino ${targetGroupLabel} restaurado para a posição original.`;
      } else if (actionKind === 'move') {
        msg =
          matchedCount > 1
            ? `Pino ${targetGroupLabel} (${matchedCount} pacotes) posicionado no local escolhido!`
            : `Pino ${targetGroupLabel} posicionado no local escolhido!`;
      } else {
        msg = `Dados da Parada ${targetGroupLabel} atualizados!`;
      }
      showNotification(msg, 'success', 2500);
    }
  }, [groupedStops, showNotification]);

  const handleRemove = useCallback((id) => {
    const remaining = addresses.filter(a => a.originalRow !== id);
    setAddresses(remaining);
    if (selectedId === id) {
      setSelectedId(remaining[0]?.originalRow || null);
    }
    if (remaining.length === 0) {
      if (geocodeAbortRef.current) {
        geocodeAbortRef.current.abort();
      }
      routeSessionRef.current += 1;
      setImportedSpreadsheet(null);
      setGeocodingProgress(null);
      setIsGeocoding(false);
    } else {
      setImportedSpreadsheet(prev => (prev ? { ...prev, count: remaining.length } : prev));
    }
  }, [addresses, selectedId]);

  const handleRemoveSpreadsheet = useCallback(() => {
    if (geocodeAbortRef.current) {
      geocodeAbortRef.current.abort();
      geocodeAbortRef.current = null;
    }
    routeSessionRef.current += 1;
    setAddresses([]);
    setSelectedId(null);
    setGeocodingProgress(null);
    setIsGeocoding(false);
    setImportedSpreadsheet(null);
    setMapCenter(null);
    setMapZoom(null);
    setActiveTab('upload');
    showNotification('Planilha importada removida com sucesso.', 'info', 3500);
  }, [showNotification]);

  const handleRetryGeocoding = useCallback(async () => {
    const failedAddresses = addresses.filter(
      a => !a.isManuallyAdjusted && (a.error || (!a.geocoded && !a.coordinates))
    );
    if (failedAddresses.length === 0) {
      showNotification('Todos os endereços já estão geocodificados!', 'info');
      return;
    }

    if (geocodeAbortRef.current) {
      geocodeAbortRef.current.abort();
    }
    const controller = new AbortController();
    geocodeAbortRef.current = controller;
    const sessionId = routeSessionRef.current;

    setIsGeocoding(true);
    setGeocodingProgress({ current: 0, total: failedAddresses.length, currentAddress: null });

    try {
      const geocodedFailed = await geocodeAddresses(
        failedAddresses,
        (current, total, currentAddress) => {
          if (sessionId === routeSessionRef.current) {
            setGeocodingProgress({ current, total, currentAddress });
          }
        },
        controller.signal
      );

      if (sessionId !== routeSessionRef.current || controller.signal.aborted) {
        return;
      }

      setAddresses(prev => prev.map(addr => {
        if (addr.isManuallyAdjusted) return addr;
        const updated = geocodedFailed.find(g => g.originalRow === addr.originalRow);
        return updated || addr;
      }));
      setGeocodingProgress(null);
      showNotification('Geocodificação concluída!', 'success');
    } catch (err) {
      if (sessionId === routeSessionRef.current) {
        showNotification('Erro ao reprocessar: ' + err.message, 'error');
        setGeocodingProgress(null);
      }
    } finally {
      if (sessionId === routeSessionRef.current) {
        setIsGeocoding(false);
      }
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

    // 2. Salva fisicamente e de forma definitiva no banco SQLite (com espelho de backup)
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
          showNotification(`Quadra #${label} salva oficialmente no banco SQLite!`, 'success', 3500);
        } else {
          showNotification(`${cleanItems.length} quadras salvas oficialmente no banco SQLite!`, 'success', 3500);
        }
        return true;
      }
      showNotification('Erro ao gravar no banco SQLite do projeto.', 'error', 4000);
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
              <span className="summary-num">{pendingAddresses.length}</span>
              <span className="summary-lbl">pendentes</span>
            </div>
            {deliveredAddresses.length > 0 && (
              <button
                type="button"
                className="summary-pill delivered clickable"
                onClick={() => setActiveTab('history')}
                title="Abrir tabela de histórico de entregas concluídas"
              >
                <span className="summary-num">{deliveredAddresses.length}</span>
                <span className="summary-lbl">entregues</span>
              </button>
            )}
            <div className="summary-pill success">
              <span className="summary-num">{groupedStops.length}</span>
              <span className="summary-lbl">pinos no mapa</span>
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
              onClick={handleRemoveSpreadsheet}
              title="Remover planilha importada e limpar rota atual"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>Remover Planilha</span>
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
          <span>Mapa {groupedStops.length > 0 ? `(${groupedStops.length})` : ''}</span>
        </button>
        <button
          className={`mobile-tab-btn ${mobileView === 'sidebar' && activeTab !== 'history' ? 'active' : ''}`}
          onClick={() => {
            if (activeTab === 'history') setActiveTab('deliveries');
            setMobileView('sidebar');
          }}
        >
          <span className="tab-icon">📋</span>
          <span>Entregas ({pendingAddresses.length})</span>
        </button>
        {addresses.length > 0 && (
          <button
            className={`mobile-tab-btn ${mobileView === 'sidebar' && activeTab === 'history' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('history');
              setMobileView('sidebar');
            }}
          >
            <span className="tab-icon">✅</span>
            <span>Histórico ({deliveredAddresses.length})</span>
          </button>
        )}
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
              {pendingAddresses.length > 0 && (
                <span className="tab-counter-badge">{pendingAddresses.length}</span>
              )}
            </button>
            <button
              type="button"
              className={`sidebar-nav-tab ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              <span>✅ Histórico</span>
              {deliveredAddresses.length > 0 && (
                <span className="tab-counter-badge green">{deliveredAddresses.length}</span>
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
              pendingAddresses.length > 0 ? (
                <AddressList
                  addresses={pendingAddresses}
                  totalPackages={addresses.length}
                  deliveredCount={deliveredAddresses.length}
                  groupedStops={groupedStops}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                  onRemove={handleRemove}
                  onSelectQuadra={handleSelectQuadra}
                  onConfirmDelivery={handleConfirmDelivery}
                  onOpenHistory={() => setActiveTab('history')}
                  geocodingProgress={geocodingProgress}
                  importedSpreadsheet={importedSpreadsheet}
                  onRemoveSpreadsheet={handleRemoveSpreadsheet}
                />
              ) : addresses.length > 0 ? (
                <div className="empty-deliveries-state">
                  <div className="empty-state-icon">🎉</div>
                  <h4>Todas as {addresses.length} entregas foram concluídas!</h4>
                  <p>Todos os pacotes da rota atual estão confirmados e listados no Histórico ao lado.</p>
                  <button
                    type="button"
                    className="btn-go-import success"
                    onClick={() => setActiveTab('history')}
                  >
                    Ver Histórico ({deliveredAddresses.length}) ➔
                  </button>
                </div>
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

            {activeTab === 'history' && (
              <DeliveryHistory
                deliveredAddresses={deliveredAddresses}
                totalAddresses={addresses.length}
                groupedStops={groupedStops}
                selectedId={selectedId}
                onSelect={handleSelect}
                onSelectQuadra={handleSelectQuadra}
                onConfirmDelivery={handleConfirmDelivery}
                onOpenDeliveries={() => setActiveTab('deliveries')}
              />
            )}

            {activeTab === 'upload' && (
              <FileUpload
                onAddressesLoaded={handleAddressesLoaded}
                onError={handleFileError}
                importedSpreadsheet={importedSpreadsheet}
                onRemoveSpreadsheet={handleRemoveSpreadsheet}
              />
            )}
          </div>

          {/* Rodapé do Painel (Reprocessar / Cache) */}
          {activeTab === 'deliveries' && pendingAddresses.length > 0 && pendingAddresses.some(a => !a.coordinates) && (
            <div className="sidebar-docked-footer">
              <button
                className="btn-docked-footer"
                onClick={handleRetryGeocoding}
                disabled={isGeocoding}
              >
                🔄 Reprocessar pendentes ({pendingAddresses.filter(a => !a.coordinates).length})
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
            groupedStops={groupedStops}
            routeVersion={routeVersion}
            selectedId={selectedId}
            onSelect={handleSelect}
            center={mapCenter}
            zoom={mapZoom}
            quadras={quadras}
            onUpdateQuadra={handleUpdateQuadra}
            onAddQuadra={handleAddQuadra}
            onDeleteQuadra={handleDeleteQuadra}
            onUpdateAddress={handleUpdateAddress}
            onConfirmDelivery={handleConfirmDelivery}
            quadraHighlightRequest={quadraHighlightRequest}
          />
        </section>
      </main>
    </div>
  );
}

export default App;
