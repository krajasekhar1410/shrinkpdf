/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';
import { UploadCloud, File as FileIcon, X, Download, Settings, Loader2, CheckCircle, Info, Archive } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatBytes, cn } from './lib/utils';
import { estimatePDFSize, compressPDF, downloadAsZip, triggerDownload } from './lib/pdfUtils';

interface FileItem {
  id: string;
  file: File;
  originalSize: number;
  estimates: Record<number, number> | null;
  numPages: number;
  selectedQuality: number; // 0.1 to 1.0
  status: 'idle' | 'estimating' | 'compressing' | 'done' | 'error';
  progress: number;
  compressedBlob: Blob | null;
  errorMessage?: string;
}

const PRESET_PERCENTAGES = [10, 20, 30, 40, 50, 60, 70, 80, 90];

export default function App() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isHovering, setIsHovering] = useState(false);
  const [globalProcessing, setGlobalProcessing] = useState(false);

  const processFileAddition = async (newFiles: File[]) => {
    const pdfFiles = newFiles.filter(f => f.type === 'application/pdf');
    if (pdfFiles.length === 0) return;

    const addedItems: FileItem[] = pdfFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      originalSize: file.size,
      estimates: null,
      numPages: 0,
      selectedQuality: 0.5, // Default 50%
      status: 'estimating',
      progress: 0,
      compressedBlob: null,
    }));

    setFiles(prev => [...prev, ...addedItems]);

    // Process estimates asynchronously
    for (const item of addedItems) {
      try {
        const { numPages, estimates } = await estimatePDFSize(item.file);
        setFiles(prev => prev.map(f => f.id === item.id ? { 
          ...f, 
          status: 'idle', 
          estimates, 
          numPages 
        } : f));
      } catch (err) {
        console.error('Failed to parse PDF', err);
        setFiles(prev => prev.map(f => f.id === item.id ? { 
          ...f, 
          status: 'error',
          errorMessage: 'Failed to read PDF. Ensure it is not corrupted.'
        } : f));
      }
    }
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsHovering(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFileAddition(Array.from(e.dataTransfer.files));
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsHovering(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsHovering(false);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFileAddition(Array.from(e.target.files));
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const updateQuality = (id: string, quality: number) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, selectedQuality: quality, status: 'idle', compressedBlob: null, progress: 0 } : f));
  };

  const handleCompressFile = async (id: string) => {
    const fileItem = files.find(f => f.id === id);
    if (!fileItem || fileItem.status === 'compressing') return;

    setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'compressing', progress: 0, compressedBlob: null } : f));

    try {
      const blob = await compressPDF(fileItem.file, fileItem.selectedQuality, (prog) => {
        setFiles(prev => prev.map(f => f.id === id ? { ...f, progress: Math.round(prog * 100) } : f));
      });
      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'done', progress: 100, compressedBlob: blob } : f));
    } catch (err) {
      console.error(err);
      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'error', errorMessage: 'Compression failed.' } : f));
    }
  };

  const downloadFile = (id: string) => {
    const fileItem = files.find(f => f.id === id);
    if (fileItem && fileItem.compressedBlob) {
      const newName = fileItem.file.name.replace('.pdf', `_compressed_${Math.round(fileItem.selectedQuality * 100)}.pdf`);
      triggerDownload(fileItem.compressedBlob, newName);
    }
  };

  const batchCompressAll = async () => {
    setGlobalProcessing(true);
    for (const f of files) {
      if (f.status === 'idle') {
        await handleCompressFile(f.id);
      }
    }
    setGlobalProcessing(false);
  };

  const downloadAllReady = async () => {
    const readyFiles = files.filter(f => f.status === 'done' && f.compressedBlob);
    if (readyFiles.length === 1) {
      downloadFile(readyFiles[0].id);
    } else if (readyFiles.length > 1) {
      const filesToZip = readyFiles.map(f => ({
        name: f.file.name.replace('.pdf', `_compressed_${Math.round(f.selectedQuality * 100)}.pdf`),
        blob: f.compressedBlob!
      }));
      await downloadAsZip(filesToZip, 'Compressed_PDFs.zip');
    }
  };

  const anyIdle = files.some(f => f.status === 'idle');
  const anyReady = files.some(f => f.status === 'done');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-6 md:py-8 flex flex-col md:flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-sm">
              <FileIcon className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-800">ShrinkPDF</h1>
              <p className="text-sm text-slate-500 font-medium tracking-tight">Client-side extreme PDF compression</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        
        {/* Helper Note */}
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mb-8 flex items-start gap-3">
          <Info className="w-5 h-5 text-indigo-500 mt-0.5 shrink-0" />
          <div className="text-sm text-indigo-900">
            <strong>How it works:</strong> This tool significantly reduces file size by fully rasterizing PDF pages into optimized JPEGs. It works entirely in your browser—files are never uploaded to a server.
            <br className="mb-1" />
            <span className="opacity-80">Note: Selectable text and vector graphics will be converted to images. Best suited for scanned documents.</span>
          </div>
        </div>

        {/* Dropzone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            "border-2 border-dashed rounded-2xl p-12 transition-all duration-200 flex flex-col items-center justify-center bg-white cursor-pointer group",
            isHovering ? "border-indigo-400 bg-indigo-50/50" : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50"
          )}
          onClick={() => document.getElementById('file-upload')?.click()}
        >
          <input
            id="file-upload"
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-indigo-100 transition-colors">
            <UploadCloud className="w-8 h-8 text-slate-400 group-hover:text-indigo-500 transition-colors" />
          </div>
          <h3 className="text-lg font-medium text-slate-700 mb-1">Click to upload or drag & drop</h3>
          <p className="text-sm text-slate-500">PDF files only. Add multiple files to batch compress.</p>
        </div>

        {/* Batch Actions */}
        {files.length > 0 && (
          <div className="mt-8 mb-4 flex items-center justify-between border-b border-slate-200 pb-4">
            <h2 className="text-lg font-medium text-slate-800">
              Files ({files.length})
            </h2>
            <div className="flex items-center gap-3">
              {anyIdle && (
                <button
                  onClick={batchCompressAll}
                  disabled={globalProcessing}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition flex items-center gap-2 disabled:opacity-50"
                >
                  {globalProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
                  Compress All
                </button>
              )}
              {anyReady && (
                <button
                  onClick={downloadAllReady}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition flex items-center gap-2"
                >
                  <Archive className="w-4 h-4" />
                  Download Complete
                </button>
              )}
            </div>
          </div>
        )}

        {/* File List */}
        <div className="space-y-4">
          <AnimatePresence>
            {files.map((file) => (
              <motion.div
                key={file.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden flex flex-col"
              >
                {/* Header row */}
                <div className="px-5 py-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center shrink-0">
                      <FileIcon className="w-5 h-5 text-slate-500" />
                    </div>
                    <div className="truncate pr-4 flex-1">
                      <h4 className="font-medium text-slate-800 truncate" title={file.file.name}>{file.file.name}</h4>
                      <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                        <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded mr-1">Original: {formatBytes(file.originalSize)}</span>
                        {file.numPages > 0 && <span>• {file.numPages} Page{file.numPages !== 1 && 's'}</span>}
                      </p>
                    </div>
                  </div>
                  
                  {/* Status / Output Actions */}
                  <div className="flex items-center gap-3 shrink-0">
                    {file.status === 'estimating' && (
                      <div className="text-sm text-slate-500 flex items-center gap-2 pr-4">
                        <Loader2 className="w-4 h-4 animate-spin text-indigo-500" /> Estimating size
                      </div>
                    )}
                    {file.status === 'error' && (
                      <div className="text-sm text-red-500 font-medium">{file.errorMessage}</div>
                    )}
                    {(file.status === 'compressing' || file.status === 'done') && (
                      <div className="min-w-[120px] max-w-[200px] w-full mr-2">
                        <div className="flex justify-between text-xs mb-1 font-medium">
                          {file.status === 'done' ? (
                            <span className="text-emerald-600 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Done</span>
                          ) : (
                            <span className="text-indigo-600">Compressing...</span>
                          )}
                          <span className="text-slate-500">{file.progress}%</span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={cn("h-full transition-all duration-300", file.status === 'done' ? "bg-emerald-500" : "bg-indigo-500")}
                            style={{ width: `${file.progress}%` }} 
                          />
                        </div>
                      </div>
                    )}
                    
                    {file.status === 'idle' && (
                      <button
                        onClick={() => handleCompressFile(file.id)}
                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-medium transition cursor-pointer"
                      >
                        Compress
                      </button>
                    )}

                    {file.status === 'done' && file.compressedBlob && (
                      <button
                        onClick={() => downloadFile(file.id)}
                        className="px-4 py-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-lg text-sm font-medium transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <Download className="w-4 h-4" /> Download
                      </button>
                    )}

                    <button 
                      onClick={() => removeFile(file.id)}
                      className="p-2 text-slate-400 hover:text-red-500 hover:bg-slate-50 rounded-lg transition cursor-pointer"
                      title="Remove file"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Configuration area */}
                {file.status === 'idle' && file.estimates && (
                  <div className="px-5 py-5 bg-slate-50/50">
                    <div className="mb-4">
                      <div className="flex justify-between mb-2">
                        <label className="text-sm font-medium text-slate-700">Preset Compression Options</label>
                        <span className="text-xs text-slate-500 font-medium">Click to select targets</span>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-2">
                        {PRESET_PERCENTAGES.map(pct => {
                          const qualVal = pct / 100;
                          const estBytes = file.estimates![pct];
                          const isActive = Math.abs(file.selectedQuality - qualVal) < 0.01;
                          
                          // Reduction calculation
                          const reductionPct = file.originalSize > estBytes 
                            ? Math.round((1 - (estBytes / file.originalSize)) * 100)
                            : 0;
                            
                          const isLarger = estBytes >= file.originalSize;

                          return (
                            <button
                              key={pct}
                              onClick={() => updateQuality(file.id, qualVal)}
                              className={cn(
                                "flex flex-col items-center justify-center p-2 rounded-lg border transition-all text-sm cursor-pointer",
                                isActive 
                                  ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500 shadow-sm" 
                                  : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50"
                              )}
                            >
                              <span className={cn("font-semibold mb-1", isActive ? "text-indigo-700" : "text-slate-700")}>{pct}%</span>
                              <span className={cn("text-[11px] font-mono", isLarger ? "text-amber-600" : "text-slate-500")}>
                                {formatBytes(estBytes, 1)}
                              </span>
                              {!isLarger && (
                                <span className={cn("text-[10px] mt-0.5 font-medium", isActive ? "text-emerald-600" : "text-emerald-500/70")}>
                                  -{reductionPct}%
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between mb-2">
                        <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                          Custom Quality Slider
                        </label>
                        <span className="text-sm font-mono font-medium text-indigo-600">
                          {Math.round(file.selectedQuality * 100)}%
                        </span>
                      </div>
                      <input 
                        type="range" 
                        min="1" 
                        max="100" 
                        value={Math.round(file.selectedQuality * 100)}
                        onChange={(e) => updateQuality(file.id, parseInt(e.target.value) / 100)}
                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      />
                      <div className="flex justify-between mt-1.5 text-[10px] uppercase font-bold tracking-wider text-slate-400">
                        <span>Max Compression (Lower Quality)</span>
                        <span>Max Quality (Larger File)</span>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Result Info Area */}
                {file.status === 'done' && file.compressedBlob && (
                  <div className="px-5 py-3 bg-emerald-50 border-t border-emerald-100 flex items-center flex-wrap gap-y-2 justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <div>
                        <span className="text-emerald-800 font-medium">Original:</span>
                        <span className="text-emerald-600 ml-1 font-mono">{formatBytes(file.originalSize)}</span>
                      </div>
                      <div className="text-emerald-300">|</div>
                      <div>
                        <span className="text-emerald-800 font-medium">Compressed:</span>
                        <span className="text-emerald-700 ml-1 font-mono font-bold bg-emerald-100/50 px-1 py-0.5 rounded">{formatBytes(file.compressedBlob.size)}</span>
                      </div>
                    </div>
                    {file.compressedBlob.size < file.originalSize && (
                      <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full text-xs font-bold leading-tight flex items-center gap-1">
                        Reduced by {Math.round((1 - (file.compressedBlob.size / file.originalSize)) * 100)}%
                      </span>
                    )}
                    {file.compressedBlob.size >= file.originalSize && (
                      <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full text-xs font-bold leading-tight flex items-center gap-1">
                        File slightly larger due to flattening
                      </span>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

      </main>
    </div>
  );
}

