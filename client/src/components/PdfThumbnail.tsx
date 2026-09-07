import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';

// Configure Mozilla PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface PdfThumbnailProps {
  fileId: string;
  token: string;
  fallbackUrl: string;
}

export const PdfThumbnail: React.FC<PdfThumbnailProps> = ({ fileId, token, fallbackUrl }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    const url = `/api/v1/files/${fileId}/stream?token=${encodeURIComponent(token)}`;

    const renderPdf = async () => {
      try {
        const loadingTask = pdfjs.getDocument(url);
        const pdf = await loadingTask.promise;
        if (!active) return;

        const page = await pdf.getPage(1);
        if (!active) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const unscaledViewport = page.getViewport({ scale: 1 });
        const targetWidth = 300;
        const scale = targetWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale });

        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport }).promise;
        if (active) setLoaded(true);
      } catch (err) {
        if (active) setError(true);
      }
    };

    renderPdf();

    return () => {
      active = false;
    };
  }, [fileId, token]);

  if (error) {
    return <img src={fallbackUrl} alt="PDF Thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          display: loaded ? 'block' : 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          borderRadius: '4px'
        }}
      />
      {!loaded && <img src={fallbackUrl} alt="PDF Thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
    </div>
  );
};
