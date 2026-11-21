import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Focus,
  Navigation,
  Layers,
  CheckCheck,
  Move,
  Plus,
  Search,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  RotateCcw,
  Edit3,
  MapPin,
  Map as MapIcon,
  Phone,
  X,
  MessageCircle,
  Package,
  Menu,
  Check,
} from 'lucide-react';
import itaipuacuQuadras from '../data/itaipuacuQuadras.json';
import { groupDeliveryAddressesForMap } from '../utils/addressGrouping';
import './MapView.css';

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
function createCustomPinHtml({
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
  let html = deliveryPinCache.get(key);
  if (!html) {
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

    html = `
      <div class="custom-marker-wrapper ${selectedClass} ${adjustedClass} ${multiPkgClass} ${deliveredClass}">
        ${topBadgeHtml}
        <div class="custom-marker-pin ${bgClass}">
          <span class="custom-marker-text">${isDelivered ? '✓' : label}</span>
        </div>
        ${isDelivered ? '<span class="pin-verified-badge" title="Entrega confirmada">✓</span>' : ''}
        ${isManuallyAdjusted && !isDelivered ? '<span class="pin-adjusted-dot" title="Posição ajustada manualmente"></span>' : ''}
        <div class="custom-marker-shadow"></div>
        ${isSelected ? '<div class="custom-marker-pulse"></div>' : ''}
      </div>
    `;
    deliveryPinCache.set(key, html);
  }
  return html;
}

// Formata números de quadras: 01 a 09 mantêm o zero na frente (ex: 01, 09), 10 em diante não têm zero na frente
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

// Cache de HTML dos badges de quadras
const quadraHtmlCache = new Map();

function getCachedQuadraHtml(quadra, hasDelivery, isHighlighted, isDraggable, isPendingSave = false) {
  const label = formatQuadraNumber(quadra.rawNumber || quadra.number);
  const key = `${label}-${hasDelivery ? 'd' : ''}-${isHighlighted ? 'h' : ''}-${isDraggable ? 'g' : ''}-${isPendingSave ? 'p' : ''}`;
  let html = quadraHtmlCache.get(key);
  if (!html) {
    const deliveryClass = hasDelivery ? 'has-delivery' : '';
    const highlightClass = isHighlighted ? 'is-highlighted' : '';
    const draggableClass = isDraggable ? 'is-draggable' : '';
    const pendingClass = isPendingSave ? 'is-pending-save' : '';

    html = `
      <div class="quadra-marker-box ${deliveryClass} ${highlightClass} ${draggableClass} ${pendingClass}">
        ${isDraggable ? '<span class="drag-handle-dot">⠿</span>' : ''}
        <span class="quadra-marker-num">${label}</span>
        ${hasDelivery ? '<span class="delivery-indicator-dot"></span>' : ''}
      </div>
    `;
    quadraHtmlCache.set(key, html);
  }
  return html;
}

// Normaliza termos de busca de quadra
function normalizeQuadraSearchTerm(rawInput) {
  if (!rawInput) return '';
  const cleaned = String(rawInput)
    .trim()
    .replace(/^(?:quadra|quad\.?|qd\.?|q\.?)\s*(?:n[º°.]?\s*)?[:\-_/\s]*/i, '');
  if (!cleaned) return '';
  return formatQuadraNumber(cleaned);
}

// Deduplica quadras mantendo instâncias em loteamentos distintos (>160m)
function buildCleanQuadras(quadrasList) {
  if (!quadrasList || quadrasList.length === 0) return [];
  const result = [];
  const byNorm = new Map();

  for (let i = 0; i < quadrasList.length; i++) {
    const q = quadrasList[i];
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

// Estilos de Mapas em MapLibre (WebGL Hardware Accelerated)
const MAP_STYLES = {
  osm: {
    version: 8,
    sources: {
      'osm-raster': {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap Contributors',
      },
    },
    layers: [
      {
        id: 'osm-tiles',
        type: 'raster',
        source: 'osm-raster',
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  },
  voyager: {
    version: 8,
    sources: {
      'voyager-raster': {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: '&copy; CartoDB &copy; OpenStreetMap',
      },
    },
    layers: [
      {
        id: 'voyager-tiles',
        type: 'raster',
        source: 'voyager-raster',
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  },
  satellite: {
    version: 8,
    sources: {
      'satellite-raster': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution: '&copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
      },
    },
    layers: [
      {
        id: 'satellite-tiles',
        type: 'raster',
        source: 'satellite-raster',
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  },
};

// Modal compacto para editar dados e posição de um pino de entrega
function EditAddressModal({
  stop,
  stopNumber,
  quadras,
  onSave,
  onRestoreOriginal,
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
      (q) =>
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
      ...(coordsChanged
        ? {
            coordinates: { lat: Number(parsedLat.toFixed(6)), lng: Number(parsedLng.toFixed(6)) },
            isManuallyAdjusted: true,
          }
        : {}),
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
        <p className="edit-stop-hint">Você também pode fechar e arrastar o pino diretamente no mapa.</p>

        <form onSubmit={handleSubmit} className="add-quadra-form">
          <div className="add-modal-field">
            <label htmlFor="edit-stop-recipient">Destinatário:</label>
            <input
              id="edit-stop-recipient"
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="edit-stop-input"
              placeholder="Nome do cliente"
            />
          </div>

          <div className="edit-stop-row-2">
            <div className="add-modal-field flex-3">
              <label htmlFor="edit-stop-street">Rua / Logradouro:</label>
              <input
                id="edit-stop-street"
                type="text"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                className="edit-stop-input"
                placeholder="Rua ou Av."
              />
            </div>
            <div className="add-modal-field flex-1">
              <label htmlFor="edit-stop-num">Nº:</label>
              <input
                id="edit-stop-num"
                type="text"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                className="edit-stop-input"
                placeholder="S/N"
              />
            </div>
          </div>

          <div className="edit-stop-row-2">
            <div className="add-modal-field">
              <div className="edit-label-with-action">
                <label htmlFor="edit-stop-quadra">Quadra:</label>
                {quadra.trim() && (
                  <button
                    type="button"
                    className="btn-link-snap"
                    onClick={handleSnapToQuadraCoords}
                    title="Usar coordenadas do loteamento desta quadra"
                  >
                    🎯 Puxar coords
                  </button>
                )}
              </div>
              <input
                id="edit-stop-quadra"
                type="text"
                value={quadra}
                onChange={(e) => setQuadra(e.target.value)}
                className="edit-stop-input font-bold"
                placeholder="Ex: 40"
              />
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
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Estados principais
  const [tileStyle, setTileStyle] = useState('osm');
  const [showQuadras, setShowQuadras] = useState(true);
  const [showOnlyActiveQuadras, setShowOnlyActiveQuadras] = useState(false);
  const [adjustMode, setAdjustMode] = useState(false);
  const [isAddingQuadra, setIsAddingQuadra] = useState(false);
  const [pendingAddPoint, setPendingAddPoint] = useState(null);
  const [newQuadraNumber, setNewQuadraNumber] = useState('');
  const [quadraSearchInput, setQuadraSearchInput] = useState('');
  const [searchedQuadra, setSearchedQuadra] = useState(null);
  const [prevExtHighlightSeq, setPrevExtHighlightSeq] = useState(0);
  const [viewportSeq, setViewportSeq] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Edições de quadras
  const [pendingEdits, setPendingEdits] = useState(() => new Map());
  const [draggingQuadra, setDraggingQuadra] = useState(null);
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [activePopupQuadra, setActivePopupQuadra] = useState(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState(null);

  // Edições de entregas
  const [editingStop, setEditingStop] = useState(null);
  const [repositioningStop, setRepositioningStop] = useState(null);
  const [isBottomSheetExpanded, setIsBottomSheetExpanded] = useState(false);
  const touchStartYRef = useRef(0);

  useEffect(() => {
    setIsBottomSheetExpanded(false);
  }, [selectedId]);

  const handleTouchStart = (e) => {
    if (e.touches && e.touches[0]) {
      touchStartYRef.current = e.touches[0].clientY;
    }
  };

  const handleTouchEnd = (e) => {
    if (e.changedTouches && e.changedTouches[0]) {
      const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
      if (deltaY < -35) {
        setIsBottomSheetExpanded(true);
      } else if (deltaY > 35) {
        setIsBottomSheetExpanded(false);
      }
    }
  };

  // GPS / Localização
  const [userLocation, setUserLocation] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [locationPromptOpen, setLocationPromptOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const watchIdRef = useRef(null);

  // Pools de marcadores e popups do MapLibre
  const quadraMarkersRef = useRef(new Map());
  const deliveryMarkersRef = useRef(new Map());
  const userLocMarkerRef = useRef(null);
  const quadraPopupRef = useRef(null);
  const lastMarkerClickTimeRef = useRef(0);
  const quadraPopupNode = useMemo(() => {
    const node = document.createElement('div');
    node.className = 'custom-popup-portal-root';
    return node;
  }, []);
  const [currentBounds, setCurrentBounds] = useState(null);
  const lastFittedRouteVersionRef = useRef(null);
  const lastCenterRef = useRef(null);

  // Destaque externo de quadra (da lista de entregas)
  if (quadraHighlightRequest && quadraHighlightRequest.seq !== prevExtHighlightSeq) {
    setPrevExtHighlightSeq(quadraHighlightRequest.seq);
    const norm = normalizeQuadraSearchTerm(quadraHighlightRequest.term);
    setQuadraSearchInput(norm || quadraHighlightRequest.term);
    setSearchedQuadra(norm || null);
    setViewportSeq((v) => v + 1);
  }

  const isPickingMapSpot = isAddingQuadra || Boolean(repositioningStop);

  const cleanQuadrasBase = useMemo(() => buildCleanQuadras(quadras), [quadras]);

  // Sobrepõe coordenadas temporárias arrastadas
  const cleanQuadras = useMemo(() => {
    if (!pendingEdits || pendingEdits.size === 0) return cleanQuadrasBase;
    return cleanQuadrasBase.map((q) => {
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
  }, [cleanQuadrasBase, pendingEdits]);

  // Mapeamento de entregas por quadra para destaque rápido
  const deliveryQuadrasMap = useMemo(() => {
    const map = new Map();
    for (const a of addresses) {
      if (a.quadra) {
        const numInt = parseInt(a.quadra, 10);
        const key = isNaN(numInt) ? String(a.quadra).trim() : numInt;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(a);

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

  // Mapeia cada número de parada da planilha (#36, #40...) ao número do pino no mapa
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
    return addresses.filter(
      (a) => a.coordinates && !isNaN(a.coordinates.lat) && !isNaN(a.coordinates.lng)
    );
  }, [addresses]);

  const selectedGroup = useMemo(() => {
    if (selectedId === null || selectedId === undefined) return null;
    return displayGroups.find((g) => g.rowIds.includes(selectedId)) || null;
  }, [displayGroups, selectedId]);

  const selectedAddress = useMemo(() => {
    if (selectedId === null || selectedId === undefined) return null;
    return addresses.find((a) => a.originalRow === selectedId) || null;
  }, [addresses, selectedId]);

  const selectedStopNumber = useMemo(() => {
    if (!selectedAddress) return null;
    return selectedGroup ? selectedGroup.stopNumber : null;
  }, [selectedAddress, selectedGroup]);

  // Contagem de quadras com entregas ativas
  const activeQuadrasCount = useMemo(() => {
    let count = 0;
    for (const q of cleanQuadrasBase) {
      if (
        deliveryQuadrasMap.has(q._numInt) ||
        deliveryQuadrasMap.has(q.rawNumber) ||
        deliveryQuadrasMap.has(q._label)
      ) {
        count++;
      }
    }
    return count;
  }, [cleanQuadrasBase, deliveryQuadrasMap]);

  // Ref de estado atualizado para uso dentro dos callbacks do MapLibre sem recriar o mapa
  const stateRef = useRef({
    cleanQuadras,
    deliveryQuadrasMap,
    displayGroups,
    selectedId,
    searchedQuadra,
    showQuadras,
    showOnlyActiveQuadras,
    adjustMode,
    isPickingMapSpot,
    isAddingQuadra,
    repositioningStop,
  });

  useEffect(() => {
    stateRef.current = {
      cleanQuadras,
      deliveryQuadrasMap,
      displayGroups,
      selectedId,
      searchedQuadra,
      showQuadras,
      showOnlyActiveQuadras,
      adjustMode,
      isPickingMapSpot,
      isAddingQuadra,
      repositioningStop,
    };
  }, [
    cleanQuadras,
    deliveryQuadrasMap,
    displayGroups,
    selectedId,
    searchedQuadra,
    showQuadras,
    showOnlyActiveQuadras,
    adjustMode,
    isPickingMapSpot,
    isAddingQuadra,
    repositioningStop,
  ]);

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
          const isHttpInsecure =
            typeof window !== 'undefined' &&
            !window.isSecureContext &&
            window.location.hostname !== 'localhost' &&
            window.location.hostname !== '127.0.0.1';
          if (isHttpInsecure) {
            errorMsg =
              'O navegador bloqueia o GPS interno em conexões HTTP na rede local. Para abrir a rota, clique em "Navegar sem ativar local" abaixo — o Waze e Google Maps usarão o GPS do seu aparelho normalmente!';
          } else {
            errorMsg =
              'Permissão de GPS negada pelo navegador. Toque no ícone de ajustes/cadeado ao lado da barra de endereço e mude Localização para "Permitir".';
          }
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

  const handleNavigateTarget = useCallback(
    (target, app) => {
      if (userLocation) {
        openNavigationUrl(target, app, userLocation);
      } else {
        setPendingNavigation({ target, app });
        setLocationError(null);
        setLocationPromptOpen(true);
      }
    },
    [userLocation]
  );

  const handleLocationButtonClick = useCallback(() => {
    if (userLocation && mapRef.current) {
      mapRef.current.flyTo({
        center: [userLocation.lng, userLocation.lat],
        zoom: 17,
        duration: 1000,
      });
    } else {
      setPendingNavigation(null);
      setLocationError(null);
      setLocationPromptOpen(true);
    }
  }, [userLocation]);

  const handleConfirmActivateLocation = useCallback(() => {
    activateLocation(
      (loc) => {
        setLocationPromptOpen(false);
        if (mapRef.current) {
          mapRef.current.flyTo({
            center: [loc.lng, loc.lat],
            zoom: 16,
            duration: 1000,
          });
        }
        if (pendingNavigation) {
          openNavigationUrl(pendingNavigation.target, pendingNavigation.app, loc);
          setPendingNavigation(null);
        }
      },
      () => {}
    );
  }, [activateLocation, pendingNavigation]);

  const handleSkipLocationAndNavigate = useCallback(() => {
    if (!pendingNavigation) return;
    openNavigationUrl(pendingNavigation.target, pendingNavigation.app, null);
    setLocationPromptOpen(false);
    setPendingNavigation(null);
  }, [pendingNavigation]);

  // Estágio e salvamento de quadras
  const handleStageQuadraEdit = useCallback((updatedQuadra) => {
    const key =
      updatedQuadra._key ||
      updatedQuadra.id ||
      `${formatQuadraNumber(updatedQuadra.rawNumber || updatedQuadra.number)}-${updatedQuadra.lat}-${updatedQuadra.lng}`;
    setPendingEdits((prev) => {
      const next = new Map(prev);
      next.set(key, updatedQuadra);
      return next;
    });
  }, []);

  const pendingEditsList = useMemo(() => Array.from(pendingEdits.values()), [pendingEdits]);

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

  const handleDiscardPendingEdits = useCallback(() => {
    setPendingEdits(new Map());
  }, []);

  const handleDeleteQuadraWithCleanup = useCallback(
    (target) => {
      if (!target) return;
      if (onDeleteQuadra) {
        onDeleteQuadra(target);
      }
      setPendingEdits((prev) => {
        if (!prev.has(target._key)) return prev;
        const next = new Map(prev);
        next.delete(target._key);
        return next;
      });
      setActivePopupQuadra(null);
    },
    [onDeleteQuadra]
  );

  // Agrupa pinos de entrega da quadra perto das coordenadas da quadra
  const handleGatherPins = useCallback(
    (deliveries, quadra, pinInfo) => {
      if (!onUpdateAddress || !deliveries?.length) return;

      const pinGroups = new Map();
      for (const d of deliveries) {
        const stopKey = pinInfo?.get(d.originalRow)?.stopNumber ?? `solo_${d.originalRow}`;
        if (!pinGroups.has(stopKey)) pinGroups.set(stopKey, []);
        pinGroups.get(stopKey).push(d);
      }

      const offsetStep = 0.00008;
      const groups = [...pinGroups.values()];
      groups.forEach((groupRows, i) => {
        const angle = (i / groups.length) * 2 * Math.PI;
        const radius = i === 0 ? 0 : offsetStep * (1 + Math.floor(i / 6));
        const lat = Number((quadra.lat + radius * Math.cos(angle)).toFixed(6));
        const lng = Number((quadra.lng + radius * Math.sin(angle)).toFixed(6));
        const isLast = i === groups.length - 1;
        groupRows.forEach((d, j) => {
          const silent = !isLast || j < groupRows.length - 1;
          onUpdateAddress(d.originalRow, { coordinates: { lat, lng }, isManuallyAdjusted: true }, silent);
        });
      });
    },
    [onUpdateAddress]
  );

  const handlePickMapSpot = useCallback(
    (coords) => {
      if (!coords) return;
      if (repositioningStop) {
        if (onUpdateAddress) {
          onUpdateAddress(repositioningStop.targetRows || repositioningStop.address.originalRow, {
            coordinates: {
              lat: Number(coords.lat.toFixed(6)),
              lng: Number(coords.lng.toFixed(6)),
            },
            isManuallyAdjusted: true,
          });
        }
        setRepositioningStop(null);
        return;
      }
      if (isAddingQuadra) {
        setPendingAddPoint(coords);
      }
    },
    [repositioningStop, isAddingQuadra, onUpdateAddress]
  );

  // Inicialização do MapLibre GL
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Coordenadas padrão de Itaipuaçu [lng, lat]
    const defaultCenter = [-42.9912, -22.9515];
    const initialCenter =
      center && center.length === 2 && !isNaN(center[0]) && !isNaN(center[1])
        ? [center[1], center[0]]
        : defaultCenter;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLES[tileStyle] || MAP_STYLES.osm,
      center: initialCenter,
      zoom: zoom || 15,
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), 'bottom-right');

    // Popup com DOM container para React Portal da Quadra
    const qPopup = new maplibregl.Popup({
      offset: 14,
      closeButton: true,
      closeOnClick: false,
      maxWidth: '360px',
      className: 'custom-popup',
    });
    qPopup.setDOMContent(quadraPopupNode);
    qPopup.on('close', () => {
      setActivePopupQuadra(null);
      setConfirmDeleteKey(null);
    });
    quadraPopupRef.current = qPopup;

    map.on('load', () => {
      setMapLoaded(true);
      setCurrentBounds(map.getBounds());
    });

    map.on('moveend', () => {
      if (stateRef.current.searchedQuadra) {
        setCurrentBounds(map.getBounds());
      }
    });

    // Clique no fundo do mapa (não fecha se clicou em marcador ou popup)
    map.on('click', (e) => {
      // 1. Se acabou de clicar em um marcador, ignora o clique de fundo do mapa
      if (Date.now() - lastMarkerClickTimeRef.current < 400) {
        return;
      }

      // 2. Se o clique foi originado em um marcador ou dentro do popup, não fecha
      const target = e.originalEvent?.target;
      if (
        target &&
        (target.closest('.maplibregl-popup') ||
          target.closest('.maplibregl-marker') ||
          target.closest('.quadra-div-marker') ||
          target.closest('.delivery-marker-wrapper') ||
          target.closest('.custom-marker-wrapper'))
      ) {
        return;
      }

      const st = stateRef.current;
      if (st.isPickingMapSpot) {
        handlePickMapSpot({ lat: e.lngLat.lat, lng: e.lngLat.lng });
        return;
      }

      // Clique real no fundo vazio do mapa: fecha popup da quadra e deseleciona parada
      setConfirmDeleteKey(null);
      setActivePopupQuadra(null);
      if (onSelect) {
        onSelect(null, { pan: false });
      }
      if (qPopup.isOpen()) qPopup.remove();
    });

    mapRef.current = map;

    return () => {
      if (qPopup.isOpen()) qPopup.remove();
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Altera estilo do mapa quando o usuário troca (Rua / Claro / Satélite)
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setStyle(MAP_STYLES[tileStyle] || MAP_STYLES.osm);
  }, [tileStyle]);

  // Sincroniza centro e zoom solicitados externamente (apenas se a coordenada mudou)
  useEffect(() => {
    if (!mapRef.current || !center || center.length !== 2 || isNaN(center[0]) || isNaN(center[1])) return;
    if (
      lastCenterRef.current &&
      lastCenterRef.current[0] === center[0] &&
      lastCenterRef.current[1] === center[1] &&
      lastCenterRef.current[2] === zoom
    ) {
      return;
    }
    lastCenterRef.current = [center[0], center[1], zoom];
    mapRef.current.flyTo({
      center: [center[1], center[0]],
      zoom: zoom || 16,
      duration: 800,
    });
  }, [center, zoom]);

  // FitBounds APENAS quando uma NOVA rota é carregada (routeVersion muda)
  useEffect(() => {
    if (!mapRef.current || !addresses || addresses.length === 0) {
      lastFittedRouteVersionRef.current = null;
      return;
    }

    // Não re-enquadra se a versão da rota já foi enquadrada
    if (lastFittedRouteVersionRef.current === routeVersion) return;

    const valid = addresses.filter(
      (a) => a.coordinates && !isNaN(a.coordinates.lat) && !isNaN(a.coordinates.lng)
    );
    if (valid.length === 0) return;

    lastFittedRouteVersionRef.current = routeVersion;

    const bounds = new maplibregl.LngLatBounds();
    valid.forEach((a) => {
      bounds.extend([a.coordinates.lng, a.coordinates.lat]);
    });
    try {
      mapRef.current.fitBounds(bounds, { padding: 50, duration: 1000, maxZoom: 16.5 });
    } catch (e) {
      console.warn('Erro ao enquadrar mapa:', e);
    }
  }, [routeVersion, addresses]);

  // Evita que cliques dentro do nó do popup propaguem para o mapa
  useEffect(() => {
    const stopBubble = (e) => {
      e.stopPropagation();
      lastMarkerClickTimeRef.current = Date.now();
    };
    const qNode = quadraPopupNode;
    qNode.addEventListener('click', stopBubble);
    qNode.addEventListener('pointerdown', stopBubble);
    return () => {
      qNode.removeEventListener('click', stopBubble);
      qNode.removeEventListener('pointerdown', stopBubble);
    };
  }, [quadraPopupNode]);

  // Sincroniza abertura e posição do popup de Quadra
  useEffect(() => {
    const map = mapRef.current;
    const popup = quadraPopupRef.current;
    if (!map || !popup) return;

    if (activePopupQuadra) {
      popup.setLngLat([activePopupQuadra.lng, activePopupQuadra.lat]);
      if (!popup.isOpen()) {
        popup.addTo(map);
      }
    } else {
      if (popup.isOpen()) {
        popup.remove();
      }
    }
  }, [activePopupQuadra]);

  // Sincronização em alta performance dos marcadores de Quadras no MapLibre
  const syncQuadraMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const st = stateRef.current;
    const existingMap = quadraMarkersRef.current;

    if (!st.showQuadras) {
      for (const [, entry] of existingMap) {
        entry.marker.remove();
      }
      existingMap.clear();
      return;
    }

    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

    // Em zoom mais afastado (visão geral da cidade/rota), exibir apenas quadras prioritárias
    // (com entregas ativas, buscada ou em edição). As 1.170 quadras detalhadas aparecem
    // ao dar zoom na rua/bairro (zoom >= 14.5), ou quando o modo Ajustar estiver ativo.
    const isZoomedOut = zoom < (isMobile ? 14.8 : 14.2) && !st.adjustMode;

    // Margem reduzida (5% no mobile / 8% no desktop) para não instanciar centenas de nós fora da tela
    const padFactor = isMobile ? 0.05 : 0.08;
    const padLng = (bounds.getEast() - bounds.getWest()) * padFactor;
    const padLat = (bounds.getNorth() - bounds.getSouth()) * padFactor;
    const minLng = bounds.getWest() - padLng;
    const maxLng = bounds.getEast() + padLng;
    const minLat = bounds.getSouth() - padLat;
    const maxLat = bounds.getNorth() + padLat;

    const centerLng = (bounds.getWest() + bounds.getEast()) / 2;
    const centerLat = (bounds.getSouth() + bounds.getNorth()) / 2;

    const desiredKeys = new Set();
    const candidateItems = [];

    for (let i = 0; i < st.cleanQuadras.length; i++) {
      const q = st.cleanQuadras[i];
      const hasDelivery =
        st.deliveryQuadrasMap.has(q._numInt) ||
        st.deliveryQuadrasMap.has(q.rawNumber) ||
        st.deliveryQuadrasMap.has(q._label);

      if (st.showOnlyActiveQuadras && !hasDelivery) continue;

      const isHighlighted = Boolean(st.searchedQuadra && q._label === st.searchedQuadra);
      const isPendingSave = Boolean(q.isPendingSave);

      // Com zoom afastado e sem estar em modo de ajuste, renderiza apenas quadras chave
      if (isZoomedOut && !hasDelivery && !isHighlighted && !isPendingSave) {
        continue;
      }

      const inBounds = q.lng >= minLng && q.lng <= maxLng && q.lat >= minLat && q.lat <= maxLat;

      if (inBounds || hasDelivery || isHighlighted || isPendingSave) {
        const distSq = (q.lng - centerLng) ** 2 + (q.lat - centerLat) ** 2;
        const priority = isHighlighted ? 0 : isPendingSave ? 1 : hasDelivery ? 2 : 3;

        candidateItems.push({
          q,
          hasDelivery,
          isHighlighted,
          isPendingSave,
          priority,
          distSq,
        });
      }
    }

    // Limite máximo de marcadores no DOM para garantir 60 FPS contínuos no celular
    const maxMarkers = isMobile ? (st.adjustMode ? 140 : 80) : (st.adjustMode ? 300 : 180);
    let itemsToRender = candidateItems;

    if (candidateItems.length > maxMarkers) {
      candidateItems.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.distSq - b.distSq;
      });
      itemsToRender = candidateItems.slice(0, maxMarkers);
    }

    for (let i = 0; i < itemsToRender.length; i++) {
      desiredKeys.add(itemsToRender[i].q._key);
    }

    // 1. Remove marcadores fora da área visível (exceto os que estão sendo arrastados)
    for (const [key, entry] of existingMap) {
      if (!desiredKeys.has(key) && !entry.isDragging) {
        entry.marker.remove();
        existingMap.delete(key);
      }
    }

    // 2. Adiciona ou atualiza os marcadores
    for (let i = 0; i < itemsToRender.length; i++) {
      const { q, hasDelivery, isHighlighted } = itemsToRender[i];
      const key = q._key;
      const isPendingSave = Boolean(q.isPendingSave);
      const isDraggable = Boolean(st.adjustMode || isPendingSave);
      const iconKey = `${q._label}-${hasDelivery ? 'd' : ''}-${isHighlighted ? 'h' : ''}-${isDraggable ? 'g' : ''}-${isPendingSave ? 'p' : ''}`;

      const existing = existingMap.get(key);
      if (existing) {
        existing.quadra = q;
        if (!existing.isDragging) {
          const currentLngLat = existing.marker.getLngLat();
          if (
            Math.abs(currentLngLat.lat - q.lat) > 0.000001 ||
            Math.abs(currentLngLat.lng - q.lng) > 0.000001
          ) {
            existing.marker.setLngLat([q.lng, q.lat]);
          }
        }

        if (existing.iconKey !== iconKey) {
          existing.el.innerHTML = getCachedQuadraHtml(
            q,
            hasDelivery,
            isHighlighted,
            isDraggable,
            isPendingSave
          );
          existing.iconKey = iconKey;
        }

        if (existing.isDraggable !== isDraggable) {
          existing.marker.setDraggable(isDraggable);
          existing.isDraggable = isDraggable;
        }
      } else {
        const el = document.createElement('div');
        el.className = 'quadra-div-marker';
        el.innerHTML = getCachedQuadraHtml(q, hasDelivery, isHighlighted, isDraggable, isPendingSave);

        const marker = new maplibregl.Marker({
          element: el,
          draggable: isDraggable,
          anchor: 'center',
        }).setLngLat([q.lng, q.lat]);

        const entry = {
          marker,
          el,
          iconKey,
          isDraggable,
          isDragging: false,
          quadra: q,
        };

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          lastMarkerClickTimeRef.current = Date.now();
          const current = stateRef.current;
          if (current.isAddingQuadra) {
            handlePickMapSpot({ lat: q.lat, lng: q.lng });
            return;
          }
          if (!current.adjustMode) {
            setConfirmDeleteKey(null);
            if (onSelect) {
              onSelect(null, { pan: false });
            }
            const targetQuadra = existingMap.get(key)?.quadra || q;
            setActivePopupQuadra(targetQuadra);
          }
        });

        marker.on('dragstart', () => {
          entry.isDragging = true;
          el.classList.add('is-dragging-red');
          setDraggingQuadra(q);
          if (quadraPopupRef.current?.isOpen()) {
            quadraPopupRef.current.remove();
          }
        });

        marker.on('dragend', () => {
          entry.isDragging = false;
          const pos = marker.getLngLat();
          const newLat = Number(pos.lat.toFixed(6));
          const newLng = Number(pos.lng.toFixed(6));
          setDraggingQuadra(null);

          const updated = {
            ...entry.quadra,
            lat: newLat,
            lng: newLng,
            isPendingSave: true,
          };
          entry.quadra = updated;
          handleStageQuadraEdit(updated);
        });

        marker.addTo(map);
        existingMap.set(key, entry);
      }
    }
  }, [handlePickMapSpot, handleStageQuadraEdit, onSelect]);

  // Sincronização dos marcadores de Entregas da Rota no MapLibre
  const syncDeliveryMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const st = stateRef.current;
    const existingMap = deliveryMarkersRef.current;
    const desiredKeys = new Set();

    for (let index = 0; index < st.displayGroups.length; index++) {
      const group = st.displayGroups[index];
      if (!group.coordinates || isNaN(group.coordinates.lat) || isNaN(group.coordinates.lng)) continue;

      const key = group.groupId || `stop-${group.stopNumber || index + 1}`;
      desiredKeys.add(key);

      const address = group.primary;
      const stopNumber = group.stopNumber || index + 1;
      const packageCount = group.packageCount || group.items.length;
      const rowIds = group.rowIds || [address.originalRow];
      const isDelivered = Boolean(group.isDelivered);
      const isSelected = group.items.some((item) => item.originalRow === st.selectedId);
      const isFirst = index === 0;
      const isLast = index === st.displayGroups.length - 1 && st.displayGroups.length > 1;
      const hasQuadraLote = group.items.some((item) => Boolean(item.quadra || item.lote));
      const isManuallyAdjusted = Boolean(group.isManuallyAdjusted);
      const deliveredCount = group.deliveredCount || 0;

      const iconHtml = createCustomPinHtml({
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

      // Pino entregue é travado contra movimentação (não pode mais ser arrastado)
      const isDraggable = !st.isPickingMapSpot && !isDelivered;

      const existing = existingMap.get(key);
      if (existing) {
        existing.group = group;
        const currentPos = existing.marker.getLngLat();
        if (
          Math.abs(currentPos.lat - group.coordinates.lat) > 0.000001 ||
          Math.abs(currentPos.lng - group.coordinates.lng) > 0.000001
        ) {
          existing.marker.setLngLat([group.coordinates.lng, group.coordinates.lat]);
        }

        if (existing.iconHtml !== iconHtml) {
          existing.el.innerHTML = iconHtml;
          existing.iconHtml = iconHtml;
        }

        if (existing.isDraggable !== isDraggable) {
          existing.marker.setDraggable(isDraggable);
          existing.isDraggable = isDraggable;
        }
      } else {
        const el = document.createElement('div');
        el.className = 'delivery-marker-wrapper';
        el.innerHTML = iconHtml;

        const marker = new maplibregl.Marker({
          element: el,
          draggable: isDraggable,
          anchor: 'bottom',
        }).setLngLat([group.coordinates.lng, group.coordinates.lat]);

        const entry = {
          marker,
          el,
          iconHtml,
          isDraggable,
          group,
        };

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          lastMarkerClickTimeRef.current = Date.now();
          const current = stateRef.current;
          if (current.isPickingMapSpot) {
            handlePickMapSpot({ lat: group.coordinates.lat, lng: group.coordinates.lng });
            return;
          }
          if (quadraPopupRef.current?.isOpen()) {
            quadraPopupRef.current.remove();
          }
          setActivePopupQuadra(null);
          const targetGroup = existingMap.get(key)?.group || group;
          const targetAddress = targetGroup.primary;
          if (onSelect) {
            onSelect(targetAddress.originalRow, { pan: false });
          }
        });

        marker.on('dragend', () => {
          const newPos = marker.getLngLat();
          const newLat = Number(newPos.lat.toFixed(6));
          const newLng = Number(newPos.lng.toFixed(6));
          if (onUpdateAddress) {
            onUpdateAddress(rowIds, {
              coordinates: { lat: newLat, lng: newLng },
              isManuallyAdjusted: true,
            });
          }
        });

        marker.addTo(map);
        existingMap.set(key, entry);
      }
    }

    // Remove marcadores que não estão mais na rota
    for (const [key, entry] of existingMap) {
      if (!desiredKeys.has(key)) {
        entry.marker.remove();
        existingMap.delete(key);
      }
    }
  }, [onSelect, onUpdateAddress, handlePickMapSpot]);

  // Marcador de GPS do usuário no MapLibre
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!userLocation) {
      if (userLocMarkerRef.current) {
        userLocMarkerRef.current.remove();
        userLocMarkerRef.current = null;
      }
      return;
    }

    if (userLocMarkerRef.current) {
      userLocMarkerRef.current.setLngLat([userLocation.lng, userLocation.lat]);
    } else {
      const el = document.createElement('div');
      el.className = 'user-location-custom-icon';
      el.innerHTML = `
        <div class="user-gps-pulse-wrapper">
          <div class="user-gps-pulse-ring"></div>
          <div class="user-gps-dot">
            <div class="user-gps-inner"></div>
          </div>
        </div>
      `;

      const marker = new maplibregl.Marker({
        element: el,
        anchor: 'center',
      })
        .setLngLat([userLocation.lng, userLocation.lat])
        .addTo(map);

      userLocMarkerRef.current = marker;
    }
  }, [userLocation]);

  // Registra os hooks de movimento da câmera para recálculo de marcadores visíveis
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    let moveThrottleTimer = null;
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

    // No desktop atualiza suavemente; no mobile NÃO re-sincroniza durante o arrasto contínuo para manter 60 FPS nativo
    const handleCameraMove = () => {
      if (isMobile) return;
      if (moveThrottleTimer) return;
      moveThrottleTimer = setTimeout(() => {
        moveThrottleTimer = null;
        syncQuadraMarkers();
      }, 200);
    };

    if (!isMobile) {
      map.on('move', handleCameraMove);
    }
    map.on('moveend', syncQuadraMarkers);
    map.on('zoomend', syncQuadraMarkers);
    map.on('resize', syncQuadraMarkers);

    syncQuadraMarkers();
    syncDeliveryMarkers();

    return () => {
      if (!isMobile) {
        map.off('move', handleCameraMove);
      }
      map.off('moveend', syncQuadraMarkers);
      map.off('zoomend', syncQuadraMarkers);
      map.off('resize', syncQuadraMarkers);
      if (moveThrottleTimer) {
        clearTimeout(moveThrottleTimer);
        moveThrottleTimer = null;
      }
    };
  }, [mapLoaded, syncQuadraMarkers, syncDeliveryMarkers]);

  // Re-sincroniza marcadores de quadras quando o modo, filtro ou busca mudar
  useEffect(() => {
    if (mapLoaded) {
      syncQuadraMarkers();
    }
  }, [
    mapLoaded,
    showQuadras,
    showOnlyActiveQuadras,
    adjustMode,
    searchedQuadra,
    cleanQuadras,
    syncQuadraMarkers,
  ]);

  // Re-sincroniza marcadores de entrega sempre que os grupos mudarem
  useEffect(() => {
    if (mapLoaded) {
      syncDeliveryMarkers();
    }
  }, [mapLoaded, syncDeliveryMarkers]);

  // Controles de câmera
  const handleZoomIn = () => {
    if (mapRef.current) mapRef.current.zoomIn();
  };

  const handleZoomOut = () => {
    if (mapRef.current) mapRef.current.zoomOut();
  };

  const handleFitAll = () => {
    if (!mapRef.current) return;
    if (validAddresses.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      validAddresses.forEach((a) => {
        bounds.extend([a.coordinates.lng, a.coordinates.lat]);
      });
      mapRef.current.fitBounds(bounds, { padding: 50, duration: 800, maxZoom: 16.5 });
    } else {
      mapRef.current.flyTo({
        center: [-42.9912, -22.9515],
        zoom: 15,
        duration: 800,
      });
    }
  };

  // Busca de quadra
  const handleClearSearch = () => {
    setQuadraSearchInput('');
    setSearchedQuadra(null);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      const norm = normalizeQuadraSearchTerm(quadraSearchInput);
      setSearchedQuadra(norm || null);
      if (norm && mapRef.current) {
        const matches = cleanQuadras.filter((q) => q._label === norm);
        if (matches.length > 0) {
          mapRef.current.flyTo({
            center: [matches[0].lng, matches[0].lat],
            zoom: 16.5,
            duration: 800,
          });
        }
      }
    } else if (e.key === 'Escape') {
      handleClearSearch();
    }
  };

  // Adição de nova quadra
  const handleConfirmAddQuadra = (e) => {
    e.preventDefault();
    if (!newQuadraNumber.trim() || !pendingAddPoint || !onAddQuadra) return;
    const formatted = formatQuadraNumber(newQuadraNumber);
    onAddQuadra({
      number: formatted,
      rawNumber: formatted,
      lat: Number(pendingAddPoint.lat.toFixed(6)),
      lng: Number(pendingAddPoint.lng.toFixed(6)),
    });
    setPendingAddPoint(null);
    setNewQuadraNumber('');
    setIsAddingQuadra(false);
  };

  // Estatísticas de busca na tela
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
    if (currentBounds) {
      onScreen = matches.filter((q) => currentBounds.contains([q.lng, q.lat])).length;
    }
    return {
      label: searchedQuadra,
      onScreen,
      total: matches.length,
    };
  }, [searchedQuadra, cleanQuadrasBase, viewportSeq, currentBounds]);

  const deliveriesHere = useMemo(() => {
    if (!activePopupQuadra) return [];
    const fromInt = deliveryQuadrasMap.get(activePopupQuadra._numInt);
    if (fromInt && fromInt.length > 0) return fromInt;
    const fromRaw = deliveryQuadrasMap.get(activePopupQuadra.rawNumber);
    if (fromRaw && fromRaw.length > 0) return fromRaw;
    const fromNum = deliveryQuadrasMap.get(String(activePopupQuadra.number));
    if (fromNum && fromNum.length > 0) return fromNum;
    const fromLabel = deliveryQuadrasMap.get(activePopupQuadra._label);
    if (fromLabel && fromLabel.length > 0) return fromLabel;
    return [];
  }, [activePopupQuadra, deliveryQuadrasMap]);

  return (
    <div className="map-container">
      {/* Barra Superior Mobile: Busca de Quadras Estilizada + Menu Hambúrguer de Camadas */}
      <div className="mobile-map-top-bar">
        <div className="mobile-search-pill">
          <Search size={16} className="mobile-search-icon" />
          <input
            type="text"
            placeholder="Buscar quadra (ex: 52)..."
            value={quadraSearchInput}
            onChange={(e) => setQuadraSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="mobile-search-input"
          />
          {quadraSearchInput && (
            <button
              type="button"
              className="mobile-clear-search-btn"
              onClick={handleClearSearch}
              title="Limpar busca"
            >
              <X size={15} />
            </button>
          )}
          {quadraSearchStats && (
            <span className="mobile-search-count-badge" title="Na tela / Total no loteamento">
              {quadraSearchStats.onScreen}/{quadraSearchStats.total}
            </span>
          )}
        </div>

        <button
          type="button"
          className={`mobile-layers-hamburger-btn ${mobileMenuOpen ? 'active' : ''}`}
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          title="Selecionar estilo do mapa"
          aria-label="Menu de estilos de mapa"
        >
          <Menu size={20} />
        </button>

        {mobileMenuOpen && (
          <>
            <div
              className="mobile-layers-backdrop"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="mobile-layers-menu">
              <div className="mobile-layers-menu-header">
                <span>Estilo do Mapa</span>
                <button
                  type="button"
                  className="mobile-layers-close-btn"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="mobile-layers-options">
                <button
                  type="button"
                  className={`mobile-layer-option-btn ${tileStyle === 'osm' ? 'active' : ''}`}
                  onClick={() => {
                    setTileStyle('osm');
                    setMobileMenuOpen(false);
                  }}
                >
                  <span className="layer-emoji">🗺️</span>
                  <div className="layer-info">
                    <strong>Rua</strong>
                    <small>OpenStreetMap padrão</small>
                  </div>
                  {tileStyle === 'osm' && <Check size={16} className="layer-check-icon" />}
                </button>

                <button
                  type="button"
                  className={`mobile-layer-option-btn ${tileStyle === 'voyager' ? 'active' : ''}`}
                  onClick={() => {
                    setTileStyle('voyager');
                    setMobileMenuOpen(false);
                  }}
                >
                  <span className="layer-emoji">☀️</span>
                  <div className="layer-info">
                    <strong>Claro</strong>
                    <small>Positron clean</small>
                  </div>
                  {tileStyle === 'voyager' && <Check size={16} className="layer-check-icon" />}
                </button>

                <button
                  type="button"
                  className={`mobile-layer-option-btn ${tileStyle === 'satellite' ? 'active' : ''}`}
                  onClick={() => {
                    setTileStyle('satellite');
                    setMobileMenuOpen(false);
                  }}
                >
                  <span className="layer-emoji">🛰️</span>
                  <div className="layer-info">
                    <strong>Satélite</strong>
                    <small>Visão aérea real</small>
                  </div>
                  {tileStyle === 'satellite' && <Check size={16} className="layer-check-icon" />}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Barra de Controles Flutuantes do Mapa (Desktop: topo | Mobile: lateral direita centralizada) */}
      <div className="map-floating-controls">
        <button
          type="button"
          className="map-control-btn"
          onClick={handleFitAll}
          title="Enquadrar todas as paradas ou mapa geral"
        >
          <Focus size={15} />
          <span>Enquadrar</span>
        </button>

        <button
          type="button"
          className={`map-control-btn location-btn ${userLocation ? 'active' : ''}`}
          onClick={handleLocationButtonClick}
          title={userLocation ? 'Centralizar no seu local (GPS ativo)' : 'Ativar localização em tempo real'}
        >
          <Navigation size={15} />
          <span>{userLocation ? 'Meu Local' : 'Ativar GPS'}</span>
        </button>

        <button
          type="button"
          className={`map-control-btn quadra-toggle-btn ${showQuadras ? 'active' : ''}`}
          onClick={() => setShowQuadras(!showQuadras)}
          title="Mostrar ou ocultar números das quadras de Itaipuaçu"
        >
          <Layers size={15} />
          <span>{showQuadras ? 'Quadras: ON' : 'Quadras: OFF'}</span>
        </button>

        {showQuadras && (
          <button
            type="button"
            className={`map-control-btn only-active-quadras-btn ${showOnlyActiveQuadras ? 'active' : ''}`}
            onClick={() => setShowOnlyActiveQuadras(!showOnlyActiveQuadras)}
            title={
              showOnlyActiveQuadras
                ? 'Mostrando apenas quadras com entregas ativas'
                : 'Mostrar apenas quadras que possuem entregas'
            }
          >
            <CheckCheck size={15} />
            <span>{showOnlyActiveQuadras ? `Só Ativas (${activeQuadrasCount})` : 'Só Ativas'}</span>
          </button>
        )}

        {showQuadras && (
          <button
            type="button"
            className={`map-control-btn adjust-toggle-btn ${adjustMode ? 'active' : ''}`}
            onClick={() => {
              setAdjustMode(!adjustMode);
              setIsAddingQuadra(false);
              setPendingAddPoint(null);
            }}
            title={adjustMode ? 'Arrasto ativado: mova qualquer quadra' : 'Ativar modo de arrastar quadras'}
          >
            <Move size={15} />
            <span>{adjustMode ? 'Arrastar Ativo' : 'Ajustar'}</span>
          </button>
        )}

        {showQuadras && (
          <button
            type="button"
            className={`map-control-btn add-quadra-btn ${isAddingQuadra ? 'active' : ''}`}
            onClick={() => {
              setIsAddingQuadra(!isAddingQuadra);
              setPendingAddPoint(null);
            }}
            title={isAddingQuadra ? 'Cancelar inserção' : 'Adicionar um novo número de quadra no mapa'}
          >
            {isAddingQuadra ? <X size={15} /> : <Plus size={15} />}
            <span>{isAddingQuadra ? 'Cancelar' : 'Add Número'}</span>
          </button>
        )}

        {showQuadras && (
          <div className="quadra-search-box">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              placeholder="Buscar Quadra (ex: 40)..."
              value={quadraSearchInput}
              onChange={(e) => setQuadraSearchInput(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="quadra-search-input"
            />
            {quadraSearchInput && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={handleClearSearch}
                title="Limpar busca"
              >
                ✕
              </button>
            )}
            {quadraSearchStats && (
              <span className="quadra-search-count" title="Na tela / Total no loteamento">
                {quadraSearchStats.onScreen}/{quadraSearchStats.total}
              </span>
            )}
          </div>
        )}

        <div className="tile-switcher">
          <button
            type="button"
            className={`tile-btn ${tileStyle === 'osm' ? 'active' : ''}`}
            onClick={() => setTileStyle('osm')}
          >
            Rua
          </button>
          <button
            type="button"
            className={`tile-btn ${tileStyle === 'voyager' ? 'active' : ''}`}
            onClick={() => setTileStyle('voyager')}
          >
            Claro
          </button>
          <button
            type="button"
            className={`tile-btn ${tileStyle === 'satellite' ? 'active' : ''}`}
            onClick={() => setTileStyle('satellite')}
          >
            Satélite
          </button>
        </div>

        <div className="map-zoom-buttons">
          <button type="button" className="zoom-btn" onClick={handleZoomIn} title="Aproximar zoom">
            +
          </button>
          <button type="button" className="zoom-btn" onClick={handleZoomOut} title="Afastar zoom">
            −
          </button>
        </div>
      </div>

      {/* Container Principal WebGL do MapLibre */}
      <div
        ref={mapContainerRef}
        className={`maplibre-map ${isPickingMapSpot ? 'is-adding-quadra' : ''}`}
      />

      {/* Conteúdo do Popup da Quadra via React Portal */}
      {activePopupQuadra &&
        createPortal(
          <div className="popup-card quadra-popup-card">
            <div className="popup-header">
              <span className="popup-tag quadra">
                Quadra {formatQuadraNumber(activePopupQuadra.rawNumber || activePopupQuadra.number)}
              </span>
              <span
                className={`popup-badge drag-badge ${
                  activePopupQuadra.isPendingSave ? 'pending-save-badge' : ''
                }`}
              >
                {activePopupQuadra.isPendingSave ? '🔴 Aguardando Salvar' : '📍 ITAIPUAÇU'}
              </span>
              {deliveriesHere.length > 0 && (
                <span className="popup-badge delivery-tag">
                  {deliveriesHere.length} {deliveriesHere.length === 1 ? 'ENTREGA' : 'ENTREGAS'}
                </span>
              )}
            </div>
            <h4 className="popup-title">
              Quadra #{formatQuadraNumber(activePopupQuadra.rawNumber || activePopupQuadra.number)} (Itaipuaçu)
            </h4>

            <div className="popup-drag-hint">
              {activePopupQuadra.isPendingSave ? (
                <>
                  🔴 <strong>Posição alterada:</strong> Clique em <strong>Salvar no Banco</strong> na barra
                  inferior para confirmar.
                </>
              ) : (
                <>
                  📍 <strong>Ajustar posição:</strong> Para mover esta quadra no mapa, clique no botão{' '}
                  <strong>Ajustar</strong> no topo da tela.
                </>
              )}
            </div>

            <p className="popup-meta">Posição do loteamento:</p>
            <p className="popup-meta font-mono">
              {activePopupQuadra.lat.toFixed(6)}, {activePopupQuadra.lng.toFixed(6)}
            </p>

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
                      handleLocationButtonClick();
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
                    handleNavigateTarget(activePopupQuadra, 'google');
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
                    handleNavigateTarget(activePopupQuadra, 'waze');
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

            {deliveriesHere.length > 0 && (
              <div className="popup-quadra-deliveries">
                <div className="popup-quadra-deliveries-header">
                  <span className="popup-section-subtitle">
                    📦 Paradas nesta quadra ({deliveriesHere.length})
                  </span>
                </div>
                <div className="popup-deliveries-list">
                  {deliveriesHere.map((d) => {
                    const pin = pinInfoByRow?.get(d.originalRow);
                    const stopNumber = pin?.stopNumber;
                    const isItemDelivered = Boolean(pin?.isDelivered || d.delivered);
                    return (
                      <div
                        key={`delivery-${d.originalRow}`}
                        className={`popup-delivery-item ${isItemDelivered ? 'is-delivered' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (typeof window !== 'undefined' && window.innerWidth <= 768) {
                            setActivePopupQuadra(null);
                          }
                          if (onSelect) {
                            onSelect(d.originalRow, { pan: false });
                          }
                        }}
                        title={`Clique para destacar parada #${stopNumber || d.originalRow}`}
                      >
                        <div className="popup-delivery-item-left">
                          <span className="popup-delivery-pin-badge" title="Número da parada">
                            📍 {stopNumber ? `Pino #${stopNumber}` : `#${d.originalRow}`}
                          </span>
                          {d.lote && (
                            <span className="popup-delivery-lote-badge">
                              Lote {d.lote}
                            </span>
                          )}
                          {isItemDelivered && (
                            <span className="popup-delivery-status-badge">
                              ✓ Entregue
                            </span>
                          )}
                        </div>
                        <div className="popup-delivery-item-right">
                          <span className="popup-delivery-recipient" title={d.recipient}>
                            {d.recipient || `Destinatário #${d.originalRow}`}
                          </span>
                          <span className="popup-delivery-sub-idx">
                            Linha #{d.originalRow}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {deliveriesHere.length > 0 && (
              <div className="popup-gather-section" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="btn-gather-pins"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleGatherPins(deliveriesHere, activePopupQuadra, pinInfoByRow);
                  }}
                  title="Mover todos os pinos desta quadra para perto daqui"
                >
                  {(() => {
                    const uniquePins = new Set(
                      deliveriesHere.map((d) => pinInfoByRow?.get(d.originalRow)?.stopNumber ?? d.originalRow)
                    );
                    return `📌 Juntar Pinos (${uniquePins.size})`;
                  })()}
                </button>
              </div>
            )}

            {onDeleteQuadra && (
              <div className="popup-delete-section" onClick={(e) => e.stopPropagation()}>
                {confirmDeleteKey === activePopupQuadra._key ? (
                  <div className="delete-confirm-box">
                    <span className="delete-confirm-text">
                      Excluir Quadra #{formatQuadraNumber(activePopupQuadra.rawNumber || activePopupQuadra.number)}?
                    </span>
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
                          handleDeleteQuadraWithCleanup(activePopupQuadra);
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
                    title="Excluir esta quadra do mapa e do banco SQLite"
                  >
                    🗑️ Excluir Quadra
                  </button>
                )}
              </div>
            )}
          </div>,
          quadraPopupNode
        )}

      {/* Modal de Edição de Entrega */}
      {editingStop && (
        <EditAddressModal
          stop={editingStop.stop}
          stopNumber={editingStop.stopNumber}
          quadras={cleanQuadras}
          onSave={onUpdateAddress}
          onRestoreOriginal={onUpdateAddress}
          onClose={() => setEditingStop(null)}
        />
      )}

      {/* Modal de Inclusão de Nova Quadra */}
      {pendingAddPoint && (
        <div className="add-quadra-modal-overlay" onClick={() => setPendingAddPoint(null)}>
          <div className="add-quadra-modal" onClick={(e) => e.stopPropagation()}>
            <div className="add-quadra-modal-header">
              <span className="add-modal-tag">➕ Nova Quadra</span>
              <button
                type="button"
                className="add-modal-close-btn"
                onClick={() => setPendingAddPoint(null)}
                title="Fechar"
              >
                ✕
              </button>
            </div>

            <h4 className="add-modal-title">Qual é o número desta quadra?</h4>
            <p className="add-modal-coords font-mono">
              Coordenadas: {pendingAddPoint.lat.toFixed(6)}, {pendingAddPoint.lng.toFixed(6)}
            </p>

            <form onSubmit={handleConfirmAddQuadra} className="add-quadra-form">
              <div className="add-modal-field">
                <label htmlFor="new-quadra-num">Número da Quadra:</label>
                <input
                  id="new-quadra-num"
                  type="text"
                  placeholder="Ex: 40 ou 05..."
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

      {/* Barra Inferior Flutuante ao Arrastar / Ajustar Quadras para Salvar no Banco SQLite */}
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
                  ? 'Posição alterada — salve no banco SQLite para confirmar definitivo'
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
              title="Salvar oficialmente e definitivo no banco de dados SQLite"
            >
              {isSavingEdits
                ? 'Gravando no Banco...'
                : draggingQuadra
                  ? '💾 Salvar no Banco'
                  : '💾 Salvar no Banco'}
            </button>
          </div>
        </div>
      )}

      {/* Mini Card Flutuante / Bottom Sheet de Endereço Selecionado */}
      {selectedAddress && !draggingQuadra && pendingEditsList.length === 0 && !repositioningStop && (
        <div className={`map-selected-card ${isBottomSheetExpanded ? 'is-expanded' : ''}`}>
          {/* Barra de Puxar Estilo Bottom Sheet (Arrastável / Clicável) */}
          <div
            className="bottom-sheet-handle-bar"
            onClick={() => setIsBottomSheetExpanded((prev) => !prev)}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            role="button"
            tabIndex={0}
            title={isBottomSheetExpanded ? 'Recolher detalhes' : 'Puxar para cima (50% da tela)'}
          >
            <div className="bottom-sheet-handle" />
          </div>

          {/* Linha de info + botões de topo */}
          <div className="card-top-row">
            <div className="card-info">
              <div className="card-meta">
                <span className="card-badge">
                  Parada #{selectedStopNumber || selectedAddress.originalRow}
                </span>
                {(selectedGroup?.isDelivered || selectedAddress.delivered) && (
                  <span className="card-tag delivered">
                    <CheckCircle2 size={11} /> Entregue
                  </span>
                )}
                {selectedGroup && selectedGroup.packageCount > 1 && (
                  <span className="card-tag pkg-count">
                    <Package size={11} /> {selectedGroup.packageCount} pkgs
                  </span>
                )}
                {selectedAddress.quadra && (
                  <span className="card-tag quadra">Q{selectedAddress.quadra}</span>
                )}
                {selectedAddress.lote && (
                  <span className="card-tag lote">L{selectedAddress.lote}</span>
                )}
                {selectedAddress.isManuallyAdjusted && (
                  <span className="card-tag adjusted" title="Posição ajustada manualmente">📌</span>
                )}
              </div>
              {selectedAddress.recipient && (
                <strong className="card-name">{selectedAddress.recipient}</strong>
              )}
              <p className="card-street">
                {selectedAddress.street}{selectedAddress.number ? `, Nº ${selectedAddress.number}` : ''}
                {selectedAddress.neighborhood ? ` · ${selectedAddress.neighborhood}` : ''}
              </p>
            </div>

            <div className="card-top-actions">
              <button
                type="button"
                className="card-btn-expand"
                onClick={() => setIsBottomSheetExpanded((prev) => !prev)}
                title={isBottomSheetExpanded ? 'Recolher detalhes' : 'Ver mais informações (puxar para cima)'}
              >
                {isBottomSheetExpanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </button>
              <button
                type="button"
                className="card-btn-close"
                onClick={() => {
                  setIsBottomSheetExpanded(false);
                  if (onSelect) onSelect(null, { pan: false });
                }}
                title="Fechar"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Linha de ações principais */}
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
                    : 'Confirmar entrega deste pino'
                }
              >
                {selectedGroup?.isDelivered ? (
                  <>
                    <RotateCcw size={14} />
                    <span>Entregue</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} />
                    <span>Confirmar</span>
                  </>
                )}
              </button>
            )}
            {onUpdateAddress && (
              <>
                <button
                  type="button"
                  className="card-btn-action edit-pin"
                  onClick={() =>
                    setEditingStop({
                      stop: selectedAddress,
                      stopNumber: selectedStopNumber || selectedAddress.originalRow,
                      group: selectedGroup,
                    })
                  }
                  title="Editar informações e coordenadas deste pino"
                >
                  <Edit3 size={14} />
                  <span>Editar</span>
                </button>
                {!selectedGroup?.isDelivered ? (
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
                    title="Mover pino para outro ponto no mapa"
                  >
                    <Move size={14} />
                    <span>Mover</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="card-btn-action move-pin disabled"
                    disabled
                    title="Pino já entregue (bloqueado contra movimentação)"
                  >
                    <Move size={14} />
                    <span>Entregue</span>
                  </button>
                )}
              </>
            )}
            {selectedAddress.coordinates && (
              <>
                <button
                  type="button"
                  className="card-btn-action gmaps"
                  onClick={() => {
                    handleNavigateTarget(
                      {
                        lat: selectedAddress.coordinates.lat,
                        lng: selectedAddress.coordinates.lng,
                        label:
                          selectedAddress.recipient ||
                          `Parada #${selectedStopNumber || selectedAddress.originalRow}`,
                      },
                      'google'
                    );
                  }}
                  title="Navegar no Google Maps"
                >
                  <MapIcon size={14} />
                  <span>Maps</span>
                </button>
                <button
                  type="button"
                  className="card-btn-action waze"
                  onClick={() => {
                    handleNavigateTarget(
                      {
                        lat: selectedAddress.coordinates.lat,
                        lng: selectedAddress.coordinates.lng,
                        label:
                          selectedAddress.recipient ||
                          `Parada #${selectedStopNumber || selectedAddress.originalRow}`,
                      },
                      'waze'
                    );
                  }}
                  title="Navegar no Waze"
                >
                  <span>🚗 Waze</span>
                </button>
              </>
            )}
            {selectedAddress.phone && (
              <a
                href={`tel:${selectedAddress.phone.replace(/\D/g, '')}`}
                className="card-btn-action phone"
                title="Ligar para o cliente"
              >
                <Phone size={14} />
                <span>Ligar</span>
              </a>
            )}
          </div>

          {/* Seção Expandida (Até ~50% da tela) com Detalhes Completos */}
          {isBottomSheetExpanded && (
            <div className="card-expanded-content">
              <div className="expanded-divider" />

              {/* Informações completas de Endereço */}
              <div className="expanded-section">
                <h5 className="expanded-section-title">
                  <MapPin size={14} /> Endereço Completo
                </h5>
                <div className="expanded-address-details">
                  <p className="detail-row">
                    <strong>Rua:</strong> {selectedAddress.street || 'Não informada'}
                    {selectedAddress.number && ` · Nº ${selectedAddress.number}`}
                  </p>
                  {(selectedAddress.quadra || selectedAddress.lote) && (
                    <p className="detail-row">
                      <strong>Loteamento:</strong>
                      {selectedAddress.quadra && ` Quadra ${selectedAddress.quadra}`}
                      {selectedAddress.lote && ` · Lote ${selectedAddress.lote}`}
                    </p>
                  )}
                  {selectedAddress.complement && (
                    <p className="detail-row">
                      <strong>Complemento:</strong> {selectedAddress.complement}
                    </p>
                  )}
                  {selectedAddress.neighborhood && (
                    <p className="detail-row">
                      <strong>Bairro:</strong> {selectedAddress.neighborhood}
                    </p>
                  )}
                  {selectedAddress.zipCode && (
                    <p className="detail-row">
                      <strong>CEP:</strong> {selectedAddress.zipCode}
                    </p>
                  )}
                  {selectedAddress.coordinates && (
                    <p className="detail-row font-mono coords">
                      <strong>GPS:</strong> {selectedAddress.coordinates.lat.toFixed(6)}, {selectedAddress.coordinates.lng.toFixed(6)}
                    </p>
                  )}
                </div>
              </div>

              {/* Lista de múltiplos pacotes nesta parada */}
              {selectedGroup && selectedGroup.addresses && selectedGroup.addresses.length > 1 && (
                <div className="expanded-section">
                  <h5 className="expanded-section-title">
                    <Package size={14} /> Pacotes Agrupados nesta Parada ({selectedGroup.addresses.length})
                  </h5>
                  <div className="expanded-packages-list">
                    {selectedGroup.addresses.map((pkgAddr, idx) => (
                      <div
                        key={pkgAddr.originalRow || idx}
                        className={`expanded-pkg-item ${pkgAddr.delivered ? 'is-delivered' : ''}`}
                      >
                        <div className="pkg-item-info">
                          <span className="pkg-idx">#{idx + 1}</span>
                          <span className="pkg-recipient">{pkgAddr.recipient || `Pacote #${pkgAddr.originalRow}`}</span>
                          {pkgAddr.orderId && <span className="pkg-order">{pkgAddr.orderId}</span>}
                        </div>
                        <button
                          type="button"
                          className={`pkg-toggle-btn ${pkgAddr.delivered ? 'delivered' : ''}`}
                          onClick={() => onConfirmDelivery && onConfirmDelivery([pkgAddr.originalRow], !pkgAddr.delivered)}
                        >
                          {pkgAddr.delivered ? '✓ Entregue' : 'Confirmar'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Contato com o Destinatário */}
              {selectedAddress.phone && (
                <div className="expanded-section">
                  <h5 className="expanded-section-title">
                    <Phone size={14} /> Contato do Destinatário
                  </h5>
                  <div className="expanded-contact-buttons">
                    <a
                      href={`tel:${selectedAddress.phone.replace(/\D/g, '')}`}
                      className="contact-btn call"
                    >
                      <Phone size={14} /> Ligar ({selectedAddress.phone})
                    </a>
                    <a
                      href={`https://wa.me/55${selectedAddress.phone.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="contact-btn whatsapp"
                    >
                      <MessageCircle size={14} /> WhatsApp
                    </a>
                  </div>
                </div>
              )}

              {/* Botão para recolher a folha de volta ao estado compacto */}
              <div className="expanded-footer">
                <button
                  type="button"
                  className="btn-collapse-sheet"
                  onClick={() => setIsBottomSheetExpanded(false)}
                >
                  <ChevronDown size={15} /> Recolher Detalhes
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Barra de Instrução Flutuante para Mover Pino */}
      {repositioningStop && (
        <div className="reposition-floating-bar">
          <div className="reposition-info">
            <span className="reposition-badge">🎯 Mover Pino #{repositioningStop.stopNumber}</span>
            <span className="reposition-text">
              Clique em qualquer local no mapa ou em uma quadra para reposicionar esta parada.
            </span>
          </div>
          <button
            type="button"
            className="btn-cancel-reposition"
            onClick={() => setRepositioningStop(null)}
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Modal de Solicitação de Localização (GPS) */}
      {locationPromptOpen && (
        <div className="location-modal-overlay" onClick={() => setLocationPromptOpen(false)}>
          <div className="location-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="location-modal-icon-wrap">
              <div className="location-modal-icon-circle">
                <span className="location-modal-icon">📍</span>
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
