import React from 'react';
import { ORIGINAL, StyleGroup } from '../../scenes/styles';
import { Scene, StyleBake } from '../../scenes/types';
import { Check } from 'lucide-react';
import { readyStyles } from './wizard';

interface Props {
  scene: Scene;
  group: StyleGroup;
  // The photo's size, to crop previews out of it
  width: number;
  height: number;
  activeId: string;
  onPick: (optionId: string) => void;
}

/**
 * A step's designs as large cards: each previews the area in that design, cropped straight out
 * of the scene (the design's patch layered over the photo at the same framing).
 */
export const StyleChoices: React.FC<Props> = ({ scene, group, width, height, activeId, onPick }) => {
  const ready = readyStyles(scene.id, group.id);
  if (!ready.length) return null;
  const frame = ready[0].bake.rect;
  // CSS background geometry that shows `frame` of the photo filling the card
  const photoLayer = {
    size: `${(width / frame.w) * 100}% ${(height / frame.h) * 100}%`,
    pos: `${frame.w < width ? (frame.x / (width - frame.w)) * 100 : 0}% ${frame.h < height ? (frame.y / (height - frame.h)) * 100 : 0}%`,
  };
  const card = (id: string, label: string, bake: StyleBake | null) => {
    const active = id === activeId;
    // The patch framed the same way as the photo (its own rect inside the shared frame)
    const patchLayer = bake && {
      size: `${(bake.rect.w / frame.w) * 100}% ${(bake.rect.h / frame.h) * 100}%`,
      pos: `${frame.w > bake.rect.w ? ((bake.rect.x - frame.x) / (frame.w - bake.rect.w)) * 100 : 0}% ${frame.h > bake.rect.h ? ((bake.rect.y - frame.y) / (frame.h - bake.rect.h)) * 100 : 0}%`,
    };
    return (
      <button
        key={id}
        type="button"
        data-testid="style-card"
        data-style={id}
        aria-pressed={active}
        onClick={() => onPick(id)}
        className={`group rounded-xl border bg-white p-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-spruce ${
          active ? 'border-spruce shadow-[0_10px_24px_-14px_rgba(30,43,41,0.6)]' : 'border-line hover:border-spruce/40'
        }`}
      >
        <span
          className="relative block overflow-hidden rounded-lg bg-no-repeat"
          style={{
            aspectRatio: `${Math.min(2, Math.max(1.1, frame.w / frame.h))}`,
            backgroundImage: patchLayer ? `url(${bake!.patch}), url(${scene.photo})` : `url(${scene.photo})`,
            backgroundSize: patchLayer ? `${patchLayer.size}, ${photoLayer.size}` : photoLayer.size,
            backgroundPosition: patchLayer ? `${patchLayer.pos}, ${photoLayer.pos}` : photoLayer.pos,
          }}
        >
          {active && (
            <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-spruce text-paper">
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="mt-2 block px-1 pb-0.5 text-[13px] font-semibold leading-snug text-spruce">{label}</span>
      </button>
    );
  };
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {card(ORIGINAL, 'As shown', null)}
      {ready.map(({ option, bake }) => card(option.id, option.label, bake))}
    </div>
  );
};
