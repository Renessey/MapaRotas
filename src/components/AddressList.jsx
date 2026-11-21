import { useState, useMemo, useEffect, useRef } from 'react';
import { Trash2, Search, X, FileSpreadsheet } from 'lucide-react';
import './AddressList.css';

export default function AddressList({ 
  addresses, 
  totalPackages = 0,
  deliveredCount = 0,
  groupedStops = [],
  selectedId, 
  onSelect, 
  onRemove,
  onSelectQuadra,
  onConfirmDelivery,
  onOpenHistory,
  geocodingProgress,
  importedSpreadsheet = null,
  onRemoveSpreadsheet,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('original');
  const [copiedId, setCopiedId] = useState(null);
  const selectedItemRef = useRef(null);

  // Auto-scroll para o item selecionado quando mudar
  useEffect(() => {
    if (selectedId && selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [selectedId]);

  const filteredAddresses = useMemo(() => {
    let result = addresses;

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      const numericSearch = term.replace(/^#/, '');
      result = result.filter(addr =>
        String(addr.originalRow || '') === numericSearch ||
        `#${addr.originalRow}`.includes(term) ||
        (addr.street && addr.street.toLowerCase().includes(term)) ||
        (addr.recipient && addr.recipient.toLowerCase().includes(term)) ||
        (addr.neighborhood && addr.neighborhood.toLowerCase().includes(term)) ||
        (addr.city && addr.city.toLowerCase().includes(term)) ||
        (addr.orderId && addr.orderId.toLowerCase().includes(term)) ||
        (addr.zipCode && addr.zipCode.includes(term)) ||
        (addr.quadra && String(addr.quadra).toLowerCase().includes(term)) ||
        (addr.lote && String(addr.lote).toLowerCase().includes(term))
      );
    }

    if (filterStatus !== 'all') {
      result = result.filter(addr => {
        if (filterStatus === 'geocoded') return addr.geocoded;
        if (filterStatus === 'pending') return !addr.geocoded && !addr.error;
        if (filterStatus === 'error') return Boolean(addr.error);
        if (filterStatus === 'quadra-lote') return Boolean(addr.quadra || addr.lote);
        return true;
      });
    }

    if (sortBy === 'original') {
      result = [...result].sort((a, b) => a.originalRow - b.originalRow);
    } else if (sortBy === 'street') {
      result = [...result].sort((a, b) => (a.street || '').localeCompare(b.street || ''));
    } else if (sortBy === 'recipient') {
      result = [...result].sort((a, b) => (a.recipient || '').localeCompare(b.recipient || ''));
    } else if (sortBy === 'quadra') {
      result = [...result].sort((a, b) => {
        const qA = parseInt(a.quadra, 10) || 9999;
        const qB = parseInt(b.quadra, 10) || 9999;
        return qA - qB;
      });
    } else if (sortBy === 'status') {
      result = [...result].sort((a, b) => {
        if (a.geocoded && !b.geocoded) return -1;
        if (!a.geocoded && b.geocoded) return 1;
        if (a.error && !b.error) return 1;
        if (!a.error && b.error) return -1;
        return 0;
      });
    }

    return result;
  }, [addresses, searchTerm, filterStatus, sortBy]);

  const groupByRow = useMemo(() => {
    const map = new Map();
    for (const g of groupedStops) {
      for (const r of g.rowIds) {
        map.set(r, g);
      }
    }
    return map;
  }, [groupedStops]);

  const stats = useMemo(() => ({
    total: addresses.length,
    totalAll: totalPackages || addresses.length + deliveredCount,
    geocoded: addresses.filter(a => a.geocoded).length,
    uniquePins: groupedStops.filter(g => !g.isDelivered).length,
    pending: addresses.filter(a => !a.geocoded && !a.error).length,
    error: addresses.filter(a => Boolean(a.error)).length,
    quadraLote: addresses.filter(a => Boolean(a.quadra || a.lote)).length,
  }), [addresses, groupedStops, totalPackages, deliveredCount]);

  const handleCopyAddress = (e, addr) => {
    e.stopPropagation();
    const textToCopy = `${addr.recipient ? addr.recipient + ' - ' : ''}${addr.fullAddress}`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedId(addr.originalRow);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="address-list-container">
      {/* Cabeçalho da Lista e Estatísticas */}
      <div className="list-header-card">
        <div className="list-title-row">
          <div className="list-title-badge">
            <h3>Paradas da Rota</h3>
            <span className="count-pill">{stats.total}</span>
          </div>
          <div className="stats-badges-row">
            <span className="badge badge-success" title="Pacotes pendentes com coordenadas no mapa">
              ✓ {stats.geocoded} pendentes
            </span>
            {stats.uniquePins > 0 && stats.uniquePins < stats.geocoded && (
              <span className="badge badge-pins" title="Endereços ativos agrupados no mapa">
                📍 {stats.uniquePins} pinos
              </span>
            )}
            {deliveredCount > 0 && (
              <button
                type="button"
                className="badge badge-history-link"
                onClick={onOpenHistory}
                title="Abrir tabela de Histórico de Entregas"
              >
                ✅ {deliveredCount} entregues ↗
              </button>
            )}
            {stats.pending > 0 && (
              <span className="badge badge-warning" title="Aguardando geocodificação">
                ⏳ {stats.pending}
              </span>
            )}
            {stats.error > 0 && (
              <span className="badge badge-error" title="Erros de localização">
                ✕ {stats.error}
              </span>
            )}
          </div>
        </div>

        {/* Barra da Planilha Importada com Botão de Remover */}
        {onRemoveSpreadsheet && (
          <div className="list-spreadsheet-bar">
            <span className="list-spreadsheet-name" title={importedSpreadsheet?.name || 'Planilha importada'}>
              <FileSpreadsheet size={14} />
              <span>{importedSpreadsheet?.name || 'Planilha importada'}</span>
            </span>
            <button
              type="button"
              className="btn-remove-imported-list"
              onClick={onRemoveSpreadsheet}
              title="Remover planilha importada e limpar todas as paradas do mapa"
            >
              <Trash2 size={13} />
              <span>Remover Planilha</span>
            </button>
          </div>
        )}

        {/* Barra de Progresso de Geocodificação */}
        {geocodingProgress && (
          <div className="geocoding-progress-bar">
            <div className="progress-track">
              <div
                className="progress-fill-bar"
                style={{ width: `${Math.min(100, Math.round((geocodingProgress.current / (geocodingProgress.total || 1)) * 100))}%` }}
              />
            </div>
            <div className="progress-label-row">
              <span className="spinner-mini"></span>
              <span>
                Geocodificando {geocodingProgress.current}/{geocodingProgress.total}
                ({Math.round((geocodingProgress.current / (geocodingProgress.total || 1)) * 100)}%)
              </span>
            </div>
          </div>
        )}

        {/* Toolbar de Busca e Filtros */}
        <div className="list-search-toolbar">
          <div className="search-input-wrapper">
            <Search size={16} />
            <input
              type="text"
              placeholder="Buscar rua, cliente, quadra, lote, CEP..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                type="button"
                className="btn-clear-search"
                onClick={() => setSearchTerm('')}
                title="Limpar busca"
              >
                <X size={15} />
              </button>
            )}
          </div>

          <div className="filters-chips-bar">
            <button
              type="button"
              className={`filter-chip ${filterStatus === 'all' ? 'active' : ''}`}
              onClick={() => setFilterStatus('all')}
            >
              Todos ({stats.total})
            </button>
            <button
              type="button"
              className={`filter-chip ${filterStatus === 'geocoded' ? 'active' : ''}`}
              onClick={() => setFilterStatus('geocoded')}
            >
              No Mapa ({stats.geocoded})
            </button>
            {stats.quadraLote > 0 && (
              <button
                type="button"
                className={`filter-chip quadra ${filterStatus === 'quadra-lote' ? 'active' : ''}`}
                onClick={() => setFilterStatus('quadra-lote')}
              >
                Qd / Lt ({stats.quadraLote})
              </button>
            )}
            {stats.error > 0 && (
              <button
                type="button"
                className={`filter-chip error ${filterStatus === 'error' ? 'active' : ''}`}
                onClick={() => setFilterStatus('error')}
              >
                Erros ({stats.error})
              </button>
            )}

            <div className="sort-wrapper">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="sort-select"
                title="Ordenar lista"
              >
                <option value="original">Ordem da Planilha</option>
                <option value="quadra">Por Quadra (Crescente)</option>
                <option value="street">Por Rua (A-Z)</option>
                <option value="recipient">Por Destinatário (A-Z)</option>
                <option value="status">Por Status no Mapa</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Lista Rolável de Itens de Endereço */}
      <div className="address-items-scroller">
        {filteredAddresses.length === 0 ? (
          <div className="empty-search-state">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <p>Nenhuma entrega corresponde aos filtros atuais.</p>
            {searchTerm && (
              <button className="btn-reset-filters" onClick={() => { setSearchTerm(''); setFilterStatus('all'); }}>
                Limpar busca e filtros
              </button>
            )}
          </div>
        ) : (
          filteredAddresses.map((address, idx) => {
            const isSelected = selectedId === address.originalRow;
            const pinGroup = groupByRow.get(address.originalRow);
            const hasMultiPackages = Boolean(pinGroup && pinGroup.packageCount > 1);
            return (
              <div
                key={`addr-${address.originalRow}-${idx}`}
                ref={isSelected ? selectedItemRef : null}
                className={`address-card-item ${isSelected ? 'is-selected' : ''} ${address.geocoded ? 'is-geocoded' : 'is-pending'} ${address.error ? 'is-error' : ''}`}
                onClick={() => onSelect(address.originalRow)}
              >
                {/* Indicador Numérico de Parada */}
                <div className="stop-number-col">
                  <span className="stop-badge">#{address.originalRow}</span>
                  {address.geocoded && <span className="status-pin geocoded" title="No mapa" />}
                  {address.error && <span className="status-pin error" title={address.error} />}
                  {!address.geocoded && !address.error && <span className="status-pin pending" title="Pendente" />}
                </div>

                {/* Conteúdo do Endereço */}
                <div className="address-main-col">
                  <div className="recipient-row">
                    <span className="recipient-name" title={address.recipient}>
                      {address.recipient || `Parada #${address.originalRow}`}
                    </span>
                    {address.orderId && (
                      <span className="order-tag">{address.orderId}</span>
                    )}
                  </div>

                  <div className="street-line">
                    <strong>{address.street}</strong>
                    {address.number ? `, Nº ${address.number}` : ''}
                  </div>

                  {(address.quadra || address.lote || address.isManuallyAdjusted || hasMultiPackages) && (
                    <div className="quadra-lote-pills">
                      {hasMultiPackages && (
                        <span
                          className="pill-group-pin"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(address.originalRow);
                          }}
                          title={`Mesmo endereço agrupado no pino #${pinGroup.stopNumber} (${pinGroup.packageCount} pacotes)`}
                        >
                          📦 Pino #{pinGroup.stopNumber} ({pinGroup.packageCount} pct)
                        </span>
                      )}
                      {address.quadra && (
                        <span
                          className="pill-quadra clickable"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onSelectQuadra) onSelectQuadra(address.quadra);
                          }}
                          title="Clique para localizar esta quadra no mapa"
                        >
                          Quadra {address.quadra} ↗
                        </span>
                      )}
                      {address.lote && (
                        <span className="pill-lote">Lote {address.lote}</span>
                      )}
                      {address.isManuallyAdjusted && (
                        <span className="pill-adjusted" title="Posição ajustada manualmente no mapa">
                          📌 Posição editada
                        </span>
                      )}
                    </div>
                  )}

                  <div className="location-line">
                    {[address.complement, address.neighborhood, address.city, address.zipCode].filter(Boolean).join(' • ')}
                  </div>

                  {address.error && (
                    <div className="error-note">
                      ⚠️ {address.error}
                    </div>
                  )}
                </div>

                {/* Ações Rápidas */}
                <div className="address-actions-col">
                  {onConfirmDelivery && (
                    <button
                      type="button"
                      className="btn-card-icon confirm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onConfirmDelivery(address.originalRow, true);
                      }}
                      title="Confirmar entrega deste pacote e mover para Histórico"
                    >
                      ✓
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn-card-icon"
                    onClick={(e) => { e.stopPropagation(); onSelect(address.originalRow); }}
                    title="Centralizar no Mapa"
                  >
                    📍
                  </button>

                  <button
                    type="button"
                    className="btn-card-icon"
                    onClick={(e) => handleCopyAddress(e, address)}
                    title={copiedId === address.originalRow ? 'Copiado!' : 'Copiar endereço'}
                  >
                    {copiedId === address.originalRow ? '✓' : '📋'}
                  </button>

                  {address.coordinates && (
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${address.coordinates.lat},${address.coordinates.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-card-icon"
                      onClick={(e) => e.stopPropagation()}
                      title="Abrir rota exata no Google Maps"
                    >
                      ↗
                    </a>
                  )}

                  {onRemove && (
                    <button
                      type="button"
                      className="btn-card-icon danger"
                      onClick={(e) => { e.stopPropagation(); onRemove(address.originalRow); }}
                      title="Excluir da rota"
                    >
                      🗑
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
