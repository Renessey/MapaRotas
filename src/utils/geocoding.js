import itaipuacuQuadras from '../data/itaipuacuQuadras.json';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'RouteScannerApp/1.0 (https://github.com/rotascanner)';

const cache = new Map();

/**
 * Busca uma quadra de Itaipuaçu pelo número ou código
 */
export function findItaipuacuQuadra(quadraStr) {
  if (!quadraStr) return null;
  const clean = String(quadraStr).trim().toUpperCase();
  const numInt = parseInt(clean, 10);

  return itaipuacuQuadras.find(q => {
    if (q.rawNumber.toUpperCase() === clean) return true;
    if (q.number.toUpperCase() === clean) return true;
    if (!isNaN(numInt) && parseInt(q.number, 10) === numInt) return true;
    return false;
  }) || null;
}

/**
 * Limpa termos comuns que confundem a API do OpenStreetMap no Brasil
 * (como "Quadra 12", "Lote 34", "Casa 2", "Apto 101", etc)
 */
function cleanStreetName(street) {
  if (!street) return '';
  return street
    .replace(/(?:quadra|qd\.?|q\.)\s*[a-zA-Z0-9_-]+/gi, '')
    .replace(/(?:lote|lt\.?|l\.)\s*[a-zA-Z0-9_-]+/gi, '')
    .replace(/(?:casa|cs\.?)\s*[a-zA-Z0-9_-]+/gi, '')
    .replace(/(?:apartamento|apto\.?|ap\.?)\s*[a-zA-Z0-9_-]+/gi, '')
    .replace(/(?:bloco|bl\.?)\s*[a-zA-Z0-9_-]+/gi, '')
    .replace(/,\s*,/g, ',')
    .trim()
    .replace(/^,\s*|,\s*$/g, '');
}

/**
 * Constrói diferentes níveis de consulta para fallback de geocodificação
 */
function buildQueryCandidates(address) {
  const candidates = [];
  const cleanedStreet = cleanStreetName(address.street);
  const city = address.city || 'Maricá';
  const state = address.state || 'RJ';

  // Tentativa 1: Rua limpa + Número + Bairro + Cidade + Estado
  if (cleanedStreet) {
    const parts1 = [cleanedStreet];
    if (address.number) parts1.push(address.number);
    if (address.neighborhood) parts1.push(address.neighborhood);
    parts1.push(city, state, 'Brasil');
    candidates.push(parts1.join(', '));

    // Tentativa 2: Rua limpa + Cidade + Estado (sem número ou bairro que podem falhar)
    const parts2 = [cleanedStreet, city, state, 'Brasil'];
    candidates.push(parts2.join(', '));
  }

  // Tentativa 3: CEP (muito confiável no Brasil)
  if (address.zipCode) {
    const cleanCep = String(address.zipCode).replace(/\D/g, '');
    if (cleanCep.length === 8) {
      candidates.push(`${cleanCep.slice(0, 5)}-${cleanCep.slice(5)}, Brasil`);
    } else {
      candidates.push(`${address.zipCode}, Brasil`);
    }
  }

  // Tentativa 4: Bairro + Cidade + Estado
  if (address.neighborhood) {
    candidates.push(`${address.neighborhood}, ${city}, ${state}, Brasil`);
  }

  // Fallback final: Cidade + Estado
  candidates.push(`${city}, ${state}, Brasil`);

  return [...new Set(candidates)];
}

async function fetchFromNominatim(query, retries = 2) {
  const url = `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=br&addressdetails=1`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'pt-BR,pt;q=0.9',
        },
      });

      if (response.status === 429) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
          displayName: data[0].display_name,
          addressType: data[0].type,
          importance: data[0].importance,
        };
      }
      return null;
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  return null;
}

async function geocodeAddress(address) {
  const cacheKey = address.fullAddress || `${address.street}-${address.number}-${address.zipCode}`;

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  // Tenta geocodificar pelas consultas Nominatim OSM
  const queries = buildQueryCandidates(address);

  for (const query of queries) {
    try {
      const result = await fetchFromNominatim(query);
      if (result) {
        cache.set(cacheKey, result);
        return result;
      }
    } catch {
      // Tenta próxima consulta alternativa
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }

  // Fallback: Se não encontrou no OSM mas o endereço tem Quadra, localiza pela quadra de Itaipuaçu
  if (address.quadra) {
    const quadraMatch = findItaipuacuQuadra(address.quadra);
    if (quadraMatch) {
      const result = {
        lat: quadraMatch.lat,
        lng: quadraMatch.lng,
        displayName: `Quadra ${quadraMatch.rawNumber}, Itaipuaçu, Maricá - RJ`,
        addressType: 'quadra',
        importance: 0.8,
        isQuadraMatch: true,
      };
      cache.set(cacheKey, result);
      return result;
    }
  }

  return null;
}

export async function geocodeAddresses(addresses, onProgress, signal = null) {
  const results = [];
  const total = addresses.length;

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) break;
    const address = addresses[i];

    // Se o endereço já tiver coordenadas válidas, pula requisição
    if (address.coordinates && typeof address.coordinates.lat === 'number' && typeof address.coordinates.lng === 'number') {
      results.push({
        ...address,
        geocoded: true,
      });
      if (onProgress) onProgress(i + 1, total, address);
      continue;
    }

    try {
      const coords = await geocodeAddress(address);
      if (signal?.aborted) break;
      results.push({
        ...address,
        coordinates: coords,
        geocoded: !!coords,
        error: coords ? null : 'Endereço não localizado',
      });
    } catch (error) {
      if (signal?.aborted) break;
      results.push({
        ...address,
        coordinates: null,
        geocoded: false,
        error: error.message || 'Erro de conexão na geocodificação',
      });
    }

    if (onProgress && !signal?.aborted) {
      onProgress(i + 1, total, address);
    }

    if (i < total - 1 && !signal?.aborted) {
      await new Promise(resolve => setTimeout(resolve, 600));
    }
  }

  return results;
}

export function clearCache() {
  cache.clear();
}

export function getCacheStats() {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}
