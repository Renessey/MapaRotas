import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import itaipuacuQuadras from '../data/itaipuacuQuadras.json';
import { groupDeliveryAddressesForMap } from '../utils/addressGrouping';
import './MapView.css';

// Ícone animado para a localização em tempo real do usuário
const userLocationIcon = L.divIcon({
  className: 'user-location-custom-icon',
  html: `
    <div class="user-gps-pulse-wrapper">
      <div class="user-gps-pulse-ring"></div>
      <div class="user-gps-dot">
        <div class="user-gps-inner"></div>
      </div>
    </div>
  `,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14],
});

// Abre rota no Google Maps ou Waze para o destino indicado, partindo da localização atual do usuário (se ativa)
function openNavigationUrl(target, app, originLoc = null) {
  if (!target || isNaN(target.lat) || isNaN(target.lng)) return;
  const lat = target.lat;
  const lng = target.lng;

  if (app === 'google') {
    let url;
    if (originLoc && !isNaN(originLoc.lat) && !isNaN(originLoc.lng)) {
      url = `https://www.google.com/maps/dir/?api=1&origin=${originLoc.lat},${originLoc.lng}&destination=${lat},${lng}`;
    } else {
      url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  } else if (app === 'waze') {
    const url = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

// Cache de ícones dos pinos numerados das entregas
const deliveryPinCache = new Map();

// Cria ícones SVG para as paradas numeradas da rota
function createCustomPin({
  number,
  isStart,
  isEnd,
  isSelected,
  hasQuadraLote,
  isManuallyAdjusted = false,
  packageCount = 1,
  isDelivered = false,
  deliveredCount = 0,
}) {
  let bgClass = 'pin-normal';
  const label = String(number);

  if (isDelivered) {
    bgClass = 'pin-delivered';
  } else if (isStart) {
    bgClass = 'pin-start';
  } else if (isEnd) {
    bgClass = 'pin-end';
  } else if (hasQuadraLote) {
    bgClass = 'pin-quadra';
  }

  const pkgKey = packageCount > 1 ? `p${packageCount}` : '';
  const delKey = isDelivered ? 'd' : deliveredCount > 0 ? `d${deliveredCount}` : '';
  const key = `${label}-${bgClass}-${isSelected ? 's' : ''}-${isManuallyAdjusted ? 'a' : ''}-${pkgKey}-${delKey}`;
  let icon = deliveryPinCache.get(key);
  if (!icon) {
    if (deliveryPinCache.size > 3000) {
      deliveryPinCache.clear();
    }
    const selectedClass = isSelected ? 'pin-selected' : '';
    const adjustedClass = isManuallyAdjusted ? 'pin-adjusted' : '';
    const multiPkgClass = packageCount > 1 ? 'pin-multi-pkg' : '';
    const deliveredClass = isDelivered ? 'pin-delivered-wrapper' : '';

    let topBadgeHtml = '';
    if (packageCount > 1) {
      if (isDelivered) {
        topBadgeHtml = `<span class="pin-package-count delivered" title="Entregue (${packageCount} pacotes)">✓ ${packageCount} pct</span>`;
      } else if (deliveredCount > 0) {
        topBadgeHtml = `<span class="pin-package-count partial" title="${deliveredCount} de ${packageCount} entregues">${deliveredCount}/${packageCount} ent</span>`;
      } else {
        topBadgeHtml = `<span class="pin-package-count" title="${packageCount} pacotes para este endereço">${packageCount} pct</span>`;
      }
    }

    const html = `
      <div class="custom-marker-wrapper ${selectedClass} ${adjustedClass} ${multiPkgClass} ${deliveredClass}">
        ${topBadgeHtml}
        <div class="custom-marker-pin ${bgClass}">
          <span class="custom-marker-text">${label}</span>
        </div>
        ${isManuallyAdjusted ? '<span class="pin-adjusted-dot" title="Posição ajustada manualmente"></span>' : ''}
        <div class="custom-marker-shadow"></div>
        ${isSelected ? '<div class="custom-marker-pulse"></div>' : ''}
      </div>
    `;

    icon = L.divIcon({
      className: 'custom-div-icon',
      html: html,
      iconSize: isSelected ? [36, 46] : [30, 40],
      iconAnchor: isSelected ? [18, 46] : [15, 40],
      popupAnchor: [0, -42],
    });
    deliveryPinCache.set(key, icon);
  }
  return icon;
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
function MapController({ center, zoom, addresses, routeVersion = 0, onMapReady }) {
  const map = useMap();
  const prevCenterRef = useRef(null);
  const lastFittedVersionRef = useRef(0);

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

  // FitBounds inicial apenas quando uma nova rota é carregada (evita reposicionar a câmera ao arrastar pinos)
  useEffect(() => {
    if (!addresses || addresses.length === 0) {
      lastFittedVersionRef.current = 0;
      return;
    }
    if (center) {
      lastFittedVersionRef.current = routeVersion;
      return;
    }
    if (lastFittedVersionRef.current === routeVersion) {
      return;
    }

    const validCoords = addresses
      .filter(a => a.coordinates && !isNaN(a.coordinates.lat) && !isNaN(a.coordinates.lng))
      .map(a => [a.coordinates.lat, a.coordinates.lng]);

    if (validCoords.length > 0) {
      lastFittedVersionRef.current = routeVersion;
      if (validCoords.length > 1) {
        map.fitBounds(validCoords, { padding: [60, 60], maxZoom: 16 });
      } else {
        map.setView(validCoords[0], 16);
      }
    }
  }, [addresses, center, routeVersion, map]);

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

// Normaliza entrada do filtro rápido de quadra ("qd 31", "Quadra 05", "31")
function normalizeQuadraSearchTerm(rawInput) {
  if (!rawInput) return '';
  const cleaned = String(rawInput)
    .trim()
    .replace(/^(?:quadra|quad\.?|qd\.?|q\.?)\s*(?:n[º°.]?\s*)?[:\-_/\s]*/i, '');
  if (!cleaned) return '';
  return formatQuadraNumber(cleaned);
}

// Deduplica quadras mantendo instâncias em loteamentos distintos (mesmo número em locais >160m)
function buildCleanQuadras(quadras) {
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
}

// Renderiza as Quadras de Itaipuaçu via camada Leaflet nativa com diff incremental (60 FPS + 100% da tela visível)
function QuadraLayer({
  quadras,
  cleanQuadrasBase = null,
  pendingEdits,
  deliveryQuadrasMap,
  pinInfoByRow = null,
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
  userLocation,
  onNavigateQuadra,
  onRequestActivateLocation,
}) {
  const map = useMap();
  const [clickedQuadraState, setClickedQuadraState] = useState(null);
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
  const baseCleanQuadras = useMemo(
    () => (cleanQuadrasBase ? cleanQuadrasBase : buildCleanQuadras(quadras)),
    [cleanQuadrasBase, quadras]
  );

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

  // Popup abre APENAS quando o usuário clica diretamente na quadra (nunca auto-abre outra quadra fora da tela)
  const activePopupQuadra = useMemo(() => {
    if (clickedQuadraState && clickedQuadraState.seq === searchSeq) {
      return cleanQuadras.find((x) => x._key === clickedQuadraState.key) || null;
    }
    return null;
  }, [clickedQuadraState, searchSeq, cleanQuadras]);

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
      {/* Popup único sob demanda: exibido apenas quando o usuário clica na quadra e sem autoPan automático */}
      {activePopupQuadra && !adjustMode && !isDragging && (
        <Popup
          position={[activePopupQuadra.lat, activePopupQuadra.lng]}
          autoPan={false}
          onClose={() => {
            setConfirmDeleteKey(null);
            setClickedQuadraState(null);
            if (onDeselectQuadra) onDeselectQuadra();
          }}
          className="custom-popup"
          maxWidth={320}
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

            {/* Seção de Navegação: Google Maps ou Waze */}
            <div className="popup-navigation-section">
              <div className="popup-nav-header">
                <span className="popup-nav-title">Navegar até a Quadra:</span>
                {userLocation ? (
                  <span className="popup-nav-origin-status active" title="GPS ativo no seu dispositivo">
                    <span className="gps-live-dot"></span> Do seu local
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn-enable-gps-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onRequestActivateLocation) onRequestActivateLocation();
                    }}
                    title="Ativar localização para usar como ponto de partida"
                  >
                    📍 Ativar meu local
                  </button>
                )}
              </div>

              <div className="popup-nav-actions">
                <button
                  type="button"
                  className="popup-nav-btn gmaps"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onNavigateQuadra) onNavigateQuadra(activePopupQuadra, 'google');
                  }}
                  title="Navegar com Google Maps"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="3 11 22 2 13 21 11 13 3 11" />
                  </svg>
                  <span>Google Maps ↗</span>
                </button>
                <button
                  type="button"
                  className="popup-nav-btn waze"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onNavigateQuadra) onNavigateQuadra(activePopupQuadra, 'waze');
                  }}
                  title="Navegar com Waze"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12.003 2C6.479 2 2 6.479 2 12.003c0 2.215.72 4.264 1.94 5.926L2.6 21.4a.5.5 0 00.6.6l3.471-1.34A9.957 9.957 0 0012.003 22c5.524 0 10.003-4.479 10.003-9.997C22.006 6.479 17.527 2 12.003 2zm-2.8 13.6a1.2 1.2 0 110-2.4 1.2 1.2 0 010 2.4zm5.6 0a1.2 1.2 0 110-2.4 1.2 1.2 0 010 2.4zm-2.8-4a1.2 1.2 0 110-2.4 1.2 1.2 0 010 2.4z" />
                  </svg>
                  <span>Waze ↗</span>
                </button>
              </div>
            </div>

            {hasDelivery && (
              <div className="quadra-deliveries-list">
                <strong>Paradas nesta quadra:</strong>
                {deliveriesHere.map((d, i) => {
                  const pinInfo = pinInfoByRow?.get(d.originalRow);
                  return (
                    <div
                      key={i}
                      className={`quadra-delivery-row ${d.delivered ? 'is-delivered' : ''}`}
                    >
                      <span className="deliv-idx">#{d.originalRow}</span>
                      {pinInfo && (
                        <span
                          className={`deliv-pin-badge ${pinInfo.isDelivered ? 'is-delivered' : ''}`}
                          title={`No mapa: Pino #${pinInfo.stopNumber}`}
                        >
                          pino {pinInfo.stopNumber}
                        </span>
                      )}
                      <span className="deliv-name">{d.recipient}</span>
                      {d.lote && <span className="deliv-lote">Lt {d.lote}</span>}
                    </div>
                  );
                })}
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

function AddressMarkers({
  groupedStops = [],
  selectedId,
  onSelect,
  userLocation,
  onNavigateAddress,
  onUpdateAddress,
  onConfirmDelivery,
  onEditAddress,
  onStartReposition,
  isPickingMapSpot = false,
  onPickMapSpot,
}) {
  return (
    <>
      {groupedStops.map((group, index) => {
        if (!group.coordinates || isNaN(group.coordinates.lat) || isNaN(group.coordinates.lng)) {
          return null;
        }

        const address = group.primary;
        const stopNumber = group.stopNumber || index + 1;
        const packageCount = group.packageCount || group.items.length;
        const rowIds = group.rowIds || [address.originalRow];
        const pendingRowIds = group.items.filter((item) => !item.delivered).map((item) => item.originalRow);
        const deliveredCount = group.deliveredCount || 0;
        const isDelivered = Boolean(group.isDelivered);
        const isPartiallyDelivered = Boolean(group.isPartiallyDelivered);
        const isSelected = group.items.some((item) => item.originalRow === selectedId);
        const selectedItem = group.items.find((item) => item.originalRow === selectedId) || address;
        const isFirst = index === 0;
        const isLast = index === groupedStops.length - 1 && groupedStops.length > 1;
        const hasQuadraLote = group.items.some((item) => Boolean(item.quadra || item.lote));
        const isManuallyAdjusted = Boolean(group.isManuallyAdjusted);
        const hasAnyOriginal = group.items.some((item) => item.isManuallyAdjusted && item.originalCoordinates);

        const icon = createCustomPin({
          number: stopNumber,
          isStart: isFirst,
          isEnd: isLast,
          isSelected,
          hasQuadraLote,
          isManuallyAdjusted,
          packageCount,
          isDelivered,
          deliveredCount,
        });

        const targetCoords = {
          lat: group.coordinates.lat,
          lng: group.coordinates.lng,
          label: address.recipient || `Parada #${stopNumber}`,
        };

        return (
          <Marker
            key={group.groupId}
            position={[group.coordinates.lat, group.coordinates.lng]}
            icon={icon}
            draggable={!isPickingMapSpot}
            autoPan={true}
            riseOnHover={true}
            riseOffset={2000}
            zIndexOffset={isSelected ? 1000 : isDelivered ? index + 10 : index + 50}
            eventHandlers={{
              click: (e) => {
                if (isPickingMapSpot && onPickMapSpot) {
                  onPickMapSpot(e.latlng || e.target.getLatLng());
                  return;
                }
                onSelect(selectedItem.originalRow, { pan: false });
              },
              dragstart: (e) => {
                e.target.closePopup();
                e.target.setZIndexOffset(3500);
                const el = e.target.getElement();
                if (el) el.classList.add('is-dragging-pin');
              },
              dragend: (e) => {
                const el = e.target.getElement();
                if (el) el.classList.remove('is-dragging-pin');
                e.target.setZIndexOffset(isSelected ? 1000 : isDelivered ? index + 10 : index + 50);
                const newLatLng = e.target.getLatLng();
                const newLat = Number(newLatLng.lat.toFixed(6));
                const newLng = Number(newLatLng.lng.toFixed(6));
                if (onUpdateAddress) {
                  onUpdateAddress(rowIds, {
                    coordinates: { lat: newLat, lng: newLng },
                    isManuallyAdjusted: true,
                  });
                }
              },
            }}
          >
            <Popup className="custom-popup" maxWidth={340} autoPan={false}>
              <div className="popup-card">
                <div className="popup-header">
                  <div className="popup-header-badges">
                    <span className="popup-badge">Parada #{stopNumber}</span>
                    {isDelivered ? (
                      <span className="popup-badge delivered-badge">✅ Entregue</span>
                    ) : isPartiallyDelivered ? (
                      <span className="popup-badge partial-badge">⏳ {deliveredCount}/{packageCount} entregues</span>
                    ) : null}
                    {packageCount > 1 && (
                      <span className="popup-badge pkg-count-badge">📦 {packageCount} pacotes</span>
                    )}
                    {isManuallyAdjusted ? (
                      <span className="popup-badge adjusted-badge">📌 Ajustado</span>
                    ) : (
                      <span className="popup-badge drag-badge">✋ Arrastável</span>
                    )}
                  </div>
                  {packageCount === 1 && address.orderId && (
                    <span className="popup-order">{address.orderId}</span>
                  )}
                </div>

                <h4 className="popup-title">
                  {packageCount > 1
                    ? `${packageCount} pacotes neste endereço`
                    : address.recipient || `Endereço #${address.originalRow}`}
                </h4>

                <div className="popup-drag-hint delivery-drag-hint">
                  ✋ <strong>Posição editável:</strong> Arraste este pino para qualquer local do mapa ou clique em <strong>Editar</strong>.
                </div>

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

                  {packageCount === 1 && address.complement && (
                    <p className="popup-meta">Complemento: {address.complement}</p>
                  )}

                  <p className="popup-meta">
                    {[address.neighborhood, address.city, address.state].filter(Boolean).join(' • ')}
                  </p>

                  {address.zipCode && (
                    <p className="popup-meta font-mono">CEP: {address.zipCode}</p>
                  )}

                  <p className="popup-meta font-mono">
                    {group.coordinates.lat.toFixed(6)}, {group.coordinates.lng.toFixed(6)}
                  </p>

                  {packageCount === 1 && address.phone && (
                    <p className="popup-phone">
                      <a href={`tel:${address.phone.replace(/\D/g, '')}`}>
                        📞 {address.phone}
                      </a>
                    </p>
                  )}

                  {packageCount > 1 && (
                    <div className="popup-packages-list" onClick={(e) => e.stopPropagation()}>
                      {group.items.map((item) => (
                        <div
                          key={`pkg-${item.originalRow}`}
                          className={`popup-package-item ${item.delivered ? 'is-item-delivered' : ''}`}
                        >
                          <div className="popup-pkg-top">
                            <span className="popup-pkg-row">#{item.originalRow}</span>
                            <strong className="popup-pkg-name">
                              {item.recipient || `Pacote #${item.originalRow}`}
                            </strong>
                            {item.orderId && <span className="popup-pkg-order">{item.orderId}</span>}
                            {onConfirmDelivery && (
                              <button
                                type="button"
                                className={`popup-pkg-confirm-btn ${item.delivered ? 'is-done' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onConfirmDelivery(item.originalRow, !item.delivered);
                                }}
                                title={item.delivered ? 'Desfazer entrega deste pacote' : 'Confirmar entrega deste pacote'}
                              >
                                {item.delivered ? '↩️' : '✓'}
                              </button>
                            )}
                            {onEditAddress && (
                              <button
                                type="button"
                                className="popup-pkg-edit-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditAddress(item, stopNumber, group);
                                }}
                                title="Editar este pacote"
                              >
                                ✏️
                              </button>
                            )}
                          </div>
                          {(item.delivered || item.complement || item.phone) && (
                            <div className="popup-pkg-sub">
                              {item.delivered && <span className="popup-pkg-done-tag">✅ Concluído</span>}
                              {item.complement && <span>{item.complement}</span>}
                              {item.phone && (
                                <a href={`tel:${item.phone.replace(/\D/g, '')}`}>📞 {item.phone}</a>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {onConfirmDelivery && (
                  <div className="popup-delivery-confirm-wrap" onClick={(e) => e.stopPropagation()}>
                    {isDelivered ? (
                      <button
                        type="button"
                        className="popup-confirm-delivery-btn is-done"
                        onClick={(e) => {
                          e.stopPropagation();
                          onConfirmDelivery(rowIds, false);
                        }}
                        title="Desfazer entrega e devolver para lista de Entregas"
                      >
                        ↩️ Entregue · Desfazer Confirmação
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="popup-confirm-delivery-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.currentTarget.closest('.leaflet-popup')?.querySelector('.leaflet-popup-close-button')?.click();
                          onConfirmDelivery(pendingRowIds.length > 0 ? pendingRowIds : rowIds, true);
                        }}
                        title="Confirmar entrega (pino ficará cinza e pacotes irão para Histórico)"
                      >
                        ✓ Confirmar Entrega
                        {pendingRowIds.length > 1
                          ? ` (${pendingRowIds.length} pacotes)`
                          : isPartiallyDelivered
                            ? ` (restante #${pendingRowIds[0]})`
                            : ''}
                      </button>
                    )}
                  </div>
                )}

                <div className="popup-actions">
                  <button
                    type="button"
                    className="popup-btn gmaps"
                    onClick={() => {
                      if (onNavigateAddress) {
                        onNavigateAddress(targetCoords, 'google');
                      } else {
                        openNavigationUrl(targetCoords, 'google', userLocation);
                      }
                    }}
                    title="Navegar no Google Maps"
                  >
                    Google Maps ↗
                  </button>
                  <button
                    type="button"
                    className="popup-btn waze"
                    onClick={() => {
                      if (onNavigateAddress) {
                        onNavigateAddress(targetCoords, 'waze');
                      } else {
                        openNavigationUrl(targetCoords, 'waze', userLocation);
                      }
                    }}
                    title="Navegar com Waze"
                  >
                    Waze ↗
                  </button>
                </div>

                <div className="popup-edit-actions" onClick={(e) => e.stopPropagation()}>
                  {onEditAddress && (
                    <button
                      type="button"
                      className="popup-edit-btn primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditAddress(selectedItem, stopNumber, group);
                      }}
                      title="Editar endereço, quadra/lote e posição desta parada"
                    >
                      ✏️ Editar {packageCount > 1 ? `#${selectedItem.originalRow}` : 'Parada'}
                    </button>
                  )}
                  {onStartReposition && (
                    <button
                      type="button"
                      className="popup-edit-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.currentTarget.closest('.leaflet-popup')?.querySelector('.leaflet-popup-close-button')?.click();
                        onStartReposition(address, stopNumber, rowIds);
                      }}
                      title="Clicar em outro ponto do mapa para mover este pino"
                    >
                      🎯 Mover no Mapa
                    </button>
                  )}
                  {hasAnyOriginal && onUpdateAddress && (
                    <button
                      type="button"
                      className="popup-edit-btn reset"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateAddress(rowIds, { restoreOriginal: true });
                      }}
                      title="Voltar este pino para a coordenada original importada"
                    >
                      ↩️ Posição Original
                    </button>
                  )}
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

// Modal compacto para editar dados e posição de um pino de entrega
function EditAddressModal({
  stop,
  stopNumber,
  stopGroup = null,
  quadras,
  onSave,
  onRestoreOriginal,
  onConfirmDelivery,
  onClose,
}) {
  const [recipient, setRecipient] = useState(stop.recipient || '');
  const [street, setStreet] = useState(stop.street || '');
  const [number, setNumber] = useState(stop.number || '');
  const [quadra, setQuadra] = useState(stop.quadra || '');
  const [lote, setLote] = useState(stop.lote || '');
  const [complement, setComplement] = useState(stop.complement || '');
  const [phone, setPhone] = useState(stop.phone || '');
  const [latStr, setLatStr] = useState(
    stop.coordinates && !isNaN(stop.coordinates.lat) ? stop.coordinates.lat.toFixed(6) : ''
  );
  const [lngStr, setLngStr] = useState(
    stop.coordinates && !isNaN(stop.coordinates.lng) ? stop.coordinates.lng.toFixed(6) : ''
  );

  const handleSnapToQuadraCoords = () => {
    if (!quadra.trim() || !quadras || quadras.length === 0) return;
    const formatted = formatQuadraNumber(quadra);
    const match = quadras.find(
      q =>
        formatQuadraNumber(q.rawNumber || q.number).toUpperCase() === formatted.toUpperCase() &&
        !isNaN(q.lat) &&
        !isNaN(q.lng)
    );
    if (match) {
      setLatStr(Number(match.lat).toFixed(6));
      setLngStr(Number(match.lng).toFixed(6));
    } else {
      alert(`Quadra ${formatted} não localizada no mapa de Itaipuaçu.`);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const parsedLat = parseFloat(String(latStr).replace(',', '.'));
    const parsedLng = parseFloat(String(lngStr).replace(',', '.'));
    const hasValidCoords = !isNaN(parsedLat) && !isNaN(parsedLng);

    const coordsChanged =
      hasValidCoords &&
      (!stop.coordinates ||
        Math.abs(parsedLat - stop.coordinates.lat) > 0.0000005 ||
        Math.abs(parsedLng - stop.coordinates.lng) > 0.0000005);

    onSave(stop.originalRow, {
      recipient: recipient.trim(),
      street: street.trim(),
      number: number.trim(),
      quadra: quadra.trim(),
      lote: lote.trim(),
      complement: complement.trim(),
      phone: phone.trim(),
      ...(coordsChanged ? { coordinates: { lat: Number(parsedLat.toFixed(6)), lng: Number(parsedLng.toFixed(6)) }, isManuallyAdjusted: true } : {}),
    });
    onClose();
  };

  return (
    <div className="add-quadra-modal-overlay" onClick={onClose}>
      <div className="add-quadra-modal edit-stop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="add-quadra-modal-header">
          <span className="add-modal-tag edit-stop-tag">✏️ Editar Parada #{stopNumber}</span>
          <button type="button" className="add-modal-close-btn" onClick={onClose} title="Fechar">
            ✕
          </button>
        </div>

        <h4 className="add-modal-title">Editar Entrega e Posição do Pino</h4>
        <p className="edit-stop-hint">
          Você também pode fechar e arrastar o pino diretamente no mapa.
        </p>

        {onConfirmDelivery && (
          <div className="edit-modal-delivery-box">
            {(() => {
              const targetRows = stopGroup?.rowIds?.length ? stopGroup.rowIds : [stop.originalRow];
              const isAllDelivered = stopGroup ? Boolean(stopGroup.isDelivered) : Boolean(stop.delivered);
              const pendingRows = stopGroup
                ? stopGroup.items.filter((i) => !i.delivered).map((i) => i.originalRow)
                : (stop.delivered ? [] : [stop.originalRow]);
              return isAllDelivered ? (
                <button
                  type="button"
                  className="btn-modal-confirm-delivery is-done"
                  onClick={() => {
                    onConfirmDelivery(targetRows, false);
                    onClose();
                  }}
                >
                  ↩️ Entregue · Desfazer Confirmação
                  {targetRows.length > 1 ? ` (${targetRows.length} pacotes)` : ''}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-modal-confirm-delivery"
                  onClick={() => {
                    onConfirmDelivery(pendingRows.length > 0 ? pendingRows : targetRows, true);
                    onClose();
                  }}
                >
                  ✓ Confirmar Entrega
                  {pendingRows.length > 1 ? ` (${pendingRows.length} pacotes do pino)` : ''}
                </button>
              );
            })()}
          </div>
        )}

        <form onSubmit={handleSubmit} className="edit-stop-form">
          <div className="add-modal-field">
            <label htmlFor="edit-stop-recipient">Destinatário / Cliente:</label>
            <input
              id="edit-stop-recipient"
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="edit-stop-input"
              placeholder="Nome do cliente"
            />
          </div>

          <div className="add-modal-field">
            <label htmlFor="edit-stop-street">Rua / Logradouro:</label>
            <input
              id="edit-stop-street"
              type="text"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              className="edit-stop-input"
              placeholder="Nome da rua"
            />
          </div>

          <div className="edit-stop-row-3">
            <div className="add-modal-field">
              <label htmlFor="edit-stop-num">Número:</label>
              <input
                id="edit-stop-num"
                type="text"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                className="edit-stop-input"
                placeholder="S/N"
              />
            </div>
            <div className="add-modal-field">
              <label htmlFor="edit-stop-quadra">Quadra:</label>
              <div className="edit-quadra-inline">
                <input
                  id="edit-stop-quadra"
                  type="text"
                  value={quadra}
                  onChange={(e) => setQuadra(e.target.value)}
                  className="edit-stop-input"
                  placeholder="Ex: 21"
                />
                {quadra.trim() && (
                  <button
                    type="button"
                    className="btn-snap-quadra"
                    onClick={handleSnapToQuadraCoords}
                    title="Usar a coordenada desta Quadra"
                  >
                    📍
                  </button>
                )}
              </div>
            </div>
            <div className="add-modal-field">
              <label htmlFor="edit-stop-lote">Lote:</label>
              <input
                id="edit-stop-lote"
                type="text"
                value={lote}
                onChange={(e) => setLote(e.target.value)}
                className="edit-stop-input"
                placeholder="Ex: 05"
              />
            </div>
          </div>

          <div className="edit-stop-row-2">
            <div className="add-modal-field">
              <label htmlFor="edit-stop-compl">Complemento:</label>
              <input
                id="edit-stop-compl"
                type="text"
                value={complement}
                onChange={(e) => setComplement(e.target.value)}
                className="edit-stop-input"
                placeholder="Casa, Portão..."
              />
            </div>
            <div className="add-modal-field">
              <label htmlFor="edit-stop-phone">Telefone:</label>
              <input
                id="edit-stop-phone"
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="edit-stop-input"
                placeholder="(21) 9..."
              />
            </div>
          </div>

          <div className="edit-stop-coords-box">
            <div className="edit-coords-header">
              <span>Coordenadas do Pino</span>
              {stop.isManuallyAdjusted && stop.originalCoordinates && onRestoreOriginal && (
                <button
                  type="button"
                  className="btn-restore-coords-inline"
                  onClick={() => {
                    onRestoreOriginal(stop.originalRow, { restoreOriginal: true });
                    onClose();
                  }}
                >
                  ↩️ Restaurar original
                </button>
              )}
            </div>
            <div className="edit-stop-row-2">
              <div className="add-modal-field">
                <label htmlFor="edit-stop-lat">Latitude:</label>
                <input
                  id="edit-stop-lat"
                  type="text"
                  value={latStr}
                  onChange={(e) => setLatStr(e.target.value)}
                  className="edit-stop-input font-mono"
                />
              </div>
              <div className="add-modal-field">
                <label htmlFor="edit-stop-lng">Longitude:</label>
                <input
                  id="edit-stop-lng"
                  type="text"
                  value={lngStr}
                  onChange={(e) => setLngStr(e.target.value)}
                  className="edit-stop-input font-mono"
                />
              </div>
            </div>
          </div>

          <div className="add-modal-actions">
            <button type="button" className="btn-modal-cancel" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-modal-submit">
              💾 Salvar Alterações
            </button>
          </div>
        </form>
      </div>
    </div>
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
  routeVersion = 0,
  selectedId,
  onSelect,
  center,
  zoom,
  quadras = itaipuacuQuadras,
  onUpdateQuadra,
  onAddQuadra,
  onDeleteQuadra,
  onUpdateAddress,
  onConfirmDelivery,
  groupedStops = [],
  quadraHighlightRequest = null,
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
  const [prevExtHighlightSeq, setPrevExtHighlightSeq] = useState(0);
  const [viewportSeq, setViewportSeq] = useState(0);
  const [pendingEdits, setPendingEdits] = useState(() => new Map());
  const [draggingQuadra, setDraggingQuadra] = useState(null);
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [editingStop, setEditingStop] = useState(null);
  const [repositioningStop, setRepositioningStop] = useState(null);

  if (quadraHighlightRequest && quadraHighlightRequest.seq !== prevExtHighlightSeq) {
    setPrevExtHighlightSeq(quadraHighlightRequest.seq);
    const norm = normalizeQuadraSearchTerm(quadraHighlightRequest.term);
    setQuadraSearchInput(norm || quadraHighlightRequest.term);
    setSearchedQuadra(norm || null);
    setViewportSeq((v) => v + 1);
  }

  const isPickingMapSpot = isAddingQuadra || Boolean(repositioningStop);

  const handlePickMapSpot = useCallback((latlng) => {
    if (!latlng) return;
    if (repositioningStop) {
      if (onUpdateAddress) {
        onUpdateAddress(repositioningStop.targetRows || repositioningStop.address.originalRow, {
          coordinates: {
            lat: Number(latlng.lat.toFixed(6)),
            lng: Number(latlng.lng.toFixed(6)),
          },
          isManuallyAdjusted: true,
        });
      }
      setRepositioningStop(null);
      return;
    }
    if (isAddingQuadra) {
      setPendingAddPoint(latlng);
    }
  }, [repositioningStop, isAddingQuadra, onUpdateAddress]);

  // Estado da localização do usuário (GPS)
  const [userLocation, setUserLocation] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [locationPromptOpen, setLocationPromptOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const watchIdRef = useRef(null);

  // Limpa watch de geolocalização ao desmontar
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  // Ativa a geolocalização do navegador
  const activateLocation = useCallback((onSuccess, onError) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      const msg = 'Geolocalização não é suportada pelo seu navegador.';
      setLocationError(msg);
      if (onError) onError(msg);
      return;
    }

    setIsLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          accuracy: pos.coords.accuracy,
        };
        setUserLocation(loc);
        setIsLocating(false);

        // Inicia acompanhamento contínuo da posição
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
        }
        watchIdRef.current = navigator.geolocation.watchPosition(
          (watchPos) => {
            setUserLocation({
              lat: Number(watchPos.coords.latitude.toFixed(6)),
              lng: Number(watchPos.coords.longitude.toFixed(6)),
              accuracy: watchPos.coords.accuracy,
            });
          },
          (watchErr) => {
            console.warn('Erro ao atualizar posição contínua:', watchErr);
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
        );

        if (onSuccess) onSuccess(loc);
      },
      (err) => {
        setIsLocating(false);
        let errorMsg = 'Não foi possível obter sua localização.';
        if (err.code === 1) {
          errorMsg = 'Permissão de GPS negada pelo navegador. Habilite o acesso à localização para iniciar rotas do seu ponto atual.';
        } else if (err.code === 2) {
          errorMsg = 'Sinal de GPS indisponível no momento.';
        } else if (err.code === 3) {
          errorMsg = 'Tempo limite esgotado ao buscar o GPS.';
        }
        setLocationError(errorMsg);
        if (onError) onError(errorMsg);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
    );
  }, []);

  const deactivateLocation = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setUserLocation(null);
    setIsLocating(false);
    setLocationError(null);
  }, []);

  // Manipulador ao clicar em navegar para uma quadra ou endereço
  const handleNavigateTarget = useCallback((target, app) => {
    if (userLocation) {
      // Localização já ativa: inicia direto partindo da posição do usuário!
      openNavigationUrl(target, app, userLocation);
    } else {
      // Pergunta se deseja ativar localização para começar a rota a partir do seu local
      setPendingNavigation({ target, app });
      setLocationError(null);
      setLocationPromptOpen(true);
    }
  }, [userLocation]);

  // Ao clicar no botão de localização da barra do mapa
  const handleLocationButtonClick = useCallback(() => {
    if (userLocation) {
      if (mapInstance) {
        mapInstance.flyTo([userLocation.lat, userLocation.lng], 17, { duration: 1.0 });
      }
    } else {
      setPendingNavigation(null);
      setLocationError(null);
      setLocationPromptOpen(true);
    }
  }, [userLocation, mapInstance]);

  // Confirmação de ativação no modal
  const handleConfirmActivateLocation = useCallback(() => {
    activateLocation(
      (loc) => {
        setLocationPromptOpen(false);
        if (mapInstance) {
          mapInstance.flyTo([loc.lat, loc.lng], 16, { duration: 1.0 });
        }
        if (pendingNavigation) {
          openNavigationUrl(pendingNavigation.target, pendingNavigation.app, loc);
          setPendingNavigation(null);
        }
      },
      () => {
        // Erro é tratado e exibido dentro do modal
      }
    );
  }, [activateLocation, mapInstance, pendingNavigation]);

  // Pular ativação e navegar diretamente
  const handleSkipLocationAndNavigate = useCallback(() => {
    if (pendingNavigation) {
      openNavigationUrl(pendingNavigation.target, pendingNavigation.app, null);
      setPendingNavigation(null);
    }
    setLocationPromptOpen(false);
  }, [pendingNavigation]);

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

  const displayGroups = useMemo(() => {
    if (groupedStops && groupedStops.length > 0) return groupedStops;
    return groupDeliveryAddressesForMap(addresses);
  }, [groupedStops, addresses]);

  // Mapeia cada número de parada da planilha (#36, #40...) ao número do pino exibido no mapa
  const pinInfoByRow = useMemo(() => {
    const map = new Map();
    for (const g of displayGroups) {
      for (const r of g.rowIds) {
        map.set(r, { stopNumber: g.stopNumber, isDelivered: Boolean(g.isDelivered) });
      }
    }
    return map;
  }, [displayGroups]);

  const validAddresses = useMemo(() => {
    return addresses.filter(a => a.coordinates && !isNaN(a.coordinates.lat) && !isNaN(a.coordinates.lng));
  }, [addresses]);

  const selectedGroup = useMemo(() => {
    if (selectedId === null || selectedId === undefined) return null;
    return displayGroups.find((g) => g.rowIds.includes(selectedId)) || null;
  }, [displayGroups, selectedId]);

  const selectedAddress = useMemo(() => {
    if (selectedId === null || selectedId === undefined) return null;
    return addresses.find((a) => a.originalRow === selectedId) || null;
  }, [addresses, selectedId]);

  const selectedStopNumber = selectedGroup ? selectedGroup.stopNumber : null;

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

  // Quadras deduplicadas compartilhadas entre a camada do mapa e a contagem na tela atual
  const cleanQuadrasBase = useMemo(() => buildCleanQuadras(quadras), [quadras]);

  // Atualiza contagem de quadras visíveis na tela quando houver filtro ativo
  useEffect(() => {
    if (!mapInstance || !searchedQuadra) return;
    const handleViewportUpdate = () => setViewportSeq((v) => v + 1);
    mapInstance.on('moveend', handleViewportUpdate);
    mapInstance.on('zoomend', handleViewportUpdate);
    return () => {
      mapInstance.off('moveend', handleViewportUpdate);
      mapInstance.off('zoomend', handleViewportUpdate);
    };
  }, [mapInstance, searchedQuadra]);

  const quadraSearchStats = useMemo(() => {
    if (!searchedQuadra) return null;
    void viewportSeq;
    const matches = cleanQuadrasBase.filter(
      (q) =>
        q._label === searchedQuadra ||
        q.number === searchedQuadra ||
        q.rawNumber === searchedQuadra
    );
    let onScreen = matches.length;
    if (mapInstance) {
      const bounds = mapInstance.getBounds();
      onScreen = matches.filter((q) => bounds.contains([q.lat, q.lng])).length;
    }
    return {
      label: searchedQuadra,
      onScreen,
      total: matches.length,
    };
  }, [searchedQuadra, cleanQuadrasBase, mapInstance, viewportSeq]);

  // Destaque rápido da quadra SEM mover/scrollar o mapa da visão atual do usuário
  const handleSearchQuadra = useCallback((e) => {
    e.preventDefault();
    const norm = normalizeQuadraSearchTerm(quadraSearchInput);
    if (!norm) {
      setSearchedQuadra(null);
      return;
    }
    setSearchedQuadra(norm);
    setSearchSeq((s) => s + 1);
    setViewportSeq((v) => v + 1);
  }, [quadraSearchInput]);

  const handleQuadraSearchChange = useCallback((e) => {
    const val = e.target.value;
    setQuadraSearchInput(val);
    const norm = normalizeQuadraSearchTerm(val);
    setSearchedQuadra(norm || null);
    if (norm) {
      setViewportSeq((v) => v + 1);
    }
  }, []);

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
        {/* Botão de Enquadrar */}
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

        {/* Botão de Localização do Usuário (GPS) */}
        <button
          type="button"
          className={`map-control-btn location-toggle-btn ${userLocation ? 'active' : ''} ${isLocating ? 'locating' : ''}`}
          onClick={handleLocationButtonClick}
          title={
            userLocation
              ? 'Centralizar no meu local (GPS ativo)'
              : isLocating
                ? 'Obtendo localização...'
                : 'Ativar minha localização para traçar rotas'
          }
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" fill={userLocation ? '#2563eb' : 'none'} />
            <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
            <circle cx="12" cy="12" r="8" />
          </svg>
          <span>{isLocating ? 'Localizando...' : userLocation ? 'Meu Local' : 'Localização'}</span>
          {userLocation && <span className="location-active-dot"></span>}
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

        {/* Filtro Rápido de Quadra (sem scrollar/navegar do local atual) */}
        <form onSubmit={handleSearchQuadra} className="map-quadra-search-form">
          <input
            type="text"
            placeholder="Quadra na tela..."
            value={quadraSearchInput}
            onChange={handleQuadraSearchChange}
            className="map-quadra-search-input"
            title="Digite o número da quadra para destacar e contar quantas existem na tela sem mover o mapa"
          />
          {quadraSearchInput ? (
            <button
              type="button"
              className="btn-search-quadra clear"
              onClick={() => {
                setQuadraSearchInput('');
                setSearchedQuadra(null);
              }}
              title="Limpar busca de quadra"
            >
              ✕
            </button>
          ) : (
            <button type="submit" className="btn-search-quadra" title="Destacar quadras visíveis na tela">
              🔍
            </button>
          )}
        </form>

        {quadraSearchStats && (
          <div
            className={`quadra-search-count-pill ${quadraSearchStats.onScreen > 0 ? 'has-match' : 'no-match'}`}
            title={`Quadra ${quadraSearchStats.label}: ${quadraSearchStats.onScreen} na visualização atual, ${quadraSearchStats.total} no mapa`}
          >
            <span>
              Qd {quadraSearchStats.label}: <strong>{quadraSearchStats.onScreen}</strong> na tela
              <small className="qsc-total"> ({quadraSearchStats.total} total)</small>
            </span>
          </div>
        )}

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

        {displayGroups.length > 0 && (
          <div className="map-badge-counter">
            <span className="dot-live"></span>
            {displayGroups.length < validAddresses.length ? (
              <>
                <strong>{displayGroups.length}</strong> pinos · {validAddresses.length} pacotes
              </>
            ) : (
              <>
                <strong>{displayGroups.length}</strong> paradas
              </>
            )}
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
        className={`leaflet-map ${isPickingMapSpot ? 'is-adding-quadra' : ''}`}
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
          routeVersion={routeVersion}
          onMapReady={setMapInstance}
        />

        {/* Camada das Quadras de Itaipuaçu (Verde como na foto e no PDF) */}
        <QuadraLayer
          quadras={quadras}
          cleanQuadrasBase={cleanQuadrasBase}
          pendingEdits={pendingEdits}
          deliveryQuadrasMap={deliveryQuadrasMap}
          pinInfoByRow={pinInfoByRow}
          highlightedQuadra={highlightedQuadra}
          searchSeq={searchSeq}
          onSelectQuadra={() => {}}
          onDeselectQuadra={() => {
            setAdjustMode(false);
          }}
          showQuadras={showQuadras}
          adjustMode={adjustMode}
          isAddingQuadra={isPickingMapSpot}
          onAddMapClick={handlePickMapSpot}
          onStageQuadraEdit={handleStageQuadraEdit}
          onDragActiveChange={setDraggingQuadra}
          onDeleteQuadra={handleDeleteQuadraWithCleanup}
          userLocation={userLocation}
          onNavigateQuadra={handleNavigateTarget}
          onRequestActivateLocation={handleLocationButtonClick}
        />

        {/* Marcadores de Entregas da Rota */}
        <AddressMarkers
          groupedStops={displayGroups}
          selectedId={selectedId}
          onSelect={onSelect}
          userLocation={userLocation}
          onNavigateAddress={handleNavigateTarget}
          onUpdateAddress={onUpdateAddress}
          onConfirmDelivery={onConfirmDelivery}
          onEditAddress={(address, stopNumber, group = null) => setEditingStop({ address, stopNumber, group })}
          onStartReposition={(address, stopNumber, targetRows) => {
            setIsAddingQuadra(false);
            setPendingAddPoint(null);
            setRepositioningStop({ address, stopNumber, targetRows });
          }}
          isPickingMapSpot={isPickingMapSpot}
          onPickMapSpot={handlePickMapSpot}
        />

        {/* Marcador e Raio de Precisão da Localização do Usuário */}
        {userLocation && (
          <>
            {userLocation.accuracy && (
              <Circle
                center={[userLocation.lat, userLocation.lng]}
                radius={Math.min(userLocation.accuracy, 300)}
                pathOptions={{
                  fillColor: '#2563eb',
                  fillOpacity: 0.12,
                  color: '#3b82f6',
                  weight: 1.5,
                  dashArray: '4, 4',
                }}
              />
            )}
            <Marker
              position={[userLocation.lat, userLocation.lng]}
              icon={userLocationIcon}
              zIndexOffset={3500}
            >
              <Popup className="custom-popup user-location-popup" maxWidth={260}>
                <div className="popup-card user-loc-card">
                  <div className="popup-header">
                    <span className="popup-badge user-loc-badge">📍 Seu Local</span>
                    <button
                      type="button"
                      className="btn-disable-gps-tag"
                      onClick={(e) => {
                        e.stopPropagation();
                        deactivateLocation();
                      }}
                      title="Desativar acompanhamento de GPS"
                    >
                      Desativar
                    </button>
                  </div>
                  <h4 className="popup-title">Você está aqui</h4>
                  <p className="popup-meta font-mono">
                    {userLocation.lat.toFixed(6)}, {userLocation.lng.toFixed(6)}
                  </p>
                  {userLocation.accuracy && (
                    <p className="popup-meta user-loc-accuracy">
                      Precisão do GPS: ~{Math.round(userLocation.accuracy)}m
                    </p>
                  )}
                </div>
              </Popup>
            </Marker>
          </>
        )}

        <MapClickHandler
          onMapBackgroundClick={() => {
            if (!isPickingMapSpot) {
              setAdjustMode(false);
              setSearchedQuadra(null);
            }
          }}
          isAddingQuadra={isPickingMapSpot}
          onAddMapClick={handlePickMapSpot}
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

      {/* Banner flutuante no topo ao clicar "Mover no Mapa" para uma parada */}
      {repositioningStop && (
        <div className="add-quadra-banner reposition-stop-banner">
          <span className="banner-pulse"></span>
          <span>
            🎯{' '}
            <strong>
              Mover Parada #{repositioningStop.stopNumber}
              {repositioningStop.targetRows && repositioningStop.targetRows.length > 1
                ? ` (${repositioningStop.targetRows.length} pacotes)`
                : ''}
              :
            </strong>{' '}
            Clique em qualquer ponto do mapa para posicionar este pino lá.
          </span>
          <button
            type="button"
            className="btn-cancel-banner"
            onClick={() => setRepositioningStop(null)}
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
      {selectedAddress && !draggingQuadra && pendingEditsList.length === 0 && !repositioningStop && (
        <div className="map-selected-card">
          <div className="card-info">
            <div className="card-meta">
              <span className="card-badge">Parada #{selectedStopNumber || selectedAddress.originalRow}</span>
              {(selectedGroup?.isDelivered || selectedAddress.delivered) && (
                <span className="card-tag delivered">✅ Entregue</span>
              )}
              {selectedGroup && selectedGroup.packageCount > 1 && (
                <span className="card-tag pkg-count">
                  📦 {selectedGroup.packageCount} pacotes neste pino
                </span>
              )}
              {selectedAddress.quadra && (
                <span className="card-tag quadra">Quadra {selectedAddress.quadra}</span>
              )}
              {selectedAddress.lote && (
                <span className="card-tag lote">Lote {selectedAddress.lote}</span>
              )}
              {selectedAddress.isManuallyAdjusted && (
                <span className="card-tag adjusted">📌 Ajustado</span>
              )}
            </div>
            <strong className="card-name">{selectedAddress.recipient}</strong>
            <p className="card-street">
              {selectedAddress.street}{selectedAddress.number ? `, Nº ${selectedAddress.number}` : ''}
            </p>
          </div>

          <div className="card-actions">
            {onConfirmDelivery && (
              <button
                type="button"
                className={`card-btn-action confirm-delivery ${selectedGroup?.isDelivered ? 'is-done' : ''}`}
                onClick={() => {
                  const targetRows = selectedGroup?.rowIds || [selectedAddress.originalRow];
                  onConfirmDelivery(targetRows, !selectedGroup?.isDelivered);
                }}
                title={
                  selectedGroup?.isDelivered
                    ? 'Desfazer entrega deste pino'
                    : 'Confirmar entrega deste pino (pino ficará cinza)'
                }
              >
                {selectedGroup?.isDelivered ? '↩️ Entregue' : '✓ Confirmar'}
              </button>
            )}
            {onUpdateAddress && (
              <>
                <button
                  type="button"
                  className="card-btn-action edit-pin"
                  onClick={() =>
                    setEditingStop({
                      address: selectedAddress,
                      stopNumber: selectedStopNumber || selectedAddress.originalRow,
                      group: selectedGroup,
                    })
                  }
                  title="Editar informações e coordenadas deste pino"
                >
                  ✏️ Editar
                </button>
                <button
                  type="button"
                  className="card-btn-action move-pin"
                  onClick={() => {
                    setIsAddingQuadra(false);
                    setPendingAddPoint(null);
                    setRepositioningStop({
                      address: selectedAddress,
                      stopNumber: selectedStopNumber || selectedAddress.originalRow,
                      targetRows: selectedGroup?.rowIds || [selectedAddress.originalRow],
                    });
                  }}
                  title="Clicar em um ponto do mapa para mover este pino"
                >
                  🎯 Mover
                </button>
              </>
            )}
            {selectedAddress.coordinates && (
              <>
                <button
                  type="button"
                  className="card-btn-action gmaps"
                  onClick={() => handleNavigateTarget({
                    lat: selectedAddress.coordinates.lat,
                    lng: selectedAddress.coordinates.lng,
                    label: selectedAddress.recipient || `Parada #${selectedStopNumber || selectedAddress.originalRow}`
                  }, 'google')}
                  title="Navegar no Google Maps"
                >
                  Google Maps ↗
                </button>
                <button
                  type="button"
                  className="card-btn-action waze"
                  onClick={() => handleNavigateTarget({
                    lat: selectedAddress.coordinates.lat,
                    lng: selectedAddress.coordinates.lng,
                    label: selectedAddress.recipient || `Parada #${selectedStopNumber || selectedAddress.originalRow}`
                  }, 'waze')}
                  title="Navegar no Waze"
                >
                  Waze ↗
                </button>
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

      {/* Modal de Edição Completa da Parada / Pino */}
      {editingStop && (
        <EditAddressModal
          key={editingStop.address.originalRow}
          stop={editingStop.address}
          stopNumber={editingStop.stopNumber}
          stopGroup={editingStop.group || displayGroups.find((g) => g.rowIds.includes(editingStop.address.originalRow)) || null}
          quadras={quadras}
          onSave={onUpdateAddress}
          onRestoreOriginal={onUpdateAddress}
          onConfirmDelivery={onConfirmDelivery}
          onClose={() => setEditingStop(null)}
        />
      )}

      {/* Modal de Pergunta / Ativação de Localização */}
      {locationPromptOpen && (
        <div
          className="location-modal-overlay"
          onClick={() => {
            if (!isLocating) {
              setLocationPromptOpen(false);
              setPendingNavigation(null);
            }
          }}
        >
          <div className="location-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="location-modal-icon-header">
              <div className="location-icon-radar">
                <span className="radar-wave"></span>
                <span className="radar-center-icon">📍</span>
              </div>
            </div>

            <h3 className="location-modal-title">
              {pendingNavigation ? 'Começar rota do seu local?' : 'Ativar sua localização?'}
            </h3>

            <p className="location-modal-desc">
              {pendingNavigation ? (
                <>
                  Deseja ativar sua localização para iniciar a rota saindo de onde você está até a{' '}
                  <strong>
                    Quadra #{formatQuadraNumber(pendingNavigation.target.rawNumber || pendingNavigation.target.number || pendingNavigation.target.label)}
                  </strong>{' '}
                  no {pendingNavigation.app === 'google' ? 'Google Maps' : 'Waze'}?
                </>
              ) : (
                'Ative sua localização para ver sua posição em tempo real no mapa e começar rotas partindo de onde você estiver.'
              )}
            </p>

            {locationError && (
              <div className="location-modal-error">
                <span className="error-icon">⚠️</span>
                <span>{locationError}</span>
              </div>
            )}

            <div className="location-modal-buttons">
              <button
                type="button"
                className="btn-location-primary"
                onClick={handleConfirmActivateLocation}
                disabled={isLocating}
              >
                {isLocating ? (
                  <>
                    <span className="btn-spinner"></span>
                    <span>Obtendo sinal do GPS...</span>
                  </>
                ) : (
                  <>
                    <span>📍 Sim, Ativar Localização</span>
                    {pendingNavigation && <span className="btn-subtext">e iniciar rota</span>}
                  </>
                )}
              </button>

              {pendingNavigation && (
                <button
                  type="button"
                  className="btn-location-secondary"
                  onClick={handleSkipLocationAndNavigate}
                  disabled={isLocating}
                >
                  🚗 Navegar sem ativar local
                </button>
              )}

              <button
                type="button"
                className="btn-location-cancel"
                onClick={() => {
                  setLocationPromptOpen(false);
                  setPendingNavigation(null);
                }}
                disabled={isLocating}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
