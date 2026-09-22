import React, { useRef, useState, useEffect } from 'react';

export interface HotspotViewModel {
  id: string;
  label: string;
  xPct: number;
  yPct: number;
}

interface HotspotImageProps {
  imageUrl: string;
  hotspots: HotspotViewModel[];
  onImageClick?: (xPct: number, yPct: number) => void;
  onHotspotDragEnd?: (hotspotId: string, xPct: number, yPct: number) => void;
  renderPin: (hotspot: HotspotViewModel) => React.ReactNode;
}

const DRAG_THRESHOLD_PX = 6;

// Both the vendor editor and the public storefront render the base image at
// w-full h-auto (never object-cover-cropped) so xPct/yPct — measured against
// the <img>'s own rendered box — mean the same point regardless of viewport size.
export const HotspotImage: React.FC<HotspotImageProps> = ({
  imageUrl,
  hotspots,
  onImageClick,
  onHotspotDragEnd,
  renderPin,
}) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ hotspotId: string; startX: number; startY: number; xPct: number; yPct: number; moved: boolean } | null>(null);
  const justDraggedRef = useRef<string | null>(null);
  const [dragPositions, setDragPositions] = useState<Record<string, { xPct: number; yPct: number }>>({});

  const handleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!onImageClick || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const xPct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const yPct = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    onImageClick(xPct, yPct);
  };

  const handlePinMouseDown = (hotspotId: string, current: { xPct: number; yPct: number }) => (e: React.MouseEvent) => {
    if (!onHotspotDragEnd) return;
    dragRef.current = { hotspotId, startX: e.clientX, startY: e.clientY, xPct: current.xPct, yPct: current.yPct, moved: false };
  };

  // Once the committed position (from props) catches up to what we dragged to, drop the local override.
  useEffect(() => {
    setDragPositions((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const h of hotspots) {
        const override = next[h.id];
        if (override && Math.abs(override.xPct - h.xPct) < 0.5 && Math.abs(override.yPct - h.yPct) < 0.5) {
          delete next[h.id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [hotspots]);

  useEffect(() => {
    if (!onHotspotDragEnd) return;

    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || !imgRef.current) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;

      const rect = imgRef.current.getBoundingClientRect();
      const xPct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const yPct = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      drag.xPct = xPct;
      drag.yPct = yPct;
      setDragPositions((prev) => ({ ...prev, [drag.hotspotId]: { xPct, yPct } }));
    };

    const handleMouseUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      if (drag.moved) {
        justDraggedRef.current = drag.hotspotId;
        onHotspotDragEnd(drag.hotspotId, drag.xPct, drag.yPct);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onHotspotDragEnd]);

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-white/[0.08] bg-[#0b0c10]">
      <img
        ref={imgRef}
        src={imageUrl}
        alt="Showcase room"
        className={`w-full h-auto block select-none ${onImageClick ? 'cursor-crosshair' : ''}`}
        onClick={handleClick}
      />
      {hotspots.map((hotspot) => {
        const pos = dragPositions[hotspot.id] || hotspot;
        return (
          <div
            key={hotspot.id}
            className={`absolute -translate-x-1/2 -translate-y-1/2 ${onHotspotDragEnd ? 'cursor-grab active:cursor-grabbing' : ''}`}
            style={{ left: `${pos.xPct}%`, top: `${pos.yPct}%` }}
            onMouseDown={handlePinMouseDown(hotspot.id, pos)}
            onClickCapture={(e) => {
              if (justDraggedRef.current === hotspot.id) {
                e.stopPropagation();
                justDraggedRef.current = null;
              }
            }}
          >
            {renderPin(hotspot)}
          </div>
        );
      })}
    </div>
  );
};
