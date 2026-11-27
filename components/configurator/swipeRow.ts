// Choices as a row to swipe through sideways on phones and tablets (snapping, about two and a half
// cards in view so the cut one says there are more; the page itself scrolls down as usual), and as
// a grid on wide screens: the front page's layouts, the layout step, a step's designs
export const swipeRow = (wideCols: 2 | 3) =>
  `-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-8 sm:scroll-px-8 sm:px-8 lg:mx-0 lg:grid ${wideCols === 3 ? 'lg:grid-cols-3 lg:gap-2' : 'lg:grid-cols-2'} lg:overflow-visible lg:px-0 lg:pb-0`;

export const SWIPE_ITEM = 'flex w-[44%] shrink-0 snap-start flex-col sm:w-[30%] lg:w-auto';

/** A picked card scrolls fully into view in its row. */
export const revealCard = (el: HTMLElement) => el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
