import { useState, useCallback, useRef } from 'react';
import { extractTextFromPDF, extractAnnotationsFromPDF, renderPageToCanvas } from '../utils/pdfExtract';
import './PDFQuadraOverlay.css';

export default function PDFQuadraOverlay({ 
  onQuadrasLoaded, 
  georefMode = false, 
  onPdfClick, 
  georefPoints = { pdf: [] } 
}) {
  const [pdfFile, setPdfFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [quadras, setQuadras] = useState([]);
  const [canvasImage, setCanvasImage] = useState(null);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const imgRef = useRef(null);

  const handleFileSelect = useCallback((e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
        setPdfFile(file);
        setError(null);
      } else {
        setError('Por favor, selecione um arquivo no formato PDF.');
      }
    }
  }, []);

  const handleImageClick = useCallback((e) => {
    if (!onPdfClick || !imgRef.current) return;
    
    const rect = imgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    onPdfClick({ x, y });
  }, [onPdfClick]);

  const processPDF = useCallback(async () => {
    if (!pdfFile) return;
    
    setIsProcessing(true);
    setError(null);
    
    try {
      const [textResult] = await Promise.all([
        extractTextFromPDF(pdfFile),
        extractAnnotationsFromPDF(pdfFile).catch(() => []),
      ]);
      
      const canvas = await renderPageToCanvas(pdfFile, 1, 2.5);
      const dataUrl = canvas.toDataURL('image/png');
      setCanvasImage(dataUrl);
      
      const foundQuadras = [];
      
      textResult.forEach(page => {
        page.items.forEach(item => {
          const text = item.text.trim();
          const match = text.match(/^(\d{1,3})$/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num >= 1 && num <= 999) {
              foundQuadras.push({
                number: num,
                page: page.page,
                x: item.x,
                y: item.y,
                text: item.text,
              });
            }
          }
        });
      });
      
      const uniqueQuadras = foundQuadras.filter((q, i, arr) => 
        arr.findIndex(other => other.number === q.number) === i
      ).sort((a, b) => a.number - b.number);
      
      setQuadras(uniqueQuadras);
      
      if (onQuadrasLoaded) {
        onQuadrasLoaded(uniqueQuadras, dataUrl);
      }
      
    } catch (err) {
      setError('Erro ao processar PDF: ' + (err.message || 'Falha ao ler páginas'));
    } finally {
      setIsProcessing(false);
    }
  }, [pdfFile, onQuadrasLoaded]);

  const filteredQuadras = quadras.filter(q => 
    searchTerm ? String(q.number).includes(searchTerm.trim()) : true
  );

  return (
    <div className="pdf-overlay-card">
      <div className="pdf-card-header">
        <div className="pdf-icon-badge">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <circle cx="10" cy="13" r="2" />
            <path d="m20 17-1.09-1.09a2 2 0 0 0-2.82 0L10 22" />
          </svg>
        </div>
        <div>
          <h3>Mapa PDF de Quadras</h3>
          <p className="pdf-subtitle">Carregue o mapa de loteamento para posicionar quadras</p>
        </div>
      </div>

      <div className="pdf-upload-box">
        <input
          type="file"
          id="pdf-input"
          accept=".pdf"
          onChange={handleFileSelect}
          disabled={isProcessing}
          style={{ display: 'none' }}
        />
        
        <label htmlFor="pdf-input" className="btn-select-pdf">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>{pdfFile ? pdfFile.name : 'Selecionar Arquivo PDF'}</span>
        </label>
        
        {pdfFile && !isProcessing && (
          <button type="button" className="btn-process-pdf" onClick={processPDF}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Processar e Extrair Quadras
          </button>
        )}
        
        {isProcessing && (
          <div className="pdf-processing-status">
            <span className="spinner-blue"></span>
            <span>Extraindo texto e renderizando mapa...</span>
          </div>
        )}
      </div>

      {error && <div className="pdf-error-banner">{error}</div>}

      {canvasImage && (
        <div className="pdf-preview-container">
          <div className="preview-top-bar">
            <h4>Imagem do Mapa PDF</h4>
            {georefMode && georefPoints.pdf.length < 2 && (
              <span className="georef-step-tag">
                Clique no ponto #{georefPoints.pdf.length + 1} de referência
              </span>
            )}
          </div>

          <div 
            className="canvas-viewport" 
            onClick={georefMode && georefPoints.pdf.length < 2 ? handleImageClick : undefined}
          >
            <img 
              ref={imgRef}
              src={canvasImage} 
              alt="Visualização do Mapa PDF" 
              className={`pdf-canvas-img ${georefMode && georefPoints.pdf.length < 2 ? 'is-clickable' : ''}`}
            />
            {georefPoints.pdf.map((point, index) => (
              <div 
                key={`ref-pt-${index}`} 
                className="pdf-ref-marker"
                style={{ left: `${point.x}px`, top: `${point.y}px` }}
              >
                <span>{index + 1}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {quadras.length > 0 && (
        <div className="quadras-list-box">
          <div className="quadras-header">
            <h4>Quadras Detectadas ({quadras.length})</h4>
            <input
              type="text"
              placeholder="Filtrar quadra..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="quadra-search-input"
            />
          </div>

          <div className="quadras-chips-grid">
            {filteredQuadras.slice(0, 80).map(q => (
              <span key={`q-${q.number}`} className="quadra-chip-badge">
                Qd {q.number}
              </span>
            ))}
            {filteredQuadras.length > 80 && (
              <span className="quadra-chip-more">
                +{filteredQuadras.length - 80} outras
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
