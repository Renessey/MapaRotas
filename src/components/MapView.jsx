import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import itaipuacuQuadras from '../data/itaipuacuQuadras.json';
import './MapView.css';

// Cria ícones SVG para as paradas numeradas da rota
function createCustomPin({ number, isStart, isEnd, isSelected, hasQuadraLote }) {
  let bgClass = 'pin-normal';
  const label = String(number);

  if (isStart) {
    bgClass = 'pin-start';
  } else if (isEnd) {
    bgClass = 'pin-end';
  } else if (hasQuadraLote) {
    bgClass = 'pin-quadra';
  }

  const selectedClass = isSelected ? 'pin-selected' : '';

  const html = `
    <div class="custom-marker-wrapper ${selectedClass}">
      <div class="custom-marker-pin ${bgClass}">
        <span class="custom-marker-text">${label}</span>
      </div>
      <div class="custom-marker-shadow"></div>
      ${isSelected ? '<div class="custom-marker-pulse"></div>' : ''}
    </div>
  `;

  return L.divIcon({
    className: 'custom-div-icon',
    html: html,
    iconSize: isSelected ? [36, 46] : [30, 40],
    iconAnchor: isSelected ? [18, 46] : [15, 40],
    popupAnchor: [0, -42],
  });
}

// Formata números de quadras: 01 a 09 mantêm o zero na frente (ex: 01, 09), 10 em diante não têm zero na frente (ex: 27, 40, 51)
function formatQuadraNumber(str) {
  if (!str) return '';
  const match = String(str).trim().match(/^0*(\d+)([A-Za-z]?)$/);
  if (!match) return String(str).trim();
  const numInt = parseInt(match[1], 10);
  const suffix = (match[2] || '').toUpperCase();
  if (numInt >= 1 && numInt <= 9) {
    return `0${numInt}${suffix}`;
  }
  return `${numInt}${suffix}`;
}

// Cache de instâncias L.divIcon para reaproveitamento e alta performance a 60 FPS
const quadraIconCache = new Map();

function getCachedQuadraIcon(quadra, hasDelivery, isHighlighted, isDraggable, isPendingSave = false) {
  const label = formatQuadraNumber(quadra.rawNumber || quadra.number);
  const key = `${label}-${hasDelivery ? 'd' : ''}-${isHighlighted ? 'h' : ''}-${isDraggable ? 'g' : ''}-${isPendingSave ? 'p' : ''}`;
  let icon = quadraIconCache.get(key);
  if (!icon) {
    const deliveryClass = hasDelivery ? 'has-delivery' : '';
    const highlightClass = isHighlighted ? 'is-highlighted' : '';
    const draggableClass = isDraggable ? 'is-draggable' : '';
    const pendingClass = isPendingSave ? 'is-pending-save' : '';

    const html = `
      <div class="quadra-marker-box ${deliveryClass} ${highlightClass} ${draggableClass} ${pendingClass}">
        ${isDraggable ? '<span class="drag-handle-dot">⠿</span>' : ''}
        <span class="quadra-marker-num">${label}</span>
        ${hasDelivery ? '<span class="delivery-indicator-dot"></span>' : ''}
      </div>
    `;

    icon = L.divIcon({
      className: 'quadra-div-icon',
      html: html,
      iconSize: isDraggable || isPendingSave ? [46, 24] : [36, 20],
      iconAnchor: isDraggable || isPendingSave ? [23, 12] : [18, 10],
      popupAnchor: [0, -14],
    });
    quadraIconCache.set(key, icon);
  }
  return icon;
}

