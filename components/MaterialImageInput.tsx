import React, { useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';

const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.85;

// Downscale a photo to a JPEG before upload, so stored images stay small and fast to render.
const fileToResizedJpeg = (file: File): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Canvas not supported'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not process this image'))),
        'image/jpeg',
        JPEG_QUALITY
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read this image'));
    };
    img.src = objectUrl;
  });

interface MaterialImageInputProps {
  value: string;
  onChange: (value: string) => void;
  // Stores the file and resolves to its public URL
  onUpload: (file: Blob) => Promise<string>;
  inputClassName: string;
}

export const MaterialImageInput: React.FC<MaterialImageInputProps> = ({ value, onChange, onUpload, inputClassName }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    setError(null);
    setProcessing(true);
    try {
      onChange(await onUpload(await fileToResizedJpeg(file)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload this image');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {value ? (
          <div className="relative w-14 h-14 shrink-0 rounded-lg overflow-hidden border border-white/[0.1] bg-[#0d0e14]">
            <img src={value} alt="Material preview" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => onChange('')}
              title="Remove image"
              className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center text-slate-300 hover:text-white"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={processing}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-dashed border-white/[0.15] text-[11px] font-medium text-slate-300 disabled:opacity-60 transition-colors"
        >
          {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
          {value ? 'Replace image' : 'Upload image'}
        </button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} className="hidden" />
      </div>

      <input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="…or paste an image URL"
        className={inputClassName}
      />

      {error && <p className="text-[11px] text-rose-300">{error}</p>}
    </div>
  );
};
