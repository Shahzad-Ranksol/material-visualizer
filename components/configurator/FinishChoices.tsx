import React from 'react';
import { Check } from 'lucide-react';
import { StudioMaterial } from '../../scenes/types';

interface Props {
  materials: StudioMaterial[];
  activeId: string | null;
  onPick: (materialId: string | null) => void;
}

// Swatches are grouped by what they are, when a step offers more than one kind
const KINDS: Array<{ label: string; has: (m: StudioMaterial) => boolean }> = [
  { label: 'Paints', has: (m) => m.category === 'paint' },
  { label: 'Woods', has: (m) => m.category === 'wood' },
  { label: 'Stone & tiles', has: (m) => m.category !== 'paint' && m.category !== 'wood' },
];

/** A step's finishes as swatches, grouped Paints / Woods / Stone; the chosen one again takes it off. */
export const FinishChoices: React.FC<Props> = (props) => {
  const groups = KINDS.map((k) => ({ label: k.label, materials: props.materials.filter(k.has) })).filter((g) => g.materials.length);
  if (groups.length < 2) return <Swatches {...props} />;
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.label}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-spruce-soft">{g.label}</h3>
          <Swatches {...props} materials={g.materials} />
        </div>
      ))}
    </div>
  );
};

const Swatches: React.FC<Props> = ({ materials, activeId, onPick }) => (
  <div className="grid grid-cols-4 gap-x-2.5 gap-y-3 sm:grid-cols-4">
    {materials.map((m) => {
      const active = m.id === activeId;
      return (
        <button
          key={m.id}
          type="button"
          data-testid="finish-chip"
          data-material={m.id}
          aria-pressed={active}
          title={`${m.name}, ${m.finishType}`}
          onClick={() => onPick(active ? null : m.id)}
          className="group text-left focus:outline-none"
        >
          <span
            className={`relative block aspect-square overflow-hidden rounded-xl bg-cover bg-center transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_10px_20px_-10px_rgba(30,43,41,0.55)] group-focus-visible:ring-2 group-focus-visible:ring-spruce ${
              active ? 'ring-2 ring-spruce ring-offset-2 ring-offset-paper' : 'ring-1 ring-black/10'
            }`}
            style={{ backgroundImage: `url(${m.thumbnail})` }}
          >
            <span className="absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-black/10" />
            {active && (
              <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-spruce text-paper">
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
            )}
          </span>
          <span className="mt-1.5 block text-[11.5px] font-semibold leading-tight text-spruce">{m.name.replace(/ (Lacquer|Veneer)$/, '')}</span>
          <span className="block text-[10.5px] leading-snug text-spruce-soft">{m.finishType}</span>
        </button>
      );
    })}
  </div>
);