// Componente para sincronizar visão, animação e redimensionamento do Leaflet
function MapController({ center, zoom, addresses, onMapReady }) {
  const map = useMap();
  const prevCenterRef = useRef(null);

  useEffect(() => {
    if (onMapReady) {
      onMapReady(map);
    }
  }, [map, onMapReady]);

  // Invalidar tamanho caso a tela ou container mude de dimensão
  useEffect(() => {
    const handleResize = () => {
      map.invalidateSize();
    };

    window.addEventListener('resize', handleResize);
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, [map]);

  // Se um centro e zoom específicos foram solicitados
  useEffect(() => {
    if (center && center.length === 2 && !isNaN(center[0]) && !isNaN(center[1])) {
      const isDifferent = !prevCenterRef.current || 
        prevCenterRef.current[0] !== center[0] || 
        prevCenterRef.current[1] !== center[1];
        
      if (isDifferent) {
        prevCenterRef.current = center;
        map.flyTo(center, zoom || 17, {
          duration: 1.0,
          easeLinearity: 0.25,
        });
      }
    }
  }, [center, zoom, map]);

  // FitBounds inicial quando os endereços são carregados
  useEffect(() => {
    if (!center && addresses && addresses.length > 0) {
      const validCoords = addresses
        .filter(a => a.coordinates && !isNaN(a.coordinates.lat) && !isNaN(a.coordinates.lng))
        .map(a => [a.coordinates.lat, a.coordinates.lng]);

      if (validCoords.length > 1) {
        map.fitBounds(validCoords, { padding: [60, 60], maxZoom: 16 });
      } else if (validCoords.length === 1) {
        map.setView(validCoords[0], 16);
      }
    }
  }, [addresses, center, map]);

  return null;
}

// Seleciona todas as quadras da tela visível + margem de rolagem sem esconder blocos no zoom de trabalho
function selectVisibleQuadras(map, cleanQuadras, deliveryQuadrasMap, highlightedQuadra, selectedKey) {
  const zoom = map.getZoom();
  const viewBounds = map.getBounds();
  const center = map.getCenter();

  // Margem ao redor da tela para rolar o mapa com visibilidade imediata
  const padFactor = zoom >= 16 ? 0.38 : zoom >= 14.5 ? 0.26 : zoom >= 13.5 ? 0.22 : 0.15;
  const paddedBounds = viewBounds.pad(padFactor);

  const halfLat = Math.max((viewBounds.getNorth() - viewBounds.getSouth()) / 2, 0.0005);
  const halfLng = Math.max((viewBounds.getEast() - viewBounds.getWest()) / 2, 0.0005);

  const alwaysItems = [];
  const inViewItems = [];
  const inBufferItems = [];

  for (let i = 0; i < cleanQuadras.length; i++) {
    const q = cleanQuadras[i];
    const hasDelivery =
      deliveryQuadrasMap.has(q._numInt) ||
      deliveryQuadrasMap.has(q.rawNumber) ||
      deliveryQuadrasMap.has(q._label);
    const isHighlighted = Boolean(
      highlightedQuadra &&
        (highlightedQuadra === q.number ||
          highlightedQuadra === q.rawNumber ||
          highlightedQuadra === q._label)
    );
    const isSelected = Boolean(selectedKey && selectedKey === q._key);

    if (hasDelivery || isHighlighted || isSelected || q.isCustomAdded || q.isPendingSave) {
      alwaysItems.push({ q, hasDelivery, isHighlighted, isSelected, normDist: 0 });
      continue;
    }

    if (viewBounds.contains([q.lat, q.lng])) {
      inViewItems.push({ q, hasDelivery: false, isHighlighted: false, isSelected: false, normDist: 0 });
    } else if (paddedBounds.contains([q.lat, q.lng])) {
      const normDist = Math.max(
        Math.abs(q.lat - center.lat) / halfLat,
        Math.abs(q.lng - center.lng) / halfLng
      );
      inBufferItems.push({ q, hasDelivery: false, isHighlighted: false, isSelected: false, normDist });
    }
  }

  // Zoom >= 14.5 (15+): mostra 100% de TODAS as quadras visíveis na tela (nenhum lote escondido!)
  if (zoom >= 14.5) {
    const MAX_TOTAL = 800;
    const totalNeeded = alwaysItems.length + inViewItems.length + inBufferItems.length;
    if (totalNeeded <= MAX_TOTAL) {
      return {
        items: alwaysItems.concat(inViewItems, inBufferItems),
        paddedBounds,
        zoom,
      };
    }

    // Garante 100% do que está dentro da tela visível e completa as bordas de rolagem pelas mais próximas
    const items = alwaysItems.concat(inViewItems);
    const remaining = Math.max(0, MAX_TOTAL - items.length);
    if (remaining > 0 && inBufferItems.length > 0) {
      inBufferItems.sort((a, b) => a.normDist - b.normDist);
      for (let i = 0; i < remaining && i < inBufferItems.length; i++) {
        items.push(inBufferItems[i]);
      }
    }
    return { items, paddedBounds, zoom };
  }

  // Zoom <= 14: amostragem espacial por grade fixa geográfica (mantém cobertura em toda a tela sem empilhar texto ou travar)
  const isMidZoom = zoom >= 13.5;
  const maxForZoom = isMidZoom ? 600 : 220;
  const cellLat = isMidZoom ? 0.0012 : zoom >= 12.5 ? 0.0036 : 0.0070;
  const cellLng = isMidZoom ? 0.0014 : zoom >= 12.5 ? 0.0042 : 0.0080;

  if (alwaysItems.length + inViewItems.length + inBufferItems.length <= maxForZoom) {
    return {
      items: alwaysItems.concat(inViewItems, inBufferItems),
      paddedBounds,
      zoom,
    };
  }

  const items = [...alwaysItems];
  const occupiedCells = new Set();
  const fallbackPool = [];

  for (let i = 0; i < alwaysItems.length; i++) {
    const q = alwaysItems[i].q;
    occupiedCells.add(`${Math.floor(q.lat / cellLat)},${Math.floor(q.lng / cellLng)}`);
  }

  const processPool = (pool) => {
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i];
      const cellKey = `${Math.floor(item.q.lat / cellLat)},${Math.floor(item.q.lng / cellLng)}`;
      if (!occupiedCells.has(cellKey)) {
        occupiedCells.add(cellKey);
        if (items.length < maxForZoom) {
          items.push(item);
        }
      } else {
        fallbackPool.push(item);
      }
    }
  };

  processPool(inViewItems);
  if (items.length < maxForZoom) {
    processPool(inBufferItems);
  }

  if (isMidZoom && items.length < maxForZoom && fallbackPool.length > 0) {
    for (let i = 0; i < fallbackPool.length && items.length < maxForZoom; i++) {
      if (fallbackPool[i].normDist === 0) {
        items.push(fallbackPool[i]);
      }
    }
  }

  return { items, paddedBounds, zoom };
}

