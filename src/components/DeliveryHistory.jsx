import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import './DeliveryHistory.css';

function formatDeliveredTime(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function DeliveryHistory({
  deliveredAddresses = [],
  totalAddresses = 0,
  groupedStops = [],
  selectedId,
  onSelect,
  onSelectQuadra,
  onConfirmDelivery,
  onOpenDeliveries,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('recent');

  const groupByRow = useMemo(() => {
    const map = new Map();
    for (const g of groupedStops) {
      for (const r of g.rowIds) {
        map.set(r, g);
      }
    }
    return map;
  }, [groupedStops]);

  const stats = useMemo(() => {
    const totalDelivered = deliveredAddresses.length;
    const total = Math.max(totalAddresses, totalDelivered);
    const pct = total > 0 ? Math.round((totalDelivered / total) * 100) : 0;
    const deliveredPins = groupedStops.filter((g) => g.isDelivered).length;
    return { totalDelivered, total, pct, deliveredPins };
  }, [deliveredAddresses, totalAddresses, groupedStops]);

  const filteredHistory = useMemo(() => {
    let result = [...deliveredAddresses];

    if (searchTerm.trim()) {
      const rawTerm = searchTerm.toLowerCase().trim();
      const numericSearch = rawTerm.replace(/^#/, '');

      result = result.filter((addr) => {
        const pinGroup = groupByRow.get(addr.originalRow);
        const rowStr = String(addr.originalRow || '');
        const pinStr = pinGroup ? String(pinGroup.stopNumber) : '';
        return (
          rowStr === numericSearch ||
          `#${rowStr}`.includes(rawTerm) ||
          (pinGroup && `pino #${pinStr}`.includes(rawTerm)) ||
          (addr.recipient && addr.recipient.toLowerCase().includes(rawTerm)) ||
          (addr.street && addr.street.toLowerCase().includes(rawTerm)) ||
          (addr.neighborhood && addr.neighborhood.toLowerCase().includes(rawTerm)) ||
          (addr.orderId && addr.orderId.toLowerCase().includes(rawTerm)) ||
          (addr.complement && addr.complement.toLowerCase().includes(rawTerm)) ||
          (addr.quadra && `quadra ${String(addr.quadra).toLowerCase()}`.includes(rawTerm)) ||
          (addr.quadra && `qd ${String(addr.quadra).toLowerCase()}`.includes(rawTerm)) ||
          (addr.quadra && String(addr.quadra).toLowerCase().includes(rawTerm)) ||
          (addr.lote && `lote ${String(addr.lote).toLowerCase()}`.includes(rawTerm)) ||
          (addr.lote && `lt ${String(addr.lote).toLowerCase()}`.includes(rawTerm)) ||
          (addr.lote && String(addr.lote).toLowerCase().includes(rawTerm))
        );
      });
    }

    if (sortBy === 'recent') {
      result.sort((a, b) => {
        const tA = a.deliveredAt ? new Date(a.deliveredAt).getTime() : 0;
        const tB = b.deliveredAt ? new Date(b.deliveredAt).getTime() : 0;
        if (tB !== tA) return tB - tA;
        return a.originalRow - b.originalRow;
      });
    } else if (sortBy === 'original') {
      result.sort((a, b) => a.originalRow - b.originalRow);
    } else if (sortBy === 'group') {
      result.sort((a, b) => {
        const gA = groupByRow.get(a.originalRow)?.stopNumber ?? 99999;
        const gB = groupByRow.get(b.originalRow)?.stopNumber ?? 99999;
        if (gA !== gB) return gA - gB;
        return a.originalRow - b.originalRow;
      });
    } else if (sortBy === 'quadra') {
      result.sort((a, b) => {
        const qA = parseInt(a.quadra, 10) || 9999;
        const qB = parseInt(b.quadra, 10) || 9999;
        if (qA !== qB) return qA - qB;
        return a.originalRow - b.originalRow;
      });
    }

    return result;
  }, [deliveredAddresses, searchTerm, sortBy, groupByRow]);

  if (deliveredAddresses.length === 0) {
    return (
      <div className="history-empty-state">
        <div className="history-empty-icon">📦</div>
        <h4>Nenhuma entrega concluída ainda</h4>
        <p>
          Clique em um pino no mapa e pressione <strong>✓ Confirmar Entrega</strong> no modal do pino.
          O pino ficará cinza no mapa e os pacotes serão movidos para esta tabela de histórico.
        </p>
        {onOpenDeliveries && totalAddresses > 0 && (
          <button
            type="button"
            className="btn-back-deliveries"
            onClick={onOpenDeliveries}
          >
            Ir para Entregas ({totalAddresses}) ➔
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="delivery-history-container">
      {/* Cabeçalho e Progresso */}
      <div className="history-header-card">
        <div className="history-title-row">
          <div className="history-title-badge">
            <h3>Histórico de Entregas</h3>
            <span className="history-count-pill">{stats.totalDelivered}</span>
          </div>
          <div className="history-badges-row">
            <span className="h-badge h-badge-done" title="Pacotes marcados como entregues">
              ✓ {stats.totalDelivered} entregues
            </span>
            {stats.deliveredPins > 0 && (
              <span className="h-badge h-badge-pins" title="Pinos já totalmente entregues no mapa">
                ✓ {stats.deliveredPins} pinos verdes
              </span>
            )}
          </div>
        </div>

        <div className="history-progress-wrap">
          <div className="history-progress-track">
            <div className="history-progress-fill" style={{ width: `${stats.pct}%` }} />
          </div>
          <span className="history-progress-label">
            {stats.totalDelivered} de {stats.total} pacotes concluídos ({stats.pct}%)
          </span>
        </div>

        {/* Busca e Ordenação dentro da Tabela de Histórico */}
        <div className="history-toolbar">
          <div className="history-search-wrapper">
            <Search size={15} />
            <input
              type="text"
              placeholder="Buscar #34, #101, lote, quadra, rua, cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                type="button"
                className="btn-clear-hsearch"
                onClick={() => setSearchTerm('')}
                title="Limpar busca"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="history-sort-select"
            title="Ordenar histórico"
          >
            <option value="recent">Mais recentes</option>
            <option value="group">Por Pino / Lote</option>
            <option value="original">Ordem (#)</option>
            <option value="quadra">Por Quadra</option>
          </select>
        </div>
      </div>

      {/* Tabela de Pacotes Concluídos */}
      <div className="history-table-scroller">
        {filteredHistory.length === 0 ? (
          <div className="history-no-match">
            <p>Nenhum pacote entregue encontrado para &ldquo;{searchTerm}&rdquo;.</p>
            <button type="button" className="btn-reset-hsearch" onClick={() => setSearchTerm('')}>
              Limpar busca
            </button>
          </div>
        ) : (
          <table className="history-table">
            <thead>
              <tr>
                <th className="col-stop">Parada</th>
                <th className="col-details">Pacote / Endereço</th>
                <th className="col-status">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredHistory.map((addr, idx) => {
                const isSelected = selectedId === addr.originalRow;
                const pinGroup = groupByRow.get(addr.originalRow);
                const siblingRows = pinGroup
                  ? pinGroup.rowIds.filter((r) => r !== addr.originalRow)
                  : [];
                const timeStr = formatDeliveredTime(addr.deliveredAt);

                return (
                  <tr
                    key={`hist-${addr.originalRow}-${idx}`}
                    className={`history-table-row ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => onSelect && onSelect(addr.originalRow)}
                  >
                    <td className="col-stop">
                      <span className="history-stop-num">#{addr.originalRow}</span>
                      {pinGroup && (
                        <span
                          className="history-pin-ref"
                          title={`Pino #${pinGroup.stopNumber} no mapa (${pinGroup.packageCount} pacote${pinGroup.packageCount > 1 ? 's' : ''})`}
                        >
                          Pino #{pinGroup.stopNumber}
                        </span>
                      )}
                    </td>

                    <td className="col-details">
                      <div className="history-recip-line">
                        <strong className="history-recip" title={addr.recipient}>
                          {addr.recipient || `Parada #${addr.originalRow}`}
                        </strong>
                        {addr.orderId && <span className="history-order">{addr.orderId}</span>}
                      </div>

                      <div className="history-street-line">
                        {addr.street}
                        {addr.number ? `, Nº ${addr.number}` : ''}
                      </div>

                      <div className="history-tags-line">
                        {addr.quadra && (
                          <span
                            className="h-tag qd clickable"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onSelectQuadra) onSelectQuadra(addr.quadra);
                            }}
                            title="Localizar quadra no mapa"
                          >
                            Qd {addr.quadra}
                          </span>
                        )}
                        {addr.lote && <span className="h-tag lt">Lt {addr.lote}</span>}
                        {siblingRows.length > 0 && (
                          <span
                            className="h-tag shared"
                            title={`Mesmo endereço/lote de: ${siblingRows.map((r) => `#${r}`).join(', ')}`}
                          >
                            🔗 +{siblingRows.map((r) => `#${r}`).join(', ')}
                          </span>
                        )}
                        {timeStr && <span className="h-time">🕒 {timeStr}</span>}
                      </div>
                    </td>

                    <td className="col-status" onClick={(e) => e.stopPropagation()}>
                      <span className="h-status-pill">✓ Concluído</span>
                      <div className="h-row-actions">
                        <button
                          type="button"
                          className="h-action-btn locate"
                          onClick={() => onSelect && onSelect(addr.originalRow)}
                          title="Localizar pino cinza no mapa"
                        >
                          📍
                        </button>
                        {onConfirmDelivery && (
                          <button
                            type="button"
                            className="h-action-btn undo"
                            onClick={() => onConfirmDelivery(addr.originalRow, false)}
                            title="Desfazer entrega e devolver para lista de Entregas"
                          >
                            ↩️
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Rodapé do Histórico */}
      <div className="history-footer-bar">
        <span className="history-footer-info">
          Mostrando {filteredHistory.length} de {deliveredAddresses.length} concluídos
        </span>
        {onConfirmDelivery && deliveredAddresses.length > 1 && (
          <button
            type="button"
            className="btn-reopen-all"
            onClick={() => {
              if (window.confirm(`Deseja reabrir todos os ${deliveredAddresses.length} pacotes e movê-los de volta para Entregas?`)) {
                onConfirmDelivery(deliveredAddresses.map((a) => a.originalRow), false);
              }
            }}
          >
            ↩️ Reabrir todos
          </button>
        )}
      </div>
    </div>
  );
}
