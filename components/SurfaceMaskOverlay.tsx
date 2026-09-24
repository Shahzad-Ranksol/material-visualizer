import React, { useEffect, useRef } from 'react';

interface SurfaceMaskOverlayProps {
  // Alpha mask at the photo's full resolution (white, alpha = coverage)
  mask: HTMLCanvasElement;
}

const TINT = 'rgb(251, 191, 36)';

// Amber preview of a surface mask, laid exactly over the photo (the photo renders at
// w-full h-auto, so the overlay's inset-0 box matches it). Editing happens in AreaEditor.
export const SurfaceMaskOverlay: React.FC<SurfaceMaskOverlayProps> = ({ mask }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = mask.width;
    canvas.height = mask.height;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = TINT;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
  }, [mask]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-50 pointer-events-none" />;
};
