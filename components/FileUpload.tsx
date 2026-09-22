import React, { useRef, useState } from 'react';
import { UploadCloud, Image as ImageIcon, X } from 'lucide-react';

interface FileUploadProps {
  onFileUpload: (file: File | null) => void;
  currentFileName?: string | null;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFileUpload, currentFileName }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [localFileName, setLocalFileName] = useState<string | null>(null);

  const displayFileName = currentFileName || localFileName;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLocalFileName(file.name);
      onFileUpload(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setLocalFileName(file.name);
      onFileUpload(file);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLocalFileName(null);
    onFileUpload(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="w-full">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/png,image/jpeg,image/webp,image/avif"
        className="hidden"
        id="room-file-input"
      />

      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            fileInputRef.current?.click();
          }
        }}
        className={`w-full flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed transition-all cursor-pointer text-center group ${
          isDragOver
            ? 'border-amber-400 bg-amber-500/10'
            : displayFileName
            ? 'border-emerald-500/40 bg-emerald-500/[0.04]'
            : 'border-white/[0.12] hover:border-amber-400/50 bg-[#12141c] hover:bg-[#151722]'
        }`}
      >
        {displayFileName ? (
          <div className="flex items-center justify-between w-full px-2">
            <div className="flex items-center gap-2 min-w-0 text-left">
              <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-xs font-medium text-slate-200 truncate">
                {displayFileName}
              </span>
            </div>
            <button
              type="button"
              onClick={handleClear}
              className="p-1 rounded-md text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
              title="Remove file"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-slate-400 group-hover:text-amber-300 transition-colors">
              <UploadCloud className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-300 group-hover:text-white transition-colors">
                Drop room photo or <span className="text-amber-400 underline">browse</span>
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Supports JPG, PNG, WEBP up to 15MB
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
