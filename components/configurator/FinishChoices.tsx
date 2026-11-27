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
  if (groups.length < 2) return (
    <>
      <Chosen {...props} />
      <Swatches {...props} />
    </>
  );
  return (
    <div className="space-y-4">
      <Chosen {...props} />
      {groups.map((g) => (
        <div key={g.label}>
          <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-spruce-soft">{g.label}</h3>
          <Swatches {...props} materials={g.materials} />
        </div>
      ))}
    </div>
  );
};

// Five swatches to a row on every screen. Below lg no names under them (a name can't fit a phone's
// tile), the chosen one named in one line above; in the lg card names on two lines' fixed height
// (so rows stay aligned)
const Chosen: React.FC<Props> = ({ materials, activeId }) => {
  const m = materials.find((x) => x.id === activeId);
  return (
    <p className="mb-3 flex h-5 items-baseline gap-1.5 text-[13px] lg:hidden" aria-live="polite">
      {m ? (
        <>
          <span className="font-semibold text-spruce">{m.name.replace(/ (Lacquer|Veneer)$/, '')}</span>
          <span className="text-spruce-soft">{m.finishType}</span>
        </>
      ) : (
        <span className="text-spruce-soft">Tap a swatch to try it</span>
      )}
    </p>
  );
};

const Swatches: React.FC<Props> = ({ materials, activeId, onPick }) => (
  <div className="grid grid-cols-5 gap-2 sm:gap-3 lg:gap-x-2.5 lg:gap-y-3">
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
          aria-label={`${m.name.replace(/ (Lacquer|Veneer)$/, '')}, ${m.finishType}`}
          onClick={() => onPick(active ? null : m.id)}
          className="group min-w-0 text-left focus:outline-none"
        >
          <span
            className={`relative block aspect-square overflow-hidden rounded-lg bg-cover bg-center transition duration-200 sm:rounded-xl [@media(hover:hover)]:group-hover:-translate-y-0.5 [@media(hover:hover)]:group-hover:shadow-[0_10px_20px_-10px_rgba(30,43,41,0.55)] group-focus-visible:ring-2 group-focus-visible:ring-spruce ${
              active ? 'ring-2 ring-spruce ring-offset-1 ring-offset-paper lg:ring-offset-2' : 'ring-1 ring-black/10'
            }`}
            style={{ backgroundImage: `url(${m.thumbnail})` }}
          >
            <span className="absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-black/10" />
            {active && (
              <span className="absolute right-0.5 top-0.5 grid h-3.5 w-3.5 lg:right-1 lg:top-1 lg:h-4 lg:w-4 place-items-center rounded-full bg-spruce text-paper">
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
            )}
          </span>
          <span className="mt-1.5 hidden min-h-[30px] text-[12px] font-semibold leading-[15px] text-spruce lg:line-clamp-2">{m.name.replace(/ (Lacquer|Veneer)$/, '')}</span>
          <span className="mt-0.5 hidden truncate text-[12px] leading-snug text-spruce-soft lg:block">{m.finishType}</span>
        </button>
      );
    })}
  </div>
);
