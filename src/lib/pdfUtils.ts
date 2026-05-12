import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';

import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PDFEstimates {
  numPages: number;
  estimates: Record<number, number>; // quality (10-90) -> estimated bytes
}

/**
 * Parses a File (PDF) and creates a size estimate for 10% to 90% qualities.
 */
export async function estimatePDFSize(file: File): Promise<PDFEstimates> {
  const arrayBuffer = await file.arrayBuffer();
  // Using legacy/standard pdf.js method with standard settings
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDocument = await loadingTask.promise;
  const numPages = pdfDocument.numPages;

  // We sample page 1 to estimate the average compressed size
  const page1 = await pdfDocument.getPage(1);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const estimates: Record<number, number> = {};
  
  // For each quality percentage, compute the Blob size then calculate approximation for entire PDF
  for (let q = 10; q <= 90; q += 10) {
    const qualityLevel = q / 100;
    // Lower quality also lowers resolution (scale). 
    // e.g. 10% = 0.8x scale, 90% = 1.6x scale -> significantly reduces file size.
    const currentScale = 0.7 + qualityLevel; 

    const viewport = page1.getViewport({ scale: currentScale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    // Render PDF page into canvas context
    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
    };
    await page1.render(renderContext).promise;

    const blobSize = await new Promise<number>((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob ? blob.size : 0),
        'image/jpeg',
        qualityLevel
      );
    });
    
    // Approximation: blobSize * pages + some overhead for jsPDF structure
    estimates[q] = (blobSize * numPages) + (numPages * 500) + 10240; 
  }

  return { numPages, estimates };
}

/**
 * Compresses the PDF to the designated quality (0.01 - 1.0)
 * Note: Converts PDF pages to JPEGs.
 */
export async function compressPDF(
  file: File, 
  quality: number, 
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDocument = await loadingTask.promise;
  const numPages = pdfDocument.numPages;

  let doc: jsPDF | null = null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  // Dynamic scale matches the estimation scale
  const currentScale = 0.7 + quality;

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDocument.getPage(i);
    // 72 user units = 1 inch
    const viewport = page.getViewport({ scale: currentScale });
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    await page.render({ canvasContext: ctx, viewport }).promise;

    const imgData = canvas.toDataURL('image/jpeg', quality);

    // Get the page physical dimensions for jsPDF (ignoring 'scale' applied to the canvas)
    // jsPDF uses points by default (pt), so applying the viewport width/height at scale=1
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const isLandscape = unscaledViewport.width > unscaledViewport.height;

    if (!doc) {
      // Initialize on first page with correct dimensions and orientation
      doc = new jsPDF({
        orientation: isLandscape ? 'landscape' : 'portrait',
        unit: 'pt',
        format: [unscaledViewport.width, unscaledViewport.height]
      });
    } else {
      doc.addPage([unscaledViewport.width, unscaledViewport.height], isLandscape ? 'landscape' : 'portrait');
    }

    // Set exactly to current page
    doc.setPage(i);
    doc.addImage(imgData, 'JPEG', 0, 0, unscaledViewport.width, unscaledViewport.height);

    if (onProgress) {
      onProgress(i / numPages);
    }
  }

  if (!doc) {
    throw new Error('Could not generate PDF');
  }

  return doc.output('blob');
}

/**
 * Downloads a list of compressed blobs as a ZIP file.
 */
export async function downloadAsZip(files: { name: string, blob: Blob }[], zipName: string = 'compressed_pdfs.zip') {
  const zip = new JSZip();
  files.forEach(f => {
    zip.file(f.name, f.blob);
  });
  
  const content = await zip.generateAsync({ type: 'blob' });
  triggerDownload(content, zipName);
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
