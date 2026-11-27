import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { APP } from '../../apps';
import { APP_SCENES } from '../../scenes/appScenes';
import { BrandBar } from './BrandBar';
import { revealCard, SWIPE_ITEM, swipeRow } from './swipeRow';
import { PictureFrame, sceneAspect } from './PictureFrame';

/**
 * The front page, laid out exactly as the steps are (the same grid, the picture in the same frame,
 * a card as tall as it): the room on the left, the headline and the way in on the right. With several
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
    <div className="app-scale min-h-screen bg-paper font-grotesk text-spruce">
      <BrandBar reserveProgress />
      {/* The steps' grid exactly: the picture in the same frame on the left, a card as tall as it on the right */}
      <main className="mx-auto grid max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-5 px-4 pb-28 pt-2 sm:px-8 lg:pb-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-10 lg:pt-4">
        <div className="self-start">
          {scene ? (
            <PictureFrame aspect={sceneAspect(scene.id)}>
              <img key={scene.id} src={scene.photo} alt={`${scene.title}: ${scene.tagline}`} className="block h-full w-full object-cover motion-safe:animate-[pop-in_260ms_ease-out]" />
              <span className="at-tl absolute max-w-[85%] truncate rounded-full bg-paper/95 px-2.5 py-1 text-[12px] font-medium sm:px-3.5 sm:py-1.5 sm:text-[12.5px] text-spruce shadow-[0_4px_14px_-6px_rgba(30,43,41,0.4)]">
                {scene.tagline}
              </span>
            </PictureFrame>
          ) : (
            <div className="grid aspect-[3/2] w-full place-items-center rounded-2xl bg-mist text-sm text-spruce-soft ring-1 ring-black/5">Preview coming soon</div>
          )}
        </div>

        <div className="xl:relative">
          {several && scene ? (
            <section
              className="lg:flex lg:flex-col lg:overflow-hidden lg:rounded-2xl lg:border lg:border-line lg:bg-white/70 xl:absolute xl:inset-0"
              aria-labelledby="hero-title"
            >
              <div className="pt-1 lg:flex-1 lg:overflow-y-auto lg:p-6">
                <h1 id="hero-title" className="font-serif text-[28px] leading-[1.1] text-spruce sm:text-[32px] lg:whitespace-nowrap lg:text-[28px]">
                  {APP.hero.title}
                </h1>
                <p className="mt-1.5 text-[15px] leading-relaxed text-spruce-soft">Pick the layout closest to yours. We measure properly on the visit.</p>
                <h2 className="mb-2.5 mt-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-spruce-soft">Choose your layout</h2>
                <div className={swipeRow(3)} role="radiogroup" aria-label="Layout">
                  {APP_SCENES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={s.id === scene.id}
                      data-testid={`layout-${s.id}`}
                      onClick={(e) => {
                        setSceneId(s.id);
                        revealCard(e.currentTarget);
                      }}
                      className={`${SWIPE_ITEM} rounded-xl border bg-white p-1.5 text-left transition ${
                        s.id === scene.id ? 'border-spruce shadow-[0_8px_20px_-14px_rgba(30,43,41,0.7)]' : 'border-line hover:border-spruce/40'
                      }`}
                    >
                      <img src={s.thumbnail} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />
                      <span className="mt-1.5 block truncate px-0.5 pb-0.5 text-[13px] font-semibold leading-snug lg:whitespace-normal lg:text-[12.5px]">{s.title}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Phones: fixed at the bottom, as Back / Next are on the steps */}
              <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur sm:px-8 lg:static lg:bg-paper/60 lg:px-6 lg:pb-5 lg:pt-4 lg:backdrop-blur-none">
                <StartButton to={start} label={APP.hero.cta} />
              </div>
            </section>
          ) : (
            <>
              <h1 className="font-serif text-[34px] leading-[1.06] tracking-[-0.01em] text-spruce sm:text-[44px] lg:text-[32px]">{APP.hero.title}</h1>
              <p className="mt-4 max-w-md text-[16px] leading-relaxed text-spruce-soft">{APP.hero.blurb}</p>
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
    className="flex items-center justify-center gap-2 rounded-full bg-[#e2c4a5] py-3 text-[15px] lg:py-4 font-semibold text-spruce shadow-[0_14px_28px_-18px_rgba(120,84,40,0.9)] transition hover:bg-[#d9b691] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass"
  >
    {label} <ArrowRight className="h-4 w-4" />
  </Link>
);