// Renderiza as Quadras de Itaipuaçu via camada Leaflet nativa com diff incremental (60 FPS + 100% da tela visível)
function QuadraLayer({
  quadras,
  pendingEdits,
  deliveryQuadrasMap,
  highlightedQuadra,
  searchSeq,
  onSelectQuadra,
  onDeselectQuadra,
  showQuadras,
  adjustMode = false,
  isAddingQuadra = false,
  onAddMapClick,
  onStageQuadraEdit,
  onDragActiveChange,
  onDeleteQuadra,
}) {
  const map = useMap();
  const [clickedQuadraState, setClickedQuadraState] = useState(null);
  const [dismissedState, setDismissedState] = useState(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const layerGroupRef = useRef(null);
  const markersMapRef = useRef(new Map());
  const lastRenderBoundsRef = useRef(null);
  const lastZoomRef = useRef(null);
  const draggingKeyRef = useRef(null);
  const rafIdRef = useRef(null);
  const stateRef = useRef({
    cleanQuadras: [],
    deliveryQuadrasMap,
    highlightedQuadra,
    searchSeq,
    selectedKey: null,
    showQuadras,
    adjustMode,
    isAddingQuadra,
    onAddMapClick,
    onSelectQuadra,
    onStageQuadraEdit,
    onDragActiveChange,
  });

  // Deduplicação O(N) feita apenas quando a lista base de quadras muda
  const baseCleanQuadras = useMemo(() => {
    if (!quadras || quadras.length === 0) return [];
    const result = [];
    const byNorm = new Map();

    for (let i = 0; i < quadras.length; i++) {
      const q = quadras[i];
      if (!q || isNaN(q.lat) || isNaN(q.lng)) continue;
      const formatted = formatQuadraNumber(q.rawNumber || q.number);
      const qNorm = formatted.replace(/^0+/, '').toUpperCase() || '0';
      const key = q.id || `${formatted}-${q.lat}-${q.lng}`;

      const existingList = byNorm.get(qNorm);
      let isDupe = false;
      if (existingList) {
        const cosLat = Math.cos((q.lat * Math.PI) / 180);
        // Se foi adicionada manualmente na sessão ou no botão Add Número, só considera duplicada se estiver exatamente em cima (< 15m)
        const minRadiusSq = q.isCustomAdded ? 15 * 15 : 160 * 160;
        for (let j = 0; j < existingList.length; j++) {
          const ex = existingList[j];
          if (ex._key === key) {
            isDupe = true;
            break;
          }
          const dlat = (q.lat - ex.lat) * 111320;
          const dlng = (q.lng - ex.lng) * 111320 * cosLat;
          if (dlat * dlat + dlng * dlng < minRadiusSq) {
            isDupe = true;
            break;
          }
        }
      }

      if (!isDupe) {
        const item = {
          ...q,
          _key: key,
          _label: formatted,
          _numInt: parseInt(formatted, 10),
        };
        result.push(item);
        if (!existingList) {
          byNorm.set(qNorm, [item]);
        } else {
          existingList.push(item);
        }
      }
    }

    return result;
  }, [quadras]);

  // Sobrepõe coordenadas temporárias arrastadas enquanto aguardam clique em "Salvar no JSON"
  const cleanQuadras = useMemo(() => {
    if (!pendingEdits || pendingEdits.size === 0) return baseCleanQuadras;
    return baseCleanQuadras.map((q) => {
      const pending = pendingEdits.get(q._key);
      if (pending) {
        return {
          ...q,
          lat: pending.lat,
          lng: pending.lng,
          isPendingSave: true,
        };
      }
      return q;
    });
  }, [baseCleanQuadras, pendingEdits]);

  // Popup ativo único (sob demanda, evitando centenas de popups em memória)
  const activePopupQuadra = useMemo(() => {
    if (clickedQuadraState && clickedQuadraState.seq === searchSeq) {
      return cleanQuadras.find((x) => x._key === clickedQuadraState.key) || null;
    }
    const isDismissed =
      dismissedState &&
      dismissedState.highlight === highlightedQuadra &&
      dismissedState.seq === searchSeq;
    if (highlightedQuadra && !isDismissed && cleanQuadras.length > 0) {
      return (
        cleanQuadras.find(
          (x) =>
            x._label === highlightedQuadra ||
            x.number === highlightedQuadra ||
            x.rawNumber === highlightedQuadra
        ) || null
      );
    }
    return null;
  }, [clickedQuadraState, dismissedState, highlightedQuadra, searchSeq, cleanQuadras]);

  const selectedKey = activePopupQuadra ? activePopupQuadra._key : null;

  // Sincronização incremental dos marcadores nativos do Leaflet
  const syncMarkers = useCallback(() => {
    const layerGroup = layerGroupRef.current;
    if (!layerGroup || !map) return;

    const st = stateRef.current;
    const container = map.getContainer();

    if (!st.showQuadras) {
      if (markersMapRef.current.size > 0) {
        layerGroup.clearLayers();
        markersMapRef.current.clear();
      }
      lastRenderBoundsRef.current = null;
      if (container) {
        container.classList.remove('quadras-zoom-compact', 'quadras-zoom-medium');
      }
      return;
    }

    const { items, paddedBounds, zoom } = selectVisibleQuadras(
      map,
      st.cleanQuadras,
      st.deliveryQuadrasMap,
      st.highlightedQuadra,
      st.selectedKey
    );

    if (container) {
      container.classList.toggle('quadras-zoom-compact', zoom < 14.5);
      container.classList.toggle('quadras-zoom-medium', zoom >= 14.5 && zoom < 16);
    }

    const desiredByKey = new Map();
    for (let i = 0; i < items.length; i++) {
      desiredByKey.set(items[i].q._key, items[i]);
    }

    const existingMap = markersMapRef.current;

    // 1. Remove apenas marcadores que saíram da área visível + margem de rolagem
    for (const [key, entry] of existingMap) {
      if (!desiredByKey.has(key) && draggingKeyRef.current !== key) {
        layerGroup.removeLayer(entry.marker);
        existingMap.delete(key);
      }
    }

    // 2. Adiciona apenas marcadores novos ou atualiza os que mudaram de estado
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const q = item.q;
      const key = q._key;
      const isActivelyDragging = draggingKeyRef.current === key;
      const isPendingSave = Boolean(q.isPendingSave);
      const isDraggable = Boolean(item.isSelected || st.adjustMode || isActivelyDragging || isPendingSave);
      const iconKey = `${q._label}-${item.hasDelivery ? 'd' : ''}-${item.isHighlighted ? 'h' : ''}-${isDraggable ? 'g' : ''}-${isPendingSave ? 'p' : ''}`;
      const zOffset = isActivelyDragging || isPendingSave ? 2500 : isDraggable ? 1000 : item.hasDelivery ? 500 : item.isHighlighted ? 600 : 10;

      const existing = existingMap.get(key);
      if (existing) {
        existing.quadra = q;

        if (!isActivelyDragging && (existing.lat !== q.lat || existing.lng !== q.lng)) {
          existing.marker.setLatLng([q.lat, q.lng]);
          existing.lat = q.lat;
          existing.lng = q.lng;
        }

        // Nunca recria o DOM do ícone durante drag ativo (preserva captura de mouse/toque no Leaflet)
        if (!isActivelyDragging && existing.iconKey !== iconKey) {
          existing.marker.setIcon(
            getCachedQuadraIcon(q, item.hasDelivery, item.isHighlighted, isDraggable, isPendingSave)
          );
          existing.iconKey = iconKey;
        }

        const el = existing.marker.getElement();
        if (el) {
          el.classList.toggle('is-dragging-red', Boolean(isActivelyDragging || isPendingSave));
        }

        if (!isActivelyDragging && existing.draggable !== isDraggable) {
          existing.marker.options.draggable = isDraggable;
          if (existing.marker.dragging) {
            if (isDraggable) existing.marker.dragging.enable();
            else existing.marker.dragging.disable();
          }
          existing.draggable = isDraggable;
        }

        if (existing.zOffset !== zOffset) {
          existing.marker.setZIndexOffset(zOffset);
          existing.zOffset = zOffset;
        }
      } else {
        const icon = getCachedQuadraIcon(q, item.hasDelivery, item.isHighlighted, isDraggable, isPendingSave);
        const marker = L.marker([q.lat, q.lng], {
          icon,
          draggable: isDraggable,
          autoPan: true,
          zIndexOffset: zOffset,
        });

        marker.on('click', (e) => {
          if (e && e.originalEvent) {
            L.DomEvent.stopPropagation(e.originalEvent);
          }
          const latestState = stateRef.current;
          const latestEntry = markersMapRef.current.get(key);
          const latestQ = latestEntry ? latestEntry.quadra : q;

          if (latestState.isAddingQuadra && latestState.onAddMapClick) {
            latestState.onAddMapClick(e.latlng || marker.getLatLng());
            return;
          }
          // No modo arrastar ativo, não abre modal de informação para manter o mapa limpo
          if (!latestState.adjustMode) {
            setConfirmDeleteKey(null);
            setDismissedState(null);
            setClickedQuadraState({ key, seq: latestState.searchSeq });
            if (latestState.onSelectQuadra) latestState.onSelectQuadra(latestQ);
          }
        });

        marker.on('dragstart', () => {
          draggingKeyRef.current = key;
          const el = marker.getElement();
          if (el) el.classList.add('is-dragging-red');
          marker.setZIndexOffset(2500);
          setIsDragging(true);
          // Fecha o popup imediatamente ao iniciar o arrasto para desobstruir a visão
          setClickedQuadraState(null);
          setDismissedState({
            highlight: stateRef.current.highlightedQuadra,
            seq: stateRef.current.searchSeq,
          });
          const entry = markersMapRef.current.get(key);
          const latestQ = entry ? entry.quadra : q;
          if (stateRef.current.onDragActiveChange) {
            stateRef.current.onDragActiveChange(latestQ);
          }
        });

        marker.on('dragend', (e) => {
          draggingKeyRef.current = null;
          setIsDragging(false);
          const newLatLng = e.target.getLatLng();
          const newLat = Number(newLatLng.lat.toFixed(6));
          const newLng = Number(newLatLng.lng.toFixed(6));
          const entry = markersMapRef.current.get(key);
          const latestQ = entry ? entry.quadra : q;

          if (entry) {
            entry.lat = newLat;
            entry.lng = newLng;
            entry.quadra = { ...latestQ, lat: newLat, lng: newLng, isPendingSave: true };
          }

          if (stateRef.current.onStageQuadraEdit) {
            stateRef.current.onStageQuadraEdit({
              ...latestQ,
              lat: newLat,
              lng: newLng,
            });
          }
          if (stateRef.current.onDragActiveChange) {
            stateRef.current.onDragActiveChange(null);
          }
        });

        layerGroup.addLayer(marker);
        if (isPendingSave) {
          const el = marker.getElement();
          if (el) el.classList.add('is-dragging-red');
        }
        existingMap.set(key, {
          marker,
          iconKey,
          draggable: isDraggable,
          zOffset,
          lat: q.lat,
          lng: q.lng,
          quadra: q,
        });
      }
    }

    lastRenderBoundsRef.current = paddedBounds;
    lastZoomRef.current = zoom;
  }, [map]);

  // Atualiza stateRef fora do render e re-sincroniza quando dados, filtros ou seleção mudarem
  useEffect(() => {
    stateRef.current = {
      cleanQuadras,
      deliveryQuadrasMap,
      highlightedQuadra,
      searchSeq,
      selectedKey,
      showQuadras,
      adjustMode,
      isAddingQuadra,
      onAddMapClick,
      onSelectQuadra,
      onStageQuadraEdit,
      onDragActiveChange,
    };
    syncMarkers();
  }, [
    syncMarkers,
    cleanQuadras,
    deliveryQuadrasMap,
    highlightedQuadra,
    searchSeq,
    selectedKey,
    showQuadras,
    adjustMode,
    isAddingQuadra,
    onAddMapClick,
    onSelectQuadra,
    onStageQuadraEdit,
    onDragActiveChange,
    isDragging,
  ]);

  // Inicializa LayerGroup e hooks diretos de movimento/zoom no mapa
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const markersMap = markersMapRef.current;
    layerGroupRef.current = group;

    const handleMove = () => {
      if (!stateRef.current.showQuadras || map._animatingZoom) return;
      const zoom = map.getZoom();
      // Só pula renderização durante arrasto se a tela atual ainda estiver confortavelmente dentro da margem pré-renderizada
      if (
        lastZoomRef.current !== null &&
        Math.abs(zoom - lastZoomRef.current) < 0.25 &&
        lastRenderBoundsRef.current &&
        lastRenderBoundsRef.current.contains(map.getBounds().pad(0.04))
      ) {
        return;
      }

      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          syncMarkers();
        });
      }
    };

    const handleSettled = () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      syncMarkers();
    };

    map.on('move', handleMove);
    map.on('moveend', handleSettled);
    map.on('zoomend', handleSettled);
    map.on('resize', handleSettled);

    syncMarkers();

    return () => {
      map.off('move', handleMove);
      map.off('moveend', handleSettled);
      map.off('zoomend', handleSettled);
      map.off('resize', handleSettled);
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      const container = map.getContainer();
      if (container) {
        container.classList.remove('quadras-zoom-compact', 'quadras-zoom-medium');
      }
      group.clearLayers();
      map.removeLayer(group);
      markersMap.clear();
      layerGroupRef.current = null;
    };
  }, [map, syncMarkers]);

  // Clique fora no fundo do mapa sai da seleção e do modo de arrastar
  useMapEvents({
    click: () => {
      if (isAddingQuadra) return;
      setConfirmDeleteKey(null);
      setClickedQuadraState(null);
      setDismissedState({ highlight: highlightedQuadra, seq: searchSeq });
      if (onDeselectQuadra) onDeselectQuadra();
    },
  });

  if (!showQuadras) return null;

  const deliveriesHere = activePopupQuadra
    ? deliveryQuadrasMap.get(activePopupQuadra._numInt) ||
      deliveryQuadrasMap.get(activePopupQuadra.rawNumber) ||
      []
    : [];
  const hasDelivery = deliveriesHere.length > 0;
  const popupLabel = activePopupQuadra
    ? formatQuadraNumber(activePopupQuadra.rawNumber || activePopupQuadra.number)
    : '';
  const isConfirmingDelete = Boolean(activePopupQuadra && confirmDeleteKey === activePopupQuadra._key);

  return (
    <>
      {/* Popup único sob demanda: exibido apenas quando NÃO estiver no modo arrastar e nem arrastando */}
      {activePopupQuadra && !adjustMode && !isDragging && (
        <Popup
          position={[activePopupQuadra.lat, activePopupQuadra.lng]}
          onClose={() => {
            setConfirmDeleteKey(null);
            setClickedQuadraState(null);
            setDismissedState({ highlight: highlightedQuadra, seq: searchSeq });
            if (onDeselectQuadra) onDeselectQuadra();
          }}
          className="custom-popup"
          maxWidth={290}
        >
          <div className="popup-card quadra-popup-card">
            <div className="popup-header">
              <span className="popup-tag quadra">Quadra {popupLabel}</span>
              <span className={`popup-badge drag-badge ${activePopupQuadra.isPendingSave ? 'pending-save-badge' : ''}`}>
                {activePopupQuadra.isPendingSave ? '🔴 Aguardando Salvar' : '📍 Arrastável'}
              </span>
              {hasDelivery && (
                <span className="popup-badge delivery-tag">
                  {deliveriesHere.length} {deliveriesHere.length === 1 ? 'entrega' : 'entregas'}
                </span>
              )}
            </div>
            <h4 className="popup-title">Quadra #{popupLabel} (Itaipuaçu)</h4>

            <div className="popup-drag-hint">
              ✋ <strong>Ajustar posição:</strong> Arraste o pino (ele ficará vermelho com número branco) e clique em <strong>Salvar no JSON</strong> abaixo para confirmar definitivamente!
            </div>

            <p className="popup-meta">Posição do loteamento:</p>
            <p className="popup-meta font-mono">
              {activePopupQuadra.lat.toFixed(6)}, {activePopupQuadra.lng.toFixed(6)}
            </p>

            {hasDelivery && (
              <div className="quadra-deliveries-list">
                <strong>Paradas nesta quadra:</strong>
                {deliveriesHere.map((d, i) => (
                  <div key={i} className="quadra-delivery-row">
                    <span className="deliv-idx">#{d.originalRow}</span>
                    <span className="deliv-name">{d.recipient}</span>
                    {d.lote && <span className="deliv-lote">Lt {d.lote}</span>}
                  </div>
                ))}
              </div>
            )}

            {onDeleteQuadra && (
              <div
                className="popup-delete-section"
                onClick={(e) => e.stopPropagation()}
              >
                {isConfirmingDelete ? (
                  <div className="delete-confirm-box">
                    <span className="delete-confirm-text">Excluir Quadra #{popupLabel}?</span>
                    <div className="delete-confirm-actions">
                      <button
                        type="button"
                        className="btn-cancel-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteKey(null);
                        }}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="btn-confirm-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          const target = activePopupQuadra;
                          setConfirmDeleteKey(null);
                          setClickedQuadraState(null);
                          setDismissedState({ highlight: highlightedQuadra, seq: searchSeq });
                          if (onDeselectQuadra) onDeselectQuadra();
                          onDeleteQuadra(target);
                        }}
                      >
                        Sim, Excluir
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn-delete-quadra"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteKey(activePopupQuadra._key);
                    }}
                    title="Excluir esta quadra do mapa e do arquivo"
                  >
                    🗑️ Excluir Quadra
                  </button>
                )}
              </div>
            )}
          </div>
        </Popup>
      )}
    </>
  );
}

