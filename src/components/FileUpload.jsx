import { useState, useCallback, useRef } from 'react';
import { FileSpreadsheet, UploadCloud, Trash2, Check } from 'lucide-react';
import { parseSpreadsheet, detectColumns, extractAddresses, parseShopeeSpreadsheet, getSampleDeliveryData } from '../utils/spreadsheet';
import './FileUpload.css';

export default function FileUpload({
  onAddressesLoaded,
  onError,
  importedSpreadsheet = null,
  onRemoveSpreadsheet,
}) {
  const [dragActive, setDragActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileType, setFileType] = useState('auto');
  const [detectedColumns, setDetectedColumns] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [allRows, setAllRows] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef(null);

  const resetLocalFileState = useCallback(() => {
    setFileName('');
    setHeaders([]);
    setDetectedColumns(null);
    setAllRows([]);
    setShowPreview(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;

    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const hasValidExt = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

    if (!hasValidExt) {
      onError('Formato inválido. Por favor, envie uma planilha (.xlsx, .xls ou .csv)');
      return;
    }

    setFileName(file.name);
    setIsProcessing(true);
    setDetectedColumns(null);
    setShowPreview(false);

    try {
      if (fileType === 'shopee') {
        const addresses = await parseShopeeSpreadsheet(file);
        if (!addresses || addresses.length === 0) {
          throw new Error('Nenhum endereço com CEP ou logradouro foi encontrado na planilha Shopee.');
        }
        onAddressesLoaded(addresses, 'shopee', file.name);
      } else {
        const rows = await parseSpreadsheet(file);
        if (!rows || rows.length < 2) {
          throw new Error('A planilha está vazia ou não contém dados suficientes.');
        }

        const headerRow = rows[0] || [];
        const columns = detectColumns(headerRow);
        setHeaders(headerRow);
        setDetectedColumns(columns);
        setAllRows(rows);
        setShowPreview(true);
      }
    } catch (error) {
      onError(error.message || 'Erro ao processar planilha');
    } finally {
      setIsProcessing(false);
    }
  }, [fileType, onAddressesLoaded, onError]);

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, [handleFile]);

  const handleFileSelect = useCallback((e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  }, [handleFile]);

  const handleColumnChange = (field, colIndex) => {
    setDetectedColumns(prev => ({
      ...prev,
      [field]: colIndex === '' ? null : parseInt(colIndex, 10),
    }));
  };

  const confirmColumns = useCallback(() => {
    if (detectedColumns && allRows.length > 0) {
      const addresses = extractAddresses(allRows, detectedColumns);
      if (addresses.length === 0) {
        onError('Nenhum endereço pôde ser extraído com o mapeamento atual.');
        return;
      }
      onAddressesLoaded(addresses, fileType, fileName);
      setShowPreview(false);
    }
  }, [detectedColumns, allRows, fileType, fileName, onAddressesLoaded, onError]);

  const handleLoadDemo = () => {
    const demoData = getSampleDeliveryData();
    onAddressesLoaded(demoData, 'demo', 'Exemplo (Itaipuaçu)');
  };

  const handleRemoveImported = useCallback(() => {
    resetLocalFileState();
    if (onRemoveSpreadsheet) {
      onRemoveSpreadsheet();
    }
  }, [resetLocalFileState, onRemoveSpreadsheet]);

  const fieldLabels = {
    street: 'Rua / Logradouro',
    number: 'Número',
    neighborhood: 'Bairro',
    city: 'Cidade',
    state: 'Estado (UF)',
    zipCode: 'CEP',
    quadra: 'Quadra',
    lote: 'Lote',
    complement: 'Complemento',
    recipient: 'Destinatário / Cliente',
    phone: 'Telefone',
    orderId: 'Nº do Pedido',
  };

  return (
    <div className={`file-upload-card ${dragActive ? 'drag-active' : ''} ${isProcessing ? 'is-loading' : ''}`}>
      <div className="upload-header">
        <div className="upload-title-row">
          <div className="upload-icon-badge">
            <FileSpreadsheet size={22} />
          </div>
          <div>
            <h3>Importar Planilha de Entregas</h3>
            <p className="upload-subtitle">XLSX, XLS ou CSV de rotas e encomendas</p>
          </div>
        </div>
      </div>

      {importedSpreadsheet && (
        <div className="imported-spreadsheet-banner">
          <div className="imported-file-meta">
            <span className="imported-file-icon">📄</span>
            <div className="imported-file-texts">
              <span className="imported-file-label">Planilha importada ativa</span>
              <strong className="imported-file-name" title={importedSpreadsheet.name}>
                {importedSpreadsheet.name} ({importedSpreadsheet.count}{' '}
                {importedSpreadsheet.count === 1 ? 'parada' : 'paradas'})
              </strong>
            </div>
          </div>
          <button
            type="button"
            className="btn-remove-spreadsheet"
            onClick={handleRemoveImported}
            disabled={isProcessing}
            title="Remover planilha importada e limpar paradas do mapa"
          >
            <Trash2 size={14} />
            <span>Remover Planilha</span>
          </button>
        </div>
      )}

      <div className="file-type-chips">
        <label className={`chip-option ${fileType === 'auto' ? 'active' : ''}`}>
          <input
            type="radio"
            name="fileType"
            value="auto"
            checked={fileType === 'auto'}
            onChange={(e) => setFileType(e.target.value)}
            disabled={isProcessing}
          />
          <span>Detecção Automática</span>
        </label>
        <label className={`chip-option ${fileType === 'shopee' ? 'active' : ''}`}>
          <input
            type="radio"
            name="fileType"
            value="shopee"
            checked={fileType === 'shopee'}
            onChange={(e) => setFileType(e.target.value)}
            disabled={isProcessing}
          />
          <span>Planilha Shopee</span>
        </label>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        id="file-input"
        accept=".xlsx,.xls,.csv"
        onChange={handleFileSelect}
        disabled={isProcessing}
        style={{ display: 'none' }}
      />

      <div
        className="upload-dropzone"
        onClick={() => !isProcessing && fileInputRef.current?.click()}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
      >
        <div className="dropzone-icon">
          <UploadCloud size={44} strokeWidth={1.5} />
        </div>
        <h4>Arraste o arquivo aqui ou clique para selecionar</h4>
        <p className="dropzone-hint">
          {fileName ? `Selecionado: ${fileName}` : 'Suporta arquivos do Excel (.xlsx, .xls) e CSV'}
        </p>
        {isProcessing && (
          <div className="dropzone-processing">
            <span className="spinner-blue"></span>
            <span>Processando arquivo e identificando colunas...</span>
          </div>
        )}
      </div>

      <div className="demo-route-bar">
        <span>Não tem uma planilha agora?</span>
        <button type="button" className="btn-demo-link" onClick={handleLoadDemo} disabled={isProcessing}>
          Carregar 6 entregas de exemplo (Itaipuaçu) 🚀
        </button>
      </div>

      {showPreview && detectedColumns && (
        <div className="column-preview-box">
          <div className="preview-header">
            <h4>Mapeamento de Colunas Detectadas</h4>
            <div className="preview-header-actions">
              <span className="row-counter-tag">{allRows.length - 1} linhas</span>
              <button
                type="button"
                className="btn-discard-preview"
                onClick={resetLocalFileState}
                disabled={isProcessing}
                title="Remover arquivo selecionado"
              >
                ✕ Remover
              </button>
            </div>
          </div>
          <p className="preview-help">
            Confirme as colunas da sua planilha antes de carregar no mapa:
          </p>

          <div className="columns-selector-grid">
            {Object.keys(fieldLabels).map((field) => (
              <div key={field} className="column-field-row">
                <label className="field-label">{fieldLabels[field]}</label>
                <select
                  value={detectedColumns[field] !== null && detectedColumns[field] !== undefined ? detectedColumns[field] : ''}
                  onChange={(e) => handleColumnChange(field, e.target.value)}
                  className="field-select"
                >
                  <option value="">-- Não mapeada --</option>
                  {headers.map((h, idx) => (
                    <option key={idx} value={idx}>
                      Col {idx + 1}: {String(h || `(Coluna ${idx + 1})`).slice(0, 30)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <button className="btn btn-confirm-process" onClick={confirmColumns} disabled={isProcessing}>
            <Check size={18} strokeWidth={2.5} />
            Confirmar e Processar Rota
          </button>
        </div>
      )}
    </div>
  );
}
