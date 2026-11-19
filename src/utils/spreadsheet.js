import * as XLSX from 'xlsx';

export function parseSpreadsheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        resolve(jsonData);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Tenta extrair Quadra e Lote de qualquer texto de endereço
 */
export function extractQuadraLote(text) {
  if (!text) return { quadra: '', lote: '' };
  const str = String(text);

  let quadra = '';
  let lote = '';

  const quadraMatch = str.match(/(?:quadra|qd\.?|q\.)\s*([a-zA-Z0-9_-]+)/i);
  if (quadraMatch) {
    quadra = quadraMatch[1].trim();
  }

  const loteMatch = str.match(/(?:lote|lt\.?|l\.)\s*([a-zA-Z0-9_-]+)/i);
  if (loteMatch) {
    lote = loteMatch[1].trim();
  }

  return { quadra, lote };
}

export function detectColumns(headers) {
  const normalized = headers.map(h => String(h || '').toLowerCase().trim());

  const columnMap = {
    street: null,
    number: null,
    neighborhood: null,
    city: null,
    state: null,
    zipCode: null,
    quadra: null,
    lote: null,
    complement: null,
    recipient: null,
    phone: null,
    orderId: null,
    latitude: null,
    longitude: null,
  };

  normalized.forEach((header, index) => {
    const h = header.toLowerCase();
    if (h.includes('destination address') || h === 'destination_address' || h.includes('rua') || h.includes('logradouro') || h.includes('endereço') || h.includes('endereco') || h.includes('address') || h === 'street') {
      if (columnMap.street === null) columnMap.street = index;
    } else if (h.includes('número') || h.includes('numero') || h === 'number' || h === 'n°' || h === 'n') {
      if (columnMap.number === null) columnMap.number = index;
    } else if (h === 'bairro' || h.includes('bairro') || h === 'neighborhood' || h === 'district') {
      if (columnMap.neighborhood === null) columnMap.neighborhood = index;
    } else if (h === 'cidade' || h.includes('cidade') || h === 'city' || h.includes('municipio') || h.includes('município')) {
      if (columnMap.city === null) columnMap.city = index;
    } else if (h.includes('estado') || h === 'state' || h === 'uf') {
      if (columnMap.state === null) columnMap.state = index;
    } else if (h === 'zipcode' || h === 'postal code' || h === 'postal_code' || h.includes('cep') || h.includes('zip') || h === 'postal') {
      if (columnMap.zipCode === null) columnMap.zipCode = index;
    } else if (h === 'latitude' || h === 'lat' || h.includes('latitude')) {
      if (columnMap.latitude === null) columnMap.latitude = index;
    } else if (h === 'longitude' || h === 'lon' || h === 'lng' || h.includes('longitude')) {
      if (columnMap.longitude === null) columnMap.longitude = index;
    } else if (h.includes('quadra') || h === 'block' || h === 'quad' || h === 'qd') {
      if (columnMap.quadra === null) columnMap.quadra = index;
    } else if (h.includes('lote') || h === 'lot' || h === 'lt') {
      if (columnMap.lote === null) columnMap.lote = index;
    } else if (h.includes('complemento') || h === 'complement' || h === 'compl') {
      if (columnMap.complement === null) columnMap.complement = index;
    } else if (h.includes('destinatário') || h.includes('destinatario') || h.includes('cliente') || h === 'recipient' || h === 'name' || h.includes('nome')) {
      if (columnMap.recipient === null) columnMap.recipient = index;
    } else if (h.includes('telefone') || h.includes('fone') || h === 'phone' || h === 'tel' || h.includes('celular')) {
      if (columnMap.phone === null) columnMap.phone = index;
    } else if (h.includes('pedido') || h.includes('ordem') || h === 'order' || h === 'id' || h.includes('pacote') || h.includes('código')) {
      if (columnMap.orderId === null) columnMap.orderId = index;
    }
  });

  return columnMap;
}

