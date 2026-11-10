import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { APP } from '../../apps';
import { APP_SCENES } from '../../scenes/appScenes';
import { BrandBar } from './BrandBar';

/**
 * The front page: the room, what the configurator does, and one button. With no scene ready yet
 * (the bathroom before its render arrives), it says so instead.
 */
export const Intro: React.FC = () => {
  const scene = APP_SCENES[0];
  const ready = !!scene;
  return (
    <div className="min-h-screen bg-paper font-grotesk text-spruce">
      <BrandBar note="Takes a minute" />
      <main className="mx-auto grid max-w-[1280px] items-center gap-8 px-4 pb-12 pt-3 sm:px-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-14 lg:pt-10">
        <div className="relative overflow-hidden rounded-2xl bg-mist shadow-[0_30px_60px_-36px_rgba(30,43,41,0.6)] ring-1 ring-black/5">
          {ready ? (
            <img src={scene.photo} alt={`${scene.title}: ${scene.tagline}`} className="block aspect-[4/3] w-full object-cover" />
          ) : (
            <div className="grid aspect-[4/3] w-full place-items-center text-sm text-spruce-soft">Preview coming soon</div>
          )}
          {ready && (
            <span className="absolute left-3 top-3 rounded-full bg-paper/95 px-3 py-1 text-[12px] font-medium text-spruce shadow-[0_4px_14px_-6px_rgba(30,43,41,0.4)]">
              {scene.tagline}
            </span>
          )}
        </div>

        <div>
          <h1 className="font-serif text-[40px] leading-[1.02] tracking-[-0.01em] text-spruce sm:text-[56px]">{APP.hero.title}</h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-spruce-soft">{APP.hero.blurb}</p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {APP.hero.badges.map((b) => (
              <li key={b} className="rounded-full border border-line bg-white px-3 py-1 text-[12px] text-spruce-soft">
                {b}
              </li>
            ))}
          </ul>
          {ready ? (
            <Link
              to="/design"
              data-testid="start"
              className="mt-8 flex items-center justify-center gap-2 rounded-full bg-spruce py-4 text-[15px] font-semibold text-paper shadow-[0_16px_30px_-16px_rgba(30,43,41,0.8)] transition hover:bg-[#2a3a37] lg:max-w-sm"
            >
              {APP.hero.cta} <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <p className="mt-8 rounded-full border border-line bg-white py-4 text-center text-[15px] font-medium text-spruce-soft lg:max-w-sm">Coming soon</p>
          )}
          {ready && scene.source === 'unsplash' && <p className="mt-6 text-[11px] text-spruce-soft/80">Photo by {scene.credit.replace(/ \(.*\)$/, '')} on Unsplash</p>}
        </div>
      </main>
    </div>
  );
};
