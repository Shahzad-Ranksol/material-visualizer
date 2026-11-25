import React from 'react';
import { APP_SCENES } from '../../scenes/appScenes';
import { BAKED } from '../../scenes/baked';

// The picture's frame on the front page and every step: the widest of the app's renders, so the
// picture keeps one size throughout (a narrower render, the Galley, sits centred in it with paper
// either side)
export const FRAME_ASPECT =
  Math.max(...APP_SCENES.map((s) => (BAKED[s.id] ? BAKED[s.id].width / BAKED[s.id].height : 0)), 0) || 3 / 2;

/** The scene's own shape, for the box inside the frame. */
export const sceneAspect = (sceneId: string | undefined): number => {
  const b = sceneId ? BAKED[sceneId] : undefined;
  return b ? b.width / b.height : FRAME_ASPECT;
};

/** The fixed frame, and inside it the picture's rounded box at the scene's own shape. */
export const PictureFrame: React.FC<{ aspect: number; children: React.ReactNode }> = ({ aspect, children }) => (
  <div data-testid="picture-frame" className="flex justify-center" style={{ aspectRatio: FRAME_ASPECT }}>
    <div
      className="relative h-full max-w-full overflow-hidden rounded-2xl bg-mist shadow-[0_24px_50px_-32px_rgba(30,43,41,0.55)] ring-1 ring-black/5"
      style={{ aspectRatio: aspect }}
    >
      {children}
    </div>
  </div>
);