export function extractAddresses(rows, columnMap) {
  if (!rows || rows.length < 2) return [];

  const addresses = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(cell => !cell)) continue;

    const getValue = (colIndex) => colIndex !== null && colIndex !== undefined && row[colIndex] !== undefined && row[colIndex] !== null ? String(row[colIndex]).trim() : '';

    const street = getValue(columnMap.street);
    const number = getValue(columnMap.number);
    const neighborhood = getValue(columnMap.neighborhood);
    const city = getValue(columnMap.city) || 'Maricá';
    const state = getValue(columnMap.state) || 'RJ';
    const zipCode = getValue(columnMap.zipCode);
    let quadra = getValue(columnMap.quadra);
    let lote = getValue(columnMap.lote);
    const complement = getValue(columnMap.complement);
    const recipient = getValue(columnMap.recipient) || `Destinatário #${i}`;
    const phone = getValue(columnMap.phone);
    const orderId = getValue(columnMap.orderId) || `PED-${i.toString().padStart(4, '0')}`;
    const latitude = getValue(columnMap.latitude);
    const longitude = getValue(columnMap.longitude);

    if (!street && !zipCode && !latitude && !longitude) continue;

    // Se quadra ou lote não vieram de colunas específicas, tenta extrair de rua ou complemento
    if (!quadra || !lote) {
      const fromStreet = extractQuadraLote(street);
      const fromNumber = extractQuadraLote(number);
      const fromCompl = extractQuadraLote(complement);

      if (!quadra) quadra = fromStreet.quadra || fromNumber.quadra || fromCompl.quadra;
      if (!lote) lote = fromStreet.lote || fromNumber.lote || fromCompl.lote;
    }

    let fullAddress = street;
    if (number) fullAddress += `, ${number}`;
    if (quadra) fullAddress += `, Qd ${quadra}`;
    if (lote) fullAddress += `, Lt ${lote}`;
    if (complement) fullAddress += `, ${complement}`;
    if (neighborhood) fullAddress += `, ${neighborhood}`;
    if (city) fullAddress += `, ${city}`;
    if (state) fullAddress += `, ${state}`;
    if (zipCode) fullAddress += `, CEP: ${zipCode}`;

    const latNum = parseFloat(latitude);
    const lngNum = parseFloat(longitude);
    const hasCoords = !isNaN(latNum) && !isNaN(lngNum) && latNum !== 0 && lngNum !== 0;

    addresses.push({
      originalRow: i,
      street,
      number,
      neighborhood,
      city,
      state,
      zipCode,
      quadra,
      lote,
      complement,
      recipient,
      phone,
      orderId,
      fullAddress,
      hasQuadraLote: !!(quadra || lote),
      coordinates: hasCoords ? { lat: latNum, lng: lngNum } : null,
      geocoded: hasCoords,
    });
  }

  return addresses;
}

export function parseShopeeSpreadsheet(file) {
  return parseSpreadsheet(file).then(rows => {
    if (!rows || rows.length < 2) return [];
    const headers = rows[0];
    const columnMap = detectShopeeColumns(headers);
    return extractShopeeAddresses(rows, columnMap);
  });
}

function detectShopeeColumns(headers) {
  const normalized = headers.map(h => String(h || '').toLowerCase().trim());

  const columnMap = {
    recipient: null,
    phone: null,
    address: null,
    number: null,
    complement: null,
    neighborhood: null,
    city: null,
    state: null,
    zipCode: null,
    orderId: null,
    quadra: null,
    lote: null,
    latitude: null,
    longitude: null,
  };

  normalized.forEach((header, index) => {
    const h = header.toLowerCase();
    if (h.includes('destinatário') || h.includes('destinatario') || h === 'buyer name' || h === 'recipient name' || h.includes('nome do comprador')) {
      if (columnMap.recipient === null) columnMap.recipient = index;
    } else if (h.includes('telefone') || h === 'phone' || h === 'buyer phone' || h.includes('contato')) {
      if (columnMap.phone === null) columnMap.phone = index;
    } else if (h === 'address' || h.includes('endereço') || h.includes('endereco') || h.includes('rua') || h.includes('logradouro') || h.includes('destination address')) {
      if (columnMap.address === null) columnMap.address = index;
    } else if (h === 'number' || h.includes('número') || h.includes('numero') || h === 'n°') {
      if (columnMap.number === null) columnMap.number = index;
    } else if (h.includes('complemento') || h === 'complement') {
      if (columnMap.complement === null) columnMap.complement = index;
    } else if (h === 'bairro' || h.includes('bairro') || h === 'neighborhood' || h === 'district') {
      if (columnMap.neighborhood === null) columnMap.neighborhood = index;
    } else if (h === 'city' || h.includes('cidade') || h.includes('município') || h.includes('municipio')) {
      if (columnMap.city === null) columnMap.city = index;
    } else if (h.includes('estado') || h === 'state' || h === 'uf') {
      if (columnMap.state === null) columnMap.state = index;
    } else if (h === 'zipcode' || h === 'postal code' || h === 'postal_code' || h.includes('cep') || h.includes('zip')) {
      if (columnMap.zipCode === null) columnMap.zipCode = index;
    } else if (h === 'latitude' || h === 'lat' || h.includes('latitude')) {
      if (columnMap.latitude === null) columnMap.latitude = index;
    } else if (h === 'longitude' || h === 'lon' || h === 'lng' || h.includes('longitude')) {
      if (columnMap.longitude === null) columnMap.longitude = index;
    } else if (h.includes('pedido') || h === 'order id' || h === 'order sn' || h === 'order number' || h.includes('nº do pedido')) {
      if (columnMap.orderId === null) columnMap.orderId = index;
    } else if (h.includes('quadra') || h === 'quad' || h === 'qd') {
      if (columnMap.quadra === null) columnMap.quadra = index;
    } else if (h.includes('lote') || h === 'lot' || h === 'lt') {
      if (columnMap.lote === null) columnMap.lote = index;
    }
  });

  return columnMap;
}

