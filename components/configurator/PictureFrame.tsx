import React from 'react';
import { APP_SCENES } from '../../scenes/appScenes';
import { BAKED } from '../../scenes/baked';

// The picture's frame on the front page and every step, so the picture keeps one size throughout.
// Phones: the shape of the widest of the app's renders (a narrower one, the Galley, sits centred in
// it with paper either side). Wide screens: as tall as the screen leaves room for, the render
// covering it. The sizing is CSS (`.picture-frame` in index.html)
export const FRAME_ASPECT =
  Math.max(...APP_SCENES.map((s) => (BAKED[s.id] ? BAKED[s.id].width / BAKED[s.id].height : 0)), 0) || 3 / 2;

/** The scene's own shape, for the box inside the frame. */
export const sceneAspect = (sceneId: string | undefined): number => {
  const b = sceneId ? BAKED[sceneId] : undefined;
  return b ? b.width / b.height : FRAME_ASPECT;
};

/**
 * The frame, and inside it the picture's box at the scene's own shape. Chips laid over the picture
 * use `.at-tl` / `.at-tr` / `.at-br` / `.at-b`, which keep them inside the part of the box that shows.
 */
export const PictureFrame: React.FC<{ aspect: number; children: React.ReactNode }> = ({ aspect, children }) => (
  <div className="picture-wrap">
    <div data-testid="picture-frame" className="picture-frame" style={{ '--frame-aspect': FRAME_ASPECT, '--scene-aspect': aspect } as React.CSSProperties}>
      <div className="picture-box overflow-hidden rounded-2xl bg-mist shadow-[0_24px_50px_-32px_rgba(30,43,41,0.55)] ring-1 ring-black/5 lg:rounded-none lg:shadow-none lg:ring-0">
        {children}
      </div>
    </div>
  </div>
);
