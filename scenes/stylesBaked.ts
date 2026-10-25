import json from './styles.baked.json';
import { BakedItem, StyleBake, StyleBakes } from './types';
import { BAKED } from './baked';
import { groupOfItem, ORIGINAL, styleKey } from './styles';

// Written by /dev/styles (scripts/sceneBakeDevServer.ts); JSON can't carry the Vec3 tuples' type
export const STYLE_BAKED = json as unknown as StyleBakes;

export const styleBake = (sceneId: string, groupId: string, optionId: string): StyleBake | undefined =>
  optionId === ORIGINAL ? undefined : STYLE_BAKED[sceneId as keyof StyleBakes]?.[styleKey(groupId, optionId)];

/** An item's masks and planes under the chosen styles: the style's own bake, else the scene's. */
export const bakedItemFor = (sceneId: string, itemId: string, styles: Record<string, string>): BakedItem | undefined => {
  const group = groupOfItem(sceneId, itemId);
  const option = group && styles[group.id];
  const fromStyle = group && option ? styleBake(sceneId, group.id, option)?.items[itemId] : undefined;
  return fromStyle ?? BAKED[sceneId as keyof typeof BAKED]?.items[itemId];
};

/** Whether an item is shown in an AI-designed style (its finishes then recolour, keeping the design). */
export const isStyled = (sceneId: string, itemId: string, styles: Record<string, string>): boolean => {
  const group = groupOfItem(sceneId, itemId);
  const option = group && styles[group.id];
  return !!(group && option && styleBake(sceneId, group.id, option)?.items[itemId]);
};