function extractShopeeAddresses(rows, columnMap) {
  const addresses = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(cell => !cell)) continue;

    const getValue = (colIndex) => colIndex !== null && colIndex !== undefined && row[colIndex] !== undefined && row[colIndex] !== null ? String(row[colIndex]).trim() : '';

    const recipient = getValue(columnMap.recipient) || `Cliente #${i}`;
    const phone = getValue(columnMap.phone);
    const address = getValue(columnMap.address);
    const number = getValue(columnMap.number);
    const complement = getValue(columnMap.complement);
    const neighborhood = getValue(columnMap.neighborhood);
    const city = getValue(columnMap.city) || 'Maricá';
    const state = getValue(columnMap.state) || 'RJ';
    const zipCode = getValue(columnMap.zipCode);
    const orderId = getValue(columnMap.orderId) || `SHOPEE-${i.toString().padStart(4, '0')}`;
    let quadra = getValue(columnMap.quadra);
    let lote = getValue(columnMap.lote);
    const latitude = getValue(columnMap.latitude);
    const longitude = getValue(columnMap.longitude);

    if (!address && !zipCode) continue;

    if (!quadra || !lote) {
      const fromAddr = extractQuadraLote(address);
      const fromCompl = extractQuadraLote(complement);
      const fromNum = extractQuadraLote(number);
      if (!quadra) quadra = fromAddr.quadra || fromCompl.quadra || fromNum.quadra;
      if (!lote) lote = fromAddr.lote || fromCompl.lote || fromNum.lote;
    }

    let fullAddress = address;
    if (number) fullAddress += `, ${number}`;
    if (quadra) fullAddress += `, Qd ${quadra}`;
    if (lote) fullAddress += `, Lt ${lote}`;
    if (complement) fullAddress += `, ${complement}`;
    if (neighborhood) fullAddress += `, ${neighborhood}`;
    if (city) fullAddress += `, ${city}`;
    if (state) fullAddress += `, ${state}`;
    if (zipCode) fullAddress += `, CEP: ${zipCode}`;

    const latNum = parseFloat(latitude);
    const lngNum = parseFloat(longitude);
    const hasCoords = !isNaN(latNum) && !isNaN(lngNum) && latNum !== 0 && lngNum !== 0;

    addresses.push({
      originalRow: i,
      recipient,
      phone,
      street: address,
      number,
      neighborhood,
      city,
      state,
      zipCode,
      quadra,
      lote,
      complement,
      orderId,
      fullAddress,
      hasQuadraLote: !!(quadra || lote),
      isShopee: true,
      coordinates: hasCoords ? { lat: latNum, lng: lngNum } : null,
      geocoded: hasCoords,
    });
  }

  return addresses;
}

/**
 * Gera dados de exemplo para demonstração rápida (Itaipuaçu, Maricá - RJ)
 */
