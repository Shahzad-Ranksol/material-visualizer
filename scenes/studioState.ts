import { SceneCategory } from './types';

// The studio's whole state: which scene, which items are selected, and the finish chosen for
// each item. Pure, unit-tested; the studio renders every assigned item as one layer.

export interface StudioState {
  sceneId: SceneCategory;
  selected: string[];
  assignments: Record<string, string>;
  // Design style per style group (absent = the original design)
  styles: Record<string, string>;
}

export type StudioAction =
  | { type: 'scene'; sceneId: SceneCategory }
  // Plain click: select just this item; additive (Shift / multi-select): toggle it in the set
  | { type: 'select'; itemId: string; additive: boolean }
  | { type: 'selectAll'; itemIds: string[] }
  | { type: 'clearSelection' }
  | { type: 'apply'; materialId: string }
  | { type: 'remove'; itemId: string }
  // A design style for a group; its items keep their finishes
  | { type: 'style'; groupId: string; optionId: string }
  | { type: 'reset' };

export const initialStudioState = (sceneId: SceneCategory, assignments: Record<string, string> = {}, styles: Record<string, string> = {}): StudioState => ({
  sceneId,
  selected: [],
  assignments,
  styles,
});

export const studioReducer = (state: StudioState, action: StudioAction): StudioState => {
  switch (action.type) {
    case 'scene':
      return action.sceneId === state.sceneId ? state : initialStudioState(action.sceneId);
    case 'select': {
      if (!action.additive) return { ...state, selected: state.selected.length === 1 && state.selected[0] === action.itemId ? [] : [action.itemId] };
      const has = state.selected.includes(action.itemId);
      return { ...state, selected: has ? state.selected.filter((id) => id !== action.itemId) : [...state.selected, action.itemId] };
    }
    case 'selectAll':
      return { ...state, selected: action.itemIds };
    case 'clearSelection':
      return { ...state, selected: [] };
    case 'apply': {
      if (!state.selected.length) return state;
      const assignments = { ...state.assignments };
      for (const id of state.selected) assignments[id] = action.materialId;
      return { ...state, assignments };
    }
    case 'remove': {
      const { [action.itemId]: _, ...assignments } = state.assignments;
      return { ...state, assignments };
    }
    case 'style': {
      const { [action.groupId]: _, ...rest } = state.styles;
      return { ...state, styles: action.optionId === 'original' ? rest : { ...rest, [action.groupId]: action.optionId } };
    }
    case 'reset':
      return initialStudioState(state.sceneId);
  }
};

const pairs = (r: Record<string, string>) =>
  Object.keys(r)
    .sort()
    .map((k) => `${k}:${r[k]}`)
    .join(',');

/** A stable key for one look (scene + styles + every item's finish), for the render cache. */
export const lookKey = (state: Pick<StudioState, 'sceneId' | 'assignments'> & { styles?: Record<string, string> }): string =>
  `${state.sceneId}|${pairs(state.styles ?? {})}|${pairs(state.assignments)}`;

/** The look as URL query params (?scene=kitchen&look=island:kit-navy-lacquer,worktop:kit-bianco-quartz). */
export const encodeLook = (state: Pick<StudioState, 'sceneId' | 'assignments'> & { styles?: Record<string, string> }): string => {
  const params = new URLSearchParams({ scene: state.sceneId });
  const styles = Object.entries(state.styles ?? {})
    .map(([group, option]) => `${group}:${option}`)
    .join(',');
  if (styles) params.set('styles', styles);
  const look = Object.entries(state.assignments)
    .map(([item, material]) => `${item}:${material}`)
    .join(',');
  if (look) params.set('look', look);
  return params.toString();
};

/** Reads a shared look back, keeping only scenes, items and materials that still exist. */
export const decodeLook = (
  search: string,
  isScene: (id: string) => boolean,
  isItem: (sceneId: string, itemId: string) => boolean,
  isMaterial: (id: string) => boolean,
  isStyle: (sceneId: string, groupId: string, optionId: string) => boolean = () => false
): { sceneId: SceneCategory; assignments: Record<string, string>; styles: Record<string, string> } | null => {
  const params = new URLSearchParams(search);
  const sceneId = params.get('scene');
  if (!sceneId || !isScene(sceneId)) return null;
  const assignments: Record<string, string> = {};
  for (const pair of (params.get('look') ?? '').split(',')) {
    const [item, material] = pair.split(':');
    if (item && material && isItem(sceneId, item) && isMaterial(material)) assignments[item] = material;
  }
  const styles: Record<string, string> = {};
  for (const pair of (params.get('styles') ?? '').split(',')) {
    const [group, option] = pair.split(':');
    if (group && option && isStyle(sceneId, group, option)) styles[group] = option;
  }
  return { sceneId: sceneId as SceneCategory, assignments, styles };
};
