import React, { useEffect, useState } from 'react';

/**
 * The page's backdrop: the current look itself, hugely blurred and dimmed, so the room's own
 * colours light the studio (and change with every finish). Crossfades between images.
 */
export const Ambient: React.FC<{ src: string }> = ({ src }) => {
  const [layers, setLayers] = useState<string[]>([src]);
  useEffect(() => {
    setLayers((l) => (l[l.length - 1] === src ? l : [...l.slice(-1), src]));
  }, [src]);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#14120f]">
      {layers.map((s, i) => (
        <img
          key={s}
          src={s}
          alt=""
          className={`absolute inset-0 h-full w-full scale-125 object-cover blur-[90px] saturate-150 motion-safe:transition-opacity motion-safe:duration-1000 ${
            i === layers.length - 1 ? 'opacity-45' : 'opacity-0'
          }`}
        />
      ))}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(20,18,15,0.25),rgba(20,18,15,0.88)_70%)]" />
    </div>
  );
};
