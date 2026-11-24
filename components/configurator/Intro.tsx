import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { APP } from '../../apps';
import { APP_SCENES } from '../../scenes/appScenes';
import { BrandBar } from './BrandBar';

/**
 * The front page: the room on the left, the headline and the way in on the right. With several
 * layouts (the kitchens) the customer picks one here, the photo following, and starts on it; with
 * one (fencing) a short blurb and the button. With no scene ready yet (the bathroom before its
 * render arrives) it says so instead.
 */
export const Intro: React.FC = () => {
  const [sceneId, setSceneId] = useState(APP_SCENES[0]?.id);
  const scene = APP_SCENES.find((s) => s.id === sceneId);
  const several = APP_SCENES.length > 1;
  // A chosen layout opens on the step after "Choose your layout"
  const start = scene ? (several ? `/design?scene=${scene.id}&step=1` : '/design') : '/';

  return (
    <div className="min-h-screen bg-paper font-grotesk text-spruce">
      <BrandBar />
      <main className="mx-auto grid max-w-[1280px] gap-5 px-4 pb-12 pt-2 sm:px-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-10 lg:gap-y-5 lg:pt-6">
        <h1 className="font-serif text-[34px] leading-[1.06] tracking-[-0.01em] text-spruce sm:text-[44px] lg:col-start-2 lg:row-start-1 lg:whitespace-nowrap lg:text-[30px] xl:text-[36px]">
          {APP.hero.title}
        </h1>

        <div className="relative overflow-hidden rounded-2xl bg-mist shadow-[0_30px_60px_-36px_rgba(30,43,41,0.6)] ring-1 ring-black/5 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:min-h-[560px]">
          {scene ? (
            <img key={scene.id} src={scene.photo} alt={`${scene.title}: ${scene.tagline}`} className="block aspect-[4/3] w-full object-cover motion-safe:animate-[pop-in_260ms_ease-out] lg:absolute lg:inset-0 lg:aspect-auto lg:h-full" />
          ) : (
            <div className="grid aspect-[4/3] w-full place-items-center text-sm text-spruce-soft">Preview coming soon</div>
          )}
          {scene && (
            <span className="absolute left-3 top-3 max-w-[85%] truncate rounded-full bg-paper/95 px-3.5 py-1.5 text-[12.5px] font-medium text-spruce shadow-[0_4px_14px_-6px_rgba(30,43,41,0.4)] sm:left-4 sm:top-4">
              {scene.tagline}
            </span>
          )}
        </div>

        <div className="lg:col-start-2 lg:row-start-2">
          {several && scene ? (
            <section className="overflow-hidden rounded-2xl border border-line bg-white/70" aria-labelledby="layout-title">
              <div className="p-5 sm:p-6">
                <h2 id="layout-title" className="font-serif text-[26px] leading-tight text-spruce sm:text-[30px]">
                  Choose your layout
                </h2>
                <p className="mt-1.5 text-[14px] leading-relaxed text-spruce-soft">Pick the one closest to yours. We measure properly on the visit.</p>
                <div className="mt-5 grid grid-cols-2 gap-3" role="radiogroup" aria-label="Layout">
                  {APP_SCENES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={s.id === scene.id}
                      data-testid={`layout-${s.id}`}
                      onClick={() => setSceneId(s.id)}
                      className={`rounded-xl border bg-white p-2 text-left transition ${
                        s.id === scene.id ? 'border-spruce shadow-[0_8px_20px_-14px_rgba(30,43,41,0.7)]' : 'border-line hover:border-spruce/40'
                      }`}
                    >
                      <img src={s.thumbnail} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />
                      <span className="mt-2 block px-1 pb-0.5 text-[14px] font-semibold leading-snug">{s.title}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="border-t border-line bg-paper/60 p-4 sm:px-6">
                <StartButton to={start} label={APP.hero.cta} />
              </div>
            </section>
          ) : (
            <>
              <p className="max-w-md text-[16px] leading-relaxed text-spruce-soft">{APP.hero.blurb}</p>
              <ul className="mt-5 flex flex-wrap gap-2">
                {APP.hero.badges.map((b) => (
                  <li key={b} className="rounded-full border border-line bg-white px-3 py-1 text-[13px] text-spruce-soft">
                    {b}
                  </li>
                ))}
              </ul>
              {scene ? (
                <div className="mt-8 lg:max-w-sm">
                  <StartButton to={start} label={APP.hero.cta} />
                </div>
              ) : (
                <p className="mt-8 rounded-full border border-line bg-white py-4 text-center text-[15px] font-medium text-spruce-soft lg:max-w-sm">Coming soon</p>
              )}
            </>
          )}
          {scene?.source === 'unsplash' && <p className="mt-6 text-[11px] text-spruce-soft/80">Photo by {scene.credit.replace(/ \(.*\)$/, '')} on Unsplash</p>}
        </div>
      </main>
    </div>
  );
};

const StartButton: React.FC<{ to: string; label: string }> = ({ to, label }) => (
  <Link
    to={to}
    data-testid="start"
    className="flex items-center justify-center gap-2 rounded-full bg-[#e2c4a5] py-4 text-[15px] font-semibold text-spruce shadow-[0_14px_28px_-18px_rgba(120,84,40,0.9)] transition hover:bg-[#d9b691] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass"
  >
    {label} <ArrowRight className="h-4 w-4" />
  </Link>
);
