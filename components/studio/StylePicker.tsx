import React from 'react';
import { Sparkles } from 'lucide-react';
import { optionsFor, ORIGINAL, StyleGroup } from '../../scenes/styles';
import { styleBake } from '../../scenes/stylesBaked';
import { Scene, StyleBake } from '../../scenes/types';

interface Props {
  scene: Scene;
  group: StyleGroup;
  // The photo's size, to crop previews out of it
  width: number;
  height: number;
  activeId: string;
  onPick: (optionId: string) => void;
}

/** A group's ready styles: generated, and baked for every item of the group. */
export const readyStyles = (sceneId: string, group: StyleGroup) =>
  optionsFor(group.id)
    .map((option) => ({ option, bake: styleBake(sceneId, group.id, option.id) }))
    .filter((s): s is { option: (typeof s)['option']; bake: StyleBake } => !!s.bake && group.itemIds.every((id) => s.bake!.items[id]));

/**
 * Design styles for the selected items, as cards: each previews the item in that style, cropped
 * straight out of the scene (the style's patch layered over the photo at the same framing).
 */
export const StylePicker: React.FC<Props> = ({ scene, group, width, height, activeId, onPick }) => {
  const ready = readyStyles(scene.id, group);
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
        className="group w-28 shrink-0 text-left focus:outline-none"
      >
        <span
          className={`relative block overflow-hidden rounded-xl bg-no-repeat shadow-[0_10px_24px_-10px_rgba(0,0,0,0.8)] transition duration-200 group-hover:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-[#f4efe6] ${
            active ? 'ring-2 ring-[#d9b77a] ring-offset-2 ring-offset-[#1c1915]' : 'ring-1 ring-white/10'
          }`}
          style={{
            aspectRatio: `${Math.min(2, Math.max(0.75, frame.w / frame.h))}`,
            backgroundImage: patchLayer ? `url(${bake!.patch}), url(${scene.photo})` : `url(${scene.photo})`,
            backgroundSize: patchLayer ? `${patchLayer.size}, ${photoLayer.size}` : photoLayer.size,
            backgroundPosition: patchLayer ? `${patchLayer.pos}, ${photoLayer.pos}` : photoLayer.pos,
          }}
        >
          {bake && (
            <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold text-[#e6c88f] backdrop-blur-sm">
              <Sparkles className="h-2.5 w-2.5" /> AI design
            </span>
          )}
        </span>
        <span className={`mt-1.5 block text-[13px] font-semibold leading-snug ${active ? 'text-[#e6c88f]' : 'text-[#f4efe6]'}`}>{label}</span>
      </button>
    );
  };
  return (
    <div>
      <h3 className="text-sm font-semibold text-[#f4efe6]">{group.label}</h3>
      <div className="-mx-1 mt-3 flex gap-3 overflow-x-auto px-1 pb-2">
        {card(ORIGINAL, 'As designed', null)}
        {ready.map(({ option, bake }) => card(option.id, option.label, bake))}
      </div>
    </div>
  );
};