export function getSampleDeliveryData() {
  return [
    {
      originalRow: 1,
      recipient: 'Carlos Eduardo Silva',
      phone: '(21) 98765-4321',
      street: 'Rua Trinta e Cinco (Rua 35)',
      number: '124',
      quadra: '120',
      lote: '15',
      complement: 'Casa 1',
      neighborhood: 'Jardim Atlântico Leste (Itaipuaçu)',
      city: 'Maricá',
      state: 'RJ',
      zipCode: '24936-000',
      orderId: 'PED-1001',
      fullAddress: 'Rua Trinta e Cinco, 124, Qd 120, Lt 15, Casa 1, Itaipuaçu, Maricá, RJ',
      hasQuadraLote: true,
      coordinates: { lat: -22.9542, lng: -42.8985 },
      geocoded: true,
    },
    {
      originalRow: 2,
      recipient: 'Mariana Souza Santos',
      phone: '(21) 99123-5566',
      street: 'Avenida Beira Mar',
      number: '550',
      quadra: '85',
      lote: '04',
      complement: 'Fundos',
      neighborhood: 'Praia de Itaipuaçu',
      city: 'Maricá',
      state: 'RJ',
      zipCode: '24937-100',
      orderId: 'PED-1002',
      fullAddress: 'Avenida Beira Mar, 550, Qd 85, Lt 04, Itaipuaçu, Maricá, RJ',
      hasQuadraLote: true,
      coordinates: { lat: -22.9665, lng: -42.9210 },
      geocoded: true,
    },
    {
      originalRow: 3,
      recipient: 'Roberto Dias Martins',
      phone: '(21) 97412-8899',
      street: 'Rua Professor Cardoso de Menezes (Rua 1)',
      number: '890',
      quadra: '42',
      lote: '18',
      complement: 'Loja A',
      neighborhood: 'Itaipuaçu Centro',
      city: 'Maricá',
      state: 'RJ',
      zipCode: '24936-400',
      orderId: 'PED-1003',
      fullAddress: 'Rua Professor Cardoso de Menezes, 890, Qd 42, Lt 18, Maricá, RJ',
      hasQuadraLote: true,
      coordinates: { lat: -22.9490, lng: -42.9150 },
      geocoded: true,
    },
    {
      originalRow: 4,
      recipient: 'Juliana Ferreira Lima',
      phone: '(21) 98877-6655',
      street: 'Rua Van Lerbergue (Rua 34)',
      number: '310',
      quadra: '115',
      lote: '22',
      complement: 'Casa 2',
      neighborhood: 'Jardim Atlântico Central',
      city: 'Maricá',
      state: 'RJ',
      zipCode: '24936-200',
      orderId: 'PED-1004',
      fullAddress: 'Rua Van Lerbergue, 310, Qd 115, Lt 22, Itaipuaçu, Maricá, RJ',
      hasQuadraLote: true,
      coordinates: { lat: -22.9515, lng: -42.9050 },
      geocoded: true,
    },
    {
      originalRow: 5,
      recipient: 'Fernando Henrique Rocha',
      phone: '(21) 96543-2109',
      street: 'Rua das Camélias',
      number: '45',
      quadra: '63',
      lote: '09',
      complement: '',
      neighborhood: 'Barroco',
      city: 'Maricá',
      state: 'RJ',
      zipCode: '24936-500',
      orderId: 'PED-1005',
      fullAddress: 'Rua das Camélias, 45, Qd 63, Lt 09, Barroco, Maricá, RJ',
      hasQuadraLote: true,
      coordinates: { lat: -22.9420, lng: -42.9110 },
      geocoded: true,
    },
    {
      originalRow: 6,
      recipient: 'Patrícia Gomes Alencar',
      phone: '(21) 99881-2233',
      street: 'Rua Zita da Silva Soares (Rua 70)',
      number: '12',
      quadra: '230',
      lote: '01',
      complement: 'Condomínio Solar',
      neighborhood: 'Jardim Atlântico Oeste',
      city: 'Maricá',
      state: 'RJ',
      zipCode: '24938-000',
      orderId: 'PED-1006',
      fullAddress: 'Rua Zita da Silva Soares, 12, Qd 230, Lt 01, Itaipuaçu, Maricá, RJ',
      hasQuadraLote: true,
      coordinates: { lat: -22.9580, lng: -42.9350 },
      geocoded: true,
    }
  ];
}