function AddressMarkers({ addresses, selectedId, onSelect }) {
  return (
    <>
      {addresses.map((address, index) => {
        if (!address.coordinates || isNaN(address.coordinates.lat) || isNaN(address.coordinates.lng)) {
          return null;
        }

        const isSelected = selectedId === address.originalRow;
        const isFirst = index === 0;
        const isLast = index === addresses.length - 1 && addresses.length > 1;
        const hasQuadraLote = Boolean(address.quadra || address.lote);

        const icon = createCustomPin({
          number: index + 1,
          isStart: isFirst,
          isEnd: isLast,
          isSelected,
          hasQuadraLote,
        });

        const encodedQuery = encodeURIComponent(
          `${address.street || ''} ${address.number || ''}, ${address.neighborhood || ''}, ${address.city || 'Maricá'}, RJ`
        );
        const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`;
        const wazeUrl = `https://waze.com/ul?ll=${address.coordinates.lat},${address.coordinates.lng}&navigate=yes`;

        return (
          <Marker
            key={`addr-${address.originalRow || index}`}
            position={[address.coordinates.lat, address.coordinates.lng]}
            icon={icon}
            zIndexOffset={isSelected ? 1000 : index + 50}
            eventHandlers={{
              click: () => onSelect(address.originalRow),
            }}
          >
            <Popup className="custom-popup" maxWidth={320}>
              <div className="popup-card">
                <div className="popup-header">
                  <span className="popup-badge">Parada #{index + 1}</span>
                  {address.orderId && <span className="popup-order">{address.orderId}</span>}
                </div>
                
                <h4 className="popup-title">{address.recipient || `Endereço #${address.originalRow}`}</h4>
                
                <div className="popup-body">
                  <p className="popup-address">
                    <strong>{address.street}</strong>
                    {address.number ? `, Nº ${address.number}` : ''}
                  </p>

                  {(address.quadra || address.lote) && (
                    <div className="popup-quadra-tags">
                      {address.quadra && <span className="popup-tag quadra">Quadra {address.quadra}</span>}
                      {address.lote && <span className="popup-tag lote">Lote {address.lote}</span>}
                    </div>
                  )}

                  {address.complement && (
                    <p className="popup-meta">Complemento: {address.complement}</p>
                  )}

                  <p className="popup-meta">
                    {[address.neighborhood, address.city, address.state].filter(Boolean).join(' • ')}
                  </p>

                  {address.zipCode && (
                    <p className="popup-meta font-mono">CEP: {address.zipCode}</p>
                  )}

                  {address.phone && (
                    <p className="popup-phone">
                      <a href={`tel:${address.phone.replace(/\D/g, '')}`}>
                        📞 {address.phone}
                      </a>
                    </p>
                  )}
                </div>

                <div className="popup-actions">
                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="popup-btn gmaps"
                    title="Navegar no Google Maps"
                  >
                    Google Maps ↗
                  </a>
                  <a
                    href={wazeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="popup-btn waze"
                    title="Navegar com Waze"
                  >
                    Waze ↗
                  </a>
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

function MapClickHandler({ 
  onMapBackgroundClick,
  isAddingQuadra,
  onAddMapClick,
}) {
  useMapEvents({
    click: (e) => {
      if (isAddingQuadra && onAddMapClick) {
        onAddMapClick(e.latlng);
        return;
      }
      if (onMapBackgroundClick) {
        onMapBackgroundClick();
      }
    },
  });
  return null;
}

export default function MapView({
  addresses = [],
  selectedId,
  onSelect,
  center,
  zoom,
  quadras = itaipuacuQuadras,
  onUpdateQuadra,
  onAddQuadra,
  onDeleteQuadra,
}) {
  const [mapInstance, setMapInstance] = useState(null);
  const [tileStyle, setTileStyle] = useState('osm');
  const [showQuadras, setShowQuadras] = useState(true);
  const [adjustMode, setAdjustMode] = useState(false);
  const [isAddingQuadra, setIsAddingQuadra] = useState(false);
  const [pendingAddPoint, setPendingAddPoint] = useState(null);
  const [newQuadraNumber, setNewQuadraNumber] = useState('');
  const [quadraSearchInput, setQuadraSearchInput] = useState('');
  const [searchedQuadra, setSearchedQuadra] = useState(null);
  const [searchSeq, setSearchSeq] = useState(0);
  const [pendingEdits, setPendingEdits] = useState(() => new Map());
  const [draggingQuadra, setDraggingQuadra] = useState(null);
  const [isSavingEdits, setIsSavingEdits] = useState(false);

  const pendingEditsList = useMemo(() => Array.from(pendingEdits.values()), [pendingEdits]);

  // Armazena temporariamente a posição arrastada até o usuário clicar no botão Salvar abaixo
  const handleStageQuadraEdit = useCallback((updatedQuadra) => {
    const key = updatedQuadra._key || updatedQuadra.id || `${formatQuadraNumber(updatedQuadra.rawNumber || updatedQuadra.number)}-${updatedQuadra.lat}-${updatedQuadra.lng}`;
    setPendingEdits((prev) => {
      const next = new Map(prev);
      next.set(key, updatedQuadra);
      return next;
    });
  }, []);

  // Salva todas as posições pendentes oficialmente no itaipuacuQuadras.json e localStorage
  const handleConfirmSaveEdits = useCallback(async () => {
    if (pendingEditsList.length === 0 || isSavingEdits) return;
    setIsSavingEdits(true);
    try {
      let ok = true;
      if (onUpdateQuadra) {
        ok = await onUpdateQuadra(pendingEditsList);
      }
      if (ok !== false) {
        setPendingEdits(new Map());
      }
    } finally {
      setIsSavingEdits(false);
    }
  }, [pendingEditsList, isSavingEdits, onUpdateQuadra]);

  // Desfaz alterações não salvas voltando os pinos para a última posição oficial salva
  const handleDiscardPendingEdits = useCallback(() => {
    setPendingEdits(new Map());
    setDraggingQuadra(null);
  }, []);

  // Ao excluir uma quadra, remove também das edições pendentes se houver
  const handleDeleteQuadraWithCleanup = useCallback((target) => {
    if (target?._key) {
      setPendingEdits((prev) => {
        if (!prev.has(target._key)) return prev;
        const next = new Map(prev);
        next.delete(target._key);
        return next;
      });
    }
    if (onDeleteQuadra) {
      onDeleteQuadra(target);
    }
  }, [onDeleteQuadra]);

  // Mapeamento de entregas por quadra para destaque rápido
  const deliveryQuadrasMap = useMemo(() => {
    const map = new Map();
    for (const a of addresses) {
      if (a.quadra) {
        const numInt = parseInt(a.quadra, 10);
        const key = isNaN(numInt) ? String(a.quadra).trim() : numInt;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(a);

        // também adiciona a string bruta se diferente
        if (a.quadra !== key && !map.has(a.quadra)) {
          map.set(a.quadra, [a]);
        }
      }
    }
    return map;
  }, [addresses]);

  const validAddresses = useMemo(() => {
    return addresses.filter(a => a.coordinates && !isNaN(a.coordinates.lat) && !isNaN(a.coordinates.lng));
  }, [addresses]);

  const selectedAddress = useMemo(() => {
    return addresses.find(a => a.originalRow === selectedId);
  }, [addresses, selectedId]);

  // Quadra destacada pode vir de uma busca manual ou da parada selecionada
  const highlightedQuadra = searchedQuadra || (selectedAddress?.quadra || null);

  // Centro padrão (Itaipuaçu / Maricá - RJ)
  const defaultCenter = useMemo(() => {
    if (center && center.length === 2) return center;
    if (validAddresses.length > 0) {
      return [validAddresses[0].coordinates.lat, validAddresses[0].coordinates.lng];
    }
    return [-22.9580, -42.9450]; // Itaipuaçu Central
  }, [center, validAddresses]);

  const handleFitAll = () => {
    if (!mapInstance) return;
    const allCoords = validAddresses.map(a => [a.coordinates.lat, a.coordinates.lng]);

    if (allCoords.length > 1) {
      mapInstance.fitBounds(allCoords, { padding: [60, 60], maxZoom: 16 });
    } else if (allCoords.length === 1) {
      mapInstance.setView(allCoords[0], 16);
    } else {
      mapInstance.setView([-22.9580, -42.9450], 15);
    }
  };

  // Busca rápida de quadra
  const handleSearchQuadra = useCallback((e) => {
    e.preventDefault();
    if (!quadraSearchInput.trim() || !mapInstance) return;

    const term = quadraSearchInput.trim().toUpperCase();
    const numInt = parseInt(term, 10);

    const found = quadras.find(q => {
      if (q.rawNumber && q.rawNumber.toUpperCase() === term) return true;
      if (q.number && q.number.toUpperCase() === term) return true;
      if (!isNaN(numInt) && parseInt(q.number, 10) === numInt) return true;
      return false;
    });

    if (found) {
      setSearchedQuadra(formatQuadraNumber(found.rawNumber || found.number));
      setSearchSeq(s => s + 1);
      mapInstance.flyTo([found.lat, found.lng], 17, { duration: 1.0 });
    } else {
      alert(`Quadra ${term} não encontrada no mapa de Itaipuaçu.`);
    }
  }, [quadraSearchInput, quadras, mapInstance]);

  // Confirmação da inserção de nova quadra clicada no mapa
  const handleConfirmAddQuadra = useCallback((e) => {
    e.preventDefault();
    if (!newQuadraNumber.trim() || !pendingAddPoint) return;

    const formatted = formatQuadraNumber(newQuadraNumber);

    const newQ = {
      id: `${formatted}-${Math.round(pendingAddPoint.lat * 100000)}-${Math.round(pendingAddPoint.lng * 100000)}`,
      number: formatted,
      rawNumber: formatted,
      lat: Number(pendingAddPoint.lat.toFixed(6)),
      lng: Number(pendingAddPoint.lng.toFixed(6)),
    };

    if (onAddQuadra) {
      onAddQuadra(newQ);
    }

    setNewQuadraNumber('');
    setPendingAddPoint(null);
    setIsAddingQuadra(false);
  }, [newQuadraNumber, pendingAddPoint, onAddQuadra]);

  const tileLayers = {
    osm: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
    voyager: {
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      attribution: '&copy; CartoDB &copy; OpenStreetMap',
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Esri, Maxar, Earthstar Geographics',
    },
  };

  const activeTile = tileLayers[tileStyle] || tileLayers.osm;

  return (
    <div className="map-container">
      {/* Barra de Controles Flutuantes do Mapa */}
      <div className="map-floating-controls">
        <button
          type="button"
          className="map-control-btn"
          onClick={handleFitAll}
          title="Ajustar visão para todas as paradas"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" />
            <line x1="12" y1="2" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="2" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="22" y2="12" />
          </svg>
          <span>Enquadrar</span>
        </button>

        {/* Alternador de Quadras de Itaipuaçu */}
        <button
          type="button"
          className={`map-control-btn quadra-toggle-btn ${showQuadras ? 'active' : ''}`}
          onClick={() => setShowQuadras(!showQuadras)}
          title="Exibir ou ocultar numeração verde das quadras de Itaipuaçu"
        >
          <span className="quadra-icon-badge">Qd</span>
          <span>Quadras ({quadras.length})</span>
        </button>

        {/* Alternador do Modo de Ajuste / Arrastar Pino */}
        {showQuadras && (
          <button
            type="button"
            className={`map-control-btn adjust-toggle-btn ${adjustMode ? 'active' : ''}`}
            onClick={() => {
              setAdjustMode(!adjustMode);
              setIsAddingQuadra(false);
              setPendingAddPoint(null);
            }}
            title={adjustMode ? 'Modo de arrasto ativado para todas as quadras' : 'Permitir arrastar qualquer quadra diretamente pelo mouse ou celular'}
          >
            <span className="adjust-icon">{adjustMode ? '✋' : '📍'}</span>
            <span>{adjustMode ? 'Arrastar Ativo' : 'Ajustar'}</span>
          </button>
        )}

        {/* Botão de Adicionar Número / Nova Quadra */}
        {showQuadras && (
          <button
            type="button"
            className={`map-control-btn add-quadra-btn ${isAddingQuadra ? 'active' : ''}`}
            onClick={() => {
              setIsAddingQuadra(!isAddingQuadra);
              setPendingAddPoint(null);
              setAdjustMode(false);
            }}
            title={isAddingQuadra ? 'Cancelar inserção' : 'Inserir um novo número de quadra no mapa e salvar no arquivo'}
          >
            <span className="add-icon">{isAddingQuadra ? '✕' : '➕'}</span>
            <span>{isAddingQuadra ? 'Cancelar' : 'Add Número'}</span>
          </button>
        )}

        {/* Busca Rápida de Quadra */}
        <form onSubmit={handleSearchQuadra} className="map-quadra-search-form">
          <input
            type="text"
            placeholder="Ir para Quadra..."
            value={quadraSearchInput}
            onChange={(e) => setQuadraSearchInput(e.target.value)}
            className="map-quadra-search-input"
          />
          <button type="submit" className="btn-search-quadra" title="Localizar quadra">
            🔍
          </button>
        </form>

        {/* Seletor de Camada do Mapa */}
        <div className="map-style-toggle">
          <button
            type="button"
            className={`style-btn ${tileStyle === 'osm' ? 'active' : ''}`}
            onClick={() => setTileStyle('osm')}
            title="Mapa Padrão (OpenStreetMap)"
          >
            Rua
          </button>
          <button
            type="button"
            className={`style-btn ${tileStyle === 'voyager' ? 'active' : ''}`}
            onClick={() => setTileStyle('voyager')}
            title="Mapa Claro"
          >
            Claro
          </button>
          <button
            type="button"
            className={`style-btn ${tileStyle === 'satellite' ? 'active' : ''}`}
            onClick={() => setTileStyle('satellite')}
            title="Vista de Satélite"
          >
            Satélite
          </button>
        </div>

        {validAddresses.length > 0 && (
          <div className="map-badge-counter">
            <span className="dot-live"></span>
            <strong>{validAddresses.length}</strong> paradas
          </div>
        )}
      </div>

      <MapContainer
        center={defaultCenter}
        zoom={zoom || 15}
        scrollWheelZoom={true}
        preferCanvas={true}
        wheelDebounceTime={90}
        wheelPxPerZoomLevel={110}
        className={`leaflet-map ${isAddingQuadra ? 'is-adding-quadra' : ''}`}
      >
        <TileLayer
          attribution={activeTile.attribution}
          url={activeTile.url}
          maxZoom={19}
        />
        
        <MapController
          center={center}
          zoom={zoom}
          addresses={addresses}
          onMapReady={setMapInstance}
        />

        {/* Camada das Quadras de Itaipuaçu (Verde como na foto e no PDF) */}
        <QuadraLayer
          quadras={quadras}
          pendingEdits={pendingEdits}
          deliveryQuadrasMap={deliveryQuadrasMap}
          highlightedQuadra={highlightedQuadra}
          searchSeq={searchSeq}
          onSelectQuadra={() => {
            setSearchedQuadra(null);
          }}
          onDeselectQuadra={() => {
            setAdjustMode(false);
            setSearchedQuadra(null);
          }}
          showQuadras={showQuadras}
          adjustMode={adjustMode}
          isAddingQuadra={isAddingQuadra}
          onAddMapClick={(latlng) => {
            setPendingAddPoint(latlng);
          }}
          onStageQuadraEdit={handleStageQuadraEdit}
          onDragActiveChange={setDraggingQuadra}
          onDeleteQuadra={handleDeleteQuadraWithCleanup}
        />

        {/* Marcadores de Entregas da Rota */}
        <AddressMarkers
          addresses={addresses}
          selectedId={selectedId}
          onSelect={onSelect}
        />

        <MapClickHandler
          onMapBackgroundClick={() => {
            if (!isAddingQuadra) {
              setAdjustMode(false);
              setSearchedQuadra(null);
            }
          }}
          isAddingQuadra={isAddingQuadra}
          onAddMapClick={(latlng) => {
            setPendingAddPoint(latlng);
          }}
        />
      </MapContainer>

      {/* Banner flutuante no topo durante o modo adicionar número */}
      {isAddingQuadra && !pendingAddPoint && (
        <div className="add-quadra-banner">
          <span className="banner-pulse"></span>
          <span>📍 <strong>Modo Adicionar Número:</strong> Clique no local do mapa onde deseja posicionar o número da quadra.</span>
          <button 
            type="button" 
            className="btn-cancel-banner"
            onClick={() => {
              setIsAddingQuadra(false);
              setPendingAddPoint(null);
            }}
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Modal limpo e responsivo para inserir o número da quadra */}
      {pendingAddPoint && (
        <div className="add-quadra-modal-overlay">
          <div className="add-quadra-modal">
            <div className="add-quadra-modal-header">
              <span className="add-modal-tag">➕ Nova Quadra</span>
              <button
                type="button"
                className="add-modal-close-btn"
                onClick={() => {
                  setPendingAddPoint(null);
                  setIsAddingQuadra(false);
                }}
                title="Fechar"
              >
                ✕
              </button>
            </div>
            <h4 className="add-modal-title">Inserir Número da Quadra</h4>
            <p className="add-modal-subtitle">
              Posição: {pendingAddPoint.lat.toFixed(6)}, {pendingAddPoint.lng.toFixed(6)}
            </p>
            <form onSubmit={handleConfirmAddQuadra} className="add-modal-form">
              <div className="add-modal-field">
                <label htmlFor="input-new-quadra-num">Número da Quadra (ex: 05, 42, 55, 23A):</label>
                <input
                  id="input-new-quadra-num"
                  type="text"
                  placeholder="Ex: 55"
                  value={newQuadraNumber}
                  onChange={(e) => setNewQuadraNumber(e.target.value)}
                  autoFocus
                  required
                  className="add-modal-input"
                />
              </div>
              <div className="add-modal-actions">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={() => {
                    setPendingAddPoint(null);
                    setIsAddingQuadra(false);
                  }}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn-modal-submit">
                  💾 Salvar no Arquivo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Barra Inferior Flutuante ao Arrastar / Ajustar Quadras para Salvar no JSON */}
      {(draggingQuadra || pendingEditsList.length > 0) && (
        <div className="quadra-save-bottom-bar">
          <div className="save-bar-info">
            <span className="save-bar-red-badge">
              {draggingQuadra
                ? `Quadra ${formatQuadraNumber(draggingQuadra.rawNumber || draggingQuadra.number)}`
                : pendingEditsList.length === 1
                  ? `Quadra ${formatQuadraNumber(pendingEditsList[0].rawNumber || pendingEditsList[0].number)}`
                  : `${pendingEditsList.length} Quadras`}
            </span>
            <span className="save-bar-text">
              {draggingQuadra
                ? 'Arrastando... solte no ponto desejado e salve'
                : pendingEditsList.length === 1
                  ? 'Posição alterada — salve no JSON para confirmar definitivo'
                  : `${pendingEditsList.map((q) => `#${formatQuadraNumber(q.rawNumber || q.number)}`).slice(0, 4).join(', ')}${pendingEditsList.length > 4 ? '...' : ''} aguardando salvar`}
            </span>
          </div>
          <div className="save-bar-actions">
            {pendingEditsList.length > 0 && !draggingQuadra && (
              <button
                type="button"
                className="btn-discard-quadra-edit"
                onClick={handleDiscardPendingEdits}
                disabled={isSavingEdits}
                title="Reverter pinos para a última posição salva"
              >
                Desfazer
              </button>
            )}
            <button
              type="button"
              className="btn-save-quadra-json"
              onClick={handleConfirmSaveEdits}
              disabled={Boolean(draggingQuadra) || isSavingEdits || pendingEditsList.length === 0}
              title="Salvar oficialmente e definitivo no itaipuacuQuadras.json"
            >
              {isSavingEdits
                ? 'Salvando...'
                : draggingQuadra
                  ? '💾 Salvar Posição'
                  : '💾 Salvar no JSON'}
            </button>
          </div>
        </div>
      )}

      {/* Mini Card Flutuante de Endereço Selecionado */}
      {selectedAddress && !draggingQuadra && pendingEditsList.length === 0 && (
        <div className="map-selected-card">
          <div className="card-info">
            <div className="card-meta">
              <span className="card-badge">Parada #{selectedAddress.originalRow}</span>
              {selectedAddress.quadra && (
                <span className="card-tag quadra">Quadra {selectedAddress.quadra}</span>
              )}
              {selectedAddress.lote && (
                <span className="card-tag lote">Lote {selectedAddress.lote}</span>
              )}
            </div>
            <strong className="card-name">{selectedAddress.recipient}</strong>
            <p className="card-street">
              {selectedAddress.street}{selectedAddress.number ? `, Nº ${selectedAddress.number}` : ''}
            </p>
          </div>
          
          <div className="card-actions">
            {selectedAddress.coordinates && (
              <>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    `${selectedAddress.street || ''} ${selectedAddress.number || ''}, ${selectedAddress.city || 'Maricá'}, RJ`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="card-btn-action gmaps"
                  title="Abrir no Google Maps"
                >
                  Google Maps
                </a>
                <a
                  href={`https://waze.com/ul?ll=${selectedAddress.coordinates.lat},${selectedAddress.coordinates.lng}&navigate=yes`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="card-btn-action waze"
                  title="Abrir no Waze"
                >
                  Waze
                </a>
              </>
            )}
            {selectedAddress.phone && (
              <a
                href={`tel:${selectedAddress.phone.replace(/\D/g, '')}`}
                className="card-btn-action phone"
                title="Ligar para o cliente"
              >
                Ligar
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
