/**
 * Utilitários para agrupar múltiplos pacotes pertencentes ao mesmo endereço em um único pino no mapa.
 */

function stripAccents(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeQuadraToken(val) {
  if (!val) return '';
  const cleaned = stripAccents(val)
    .trim()
    .replace(/^(?:quadra|quad\.?|qd\.?|q\.?)\s*(?:n[º°.]?\s*)?[:\-_/\s]*/i, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return cleaned.replace(/^0+(?=\d)/, '');
}

function normalizeLoteToken(val) {
  if (!val) return '';
  const cleaned = stripAccents(val)
    .trim()
    .replace(/^(?:lote|lot\.?|lt\.?|l\.)\s*(?:n[º°.]?\s*)?[:\-_/\s]*/i, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return cleaned.replace(/^0+(?=\d)/, '');
}

function normalizeNumberToken(val) {
  if (!val) return '';
  const s = stripAccents(val)
    .toLowerCase()
    .trim()
    .replace(/^(?:n[º°.]?|num\.?)\s*[:-]?\s*/i, '');
  if (!s || /^(?:s\/?n[º°]?|sn|sem\s+numero|0+)$/i.test(s)) {
    return '';
  }
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=\d)/, '');
}

function normalizeStreetAndExtractNumber(street, existingNum) {
  let raw = stripAccents(street).toLowerCase().trim();
  let num = normalizeNumberToken(existingNum);

  // Remove menções embutidas de quadra, lote, casa, apto e s/n
  raw = raw
    .replace(/(?:^|[\s,.;:/\-(])(?:quadra|quad\.?|qd\.?|q\.?)\s*(?:n[º°.]?\s*)?[:\-_/\s]*0*\d+(?:[a-zA-Z](?![a-zA-Z0-9]))?/gi, ' ')
    .replace(/(?:^|[\s,.;:/\-(]|\d)(?:lote|lot\.?|lt\.?|l\.)\s*(?:n[º°.]?\s*)?[:\-_/\s]*[0-9]+[a-zA-Z]?\b/gi, ' ')
    .replace(/\b(?:casa|cs\.?|apartamento|apto\.?|ap\.?|bloco|bl\.?|loja|lj\.?|sala|sl\.?|fundos|frente)\b[^,]*/gi, ' ')
    .replace(/\b(?:s\/n[º°]?|sn|sem\s+numero)\b/gi, ' ');

  // Se o número não veio na coluna própria, tenta extrair número de casa no fim do logradouro
  if (!num) {
    const trailingNum = raw.match(/(?:,\s*|\s+n[º°]?\s*)(\d+[a-zA-Z]?)\s*$/i);
    if (trailingNum) {
      num = normalizeNumberToken(trailingNum[1]);
      raw = raw.slice(0, trailingNum.index);
    }
  } else {
    // Remove duplicação do próprio número no fim da rua ("Rua 34, 100" vs "Rua 34")
    const trailingNum = raw.match(/(?:,\s*|\s+n[º°]?\s*)(\d+[a-zA-Z]?)\s*$/i);
    if (trailingNum && normalizeNumberToken(trailingNum[1]) === num) {
      raw = raw.slice(0, trailingNum.index);
    }
  }

  raw = raw
    .replace(/\br\.?\s+/g, 'rua ')
    .replace(/\bav\.?\s+/g, 'avenida ')
    .replace(/\bestr\.?\s+/g, 'estrada ')
    .replace(/\btv\.?\s+/g, 'travessa ')
    .replace(/\bdr\.?\s+/g, 'doutor ')
    .replace(/\bprof\.?\s+/g, 'professor ')
    .replace(/[.,;:/\-()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { normStreet: raw, normNum: num };
}

function getInlineQuadraLote(text) {
  if (!text) return { quadra: '', lote: '' };
  const s = stripAccents(text);
  const qM = s.match(/(?:^|[\s,.;:/\-(])(?:quadra|quad\.?|qd\.?|q\.?)\s*(?:n[º°.]?\s*)?[:\-_/\s]*0*(\d+(?:[a-zA-Z](?![a-zA-Z0-9]))?)/i);
  const lM = s.match(/(?:^|[\s,.;:/\-(]|\d)(?:lote|lot\.?|lt\.?|l\.)\s*(?:n[º°.]?\s*)?[:\-_/\s]*([0-9]+[a-zA-Z]?)\b/i);
  return {
    quadra: qM ? normalizeQuadraToken(qM[1]) : '',
    lote: lM ? normalizeLoteToken(lM[1]) : '',
  };
}

/**
 * Gera a chave canônica de endereço físico para identificar múltiplos pacotes para o mesmo local.
 */
export function getAddressGroupKey(addr) {
  if (!addr) return '';
  const fromStreet = getInlineQuadraLote(addr.street);
  const fromCompl = getInlineQuadraLote(addr.complement);

  const normQd = normalizeQuadraToken(addr.quadra) || fromStreet.quadra || fromCompl.quadra;
  const normLt = normalizeLoteToken(addr.lote) || fromStreet.lote || fromCompl.lote;
  const { normStreet, normNum } = normalizeStreetAndExtractNumber(addr.street, addr.number);

  const normCompl = stripAccents(addr.complement).toLowerCase().replace(/[^a-z0-9]/g, '');
  const normRecip = stripAccents(addr.recipient).toLowerCase().replace(/[^a-z0-9]/g, '');
  const normZip = String(addr.zipCode || '').replace(/\D/g, '');

  // Endereço específico (possui número de casa, ou quadra+lote, ou quadra no mesmo CEP/rua)
  const hasSpecificProperty = Boolean(normNum || (normQd && normLt) || normQd);

  if (hasSpecificProperty && normStreet) {
    return `prop:${normStreet}|n:${normNum}|q:${normQd}|l:${normLt}`;
  }

  // Apenas CEP + Número/Qd/Lt (quando logradouro veio vazio)
  if (hasSpecificProperty && normZip) {
    return `zip:${normZip}|n:${normNum}|q:${normQd}|l:${normLt}`;
  }

  // Sem número/quadra/lote (ex: S/N): agrupa apenas se for o mesmo destinatário ou mesmo complemento na mesma rua
  if (normStreet && (normRecip || normCompl)) {
    return `vague:${normStreet}|r:${normRecip}|c:${normCompl}`;
  }

  return `row:${addr.originalRow}`;
}

function distanceMeters(a, b) {
  const cosLat = Math.cos((a.lat * Math.PI) / 180);
  const dLat = (a.lat - b.lat) * 111320;
  const dLng = (a.lng - b.lng) * 111320 * cosLat;
  return Math.hypot(dLat, dLng);
}

/**
 * Agrupa paradas já posicionadas no mapa que apontam para o mesmo endereço em um único pino.
 * Retorna lista ordenada de grupos:
 *   { groupKey, groupId, stopNumber, coordinates, primary, items, packageCount, rowIds, isManuallyAdjusted, deliveredCount, isDelivered, isPartiallyDelivered }
 */
export function groupDeliveryAddressesForMap(addresses) {
  if (!addresses || addresses.length === 0) return [];

  const groups = [];
  const bucketsByKey = new Map();

  for (let i = 0; i < addresses.length; i++) {
    const addr = addresses[i];
    if (
      !addr ||
      !addr.coordinates ||
      isNaN(addr.coordinates.lat) ||
      isNaN(addr.coordinates.lng)
    ) {
      continue;
    }

    const baseKey = getAddressGroupKey(addr);
    const existingBuckets = bucketsByKey.get(baseKey);

    let matchedGroup = null;
    if (existingBuckets) {
      for (const g of existingBuckets) {
        // Confirma proximidade física (~120m) para não unir acidentalmente quadras distantes homônimas
        // nem desfazer pinos que o motorista arrastou para pontos separados
        if (distanceMeters(g.coordinates, addr.coordinates) <= 120) {
          matchedGroup = g;
          break;
        }
      }
    }

    if (matchedGroup) {
      matchedGroup.items.push(addr);
      matchedGroup.rowIds.push(addr.originalRow);
      matchedGroup.packageCount = matchedGroup.items.length;
      if (addr.isManuallyAdjusted) {
        matchedGroup.isManuallyAdjusted = true;
      }
    } else {
      const groupNumber = groups.length + 1;
      const newGroup = {
        groupId: `grp-${addr.originalRow ?? i}`,
        groupKey: baseKey,
        stopNumber: groupNumber,
        coordinates: {
          lat: addr.coordinates.lat,
          lng: addr.coordinates.lng,
        },
        primary: addr,
        items: [addr],
        packageCount: 1,
        rowIds: [addr.originalRow],
        isManuallyAdjusted: Boolean(addr.isManuallyAdjusted),
        deliveredCount: 0,
        isDelivered: false,
        isPartiallyDelivered: false,
        isLocked: Boolean(addr.isLocked),
      };
      groups.push(newGroup);
      if (!bucketsByKey.has(baseKey)) {
        bucketsByKey.set(baseKey, [newGroup]);
      } else {
        bucketsByKey.get(baseKey).push(newGroup);
      }
    }
  }

  for (const g of groups) {
    const deliveredCount = g.items.filter((item) => Boolean(item.delivered)).length;
    g.deliveredCount = deliveredCount;
    g.isDelivered = g.items.length > 0 && deliveredCount === g.items.length;
    g.isPartiallyDelivered = deliveredCount > 0 && deliveredCount < g.items.length;
    g.isLocked = g.items.some((item) => Boolean(item.isLocked));
  }

  return groups;
}
