import React from 'react';
import { Link } from 'react-router-dom';
import { SCENES } from '../scenes/scenes';
import { STUDIO_MATERIALS } from '../scenes/materials';
import { Ambient } from './studio/Ambient';

/** Front door: the five scenes, each opening the studio on that scene. */
export const LandingPage: React.FC = () => {
  const [first, ...rest] = SCENES;
  const finishes = (id: string) => STUDIO_MATERIALS.filter((m) => m.collection === id).length;
  return (
    <div className="relative min-h-screen font-grotesk text-[#f4efe6]">
      <Ambient src={first.photo} />
      <header className="mx-auto flex max-w-[1440px] items-center justify-between px-4 pt-6 sm:px-8">
        <span className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#e6c88f] to-[#a9824a] text-xs font-black text-[#1c1915]">F</span>
          Finish Studio
        </span>
        <Link to="/studio" className="rounded-full bg-gradient-to-b from-[#e6c88f] to-[#c49a5c] px-5 py-2 text-sm font-semibold text-[#1c1915] shadow-[0_8px_24px_-8px_rgba(217,183,122,0.7)] hover:brightness-105">
          Open the studio
        </Link>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 pb-16 sm:px-8">
        <h1 className="mt-12 max-w-4xl text-5xl font-semibold leading-[0.95] tracking-[-0.04em] sm:text-7xl lg:text-8xl">Try the finish before it's fitted.</h1>
        <p className="mt-6 max-w-xl text-lg text-[#a39e94]">
          Pick a scene, click the cabinets, worktop or fence, and see real veneers, lacquers, stone and timber on them in seconds.
        </p>

        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          <SceneTile scene={first} finishes={finishes(first.id)} large />
          <div className="grid gap-4 sm:grid-cols-2">
            {rest.map((s) => (
              <SceneTile key={s.id} scene={s} finishes={finishes(s.id)} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

const SceneTile: React.FC<{ scene: (typeof SCENES)[number]; finishes: number; large?: boolean }> = ({ scene, finishes, large }) => (
  <Link
    to={`/studio?scene=${scene.id}`}
    className={`group relative block overflow-hidden rounded-[22px] bg-black/30 shadow-[0_30px_70px_-25px_rgba(0,0,0,0.9)] ring-1 ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d9b77a] ${large ? 'aspect-[4/3] lg:aspect-auto lg:h-full' : 'aspect-[4/3]'}`}
  >
    <img src={large ? scene.photo : scene.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-5 pt-16 text-white">
      <span className={`block font-semibold tracking-tight ${large ? 'text-4xl' : 'text-2xl'}`}>{scene.title}</span>
      <span className="mt-1 block text-sm text-white/80">
        {scene.items.length} items to re-finish, {finishes} finishes
      </span>
    </div>
  </Link>
);
