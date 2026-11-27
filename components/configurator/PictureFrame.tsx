import React from 'react';
import { BAKED } from '../../scenes/baked';

/** The scene's own shape, for the box inside the frame. */
export const sceneAspect = (sceneId: string | undefined): number => {
  const b = sceneId ? BAKED[sceneId] : undefined;
  return b ? b.width / b.height : 3 / 2;
};

/**
 * The picture's frame on the front page and every step, so the picture keeps one size throughout:
 * portrait on phones and tablets (4:5, at most half the screen's height), on wide screens as tall as
 * the screen leaves room for. The render covers it, cut evenly off the sides (the sizing is CSS,
 * `.picture-frame` in index.html). Chips laid over the picture use `.at-tl` / `.at-tr` / `.at-br` /
 * `.at-b`, which keep them inside the part of the render that shows.
 */
export const PictureFrame: React.FC<{ aspect: number; children: React.ReactNode }> = ({ aspect, children }) => (
  <div className="picture-wrap">
    <div data-testid="picture-frame" className="picture-frame" style={{ '--scene-aspect': aspect } as React.CSSProperties}>
      <div className="picture-box bg-mist">{children}</div>
    </div>
  </div>
);
