import type { AppConfig, DesignStep } from '../../apps/types';
import { materialById, materialsFor } from '../../scenes/materials';
import { optionsFor, ORIGINAL, STYLE_GROUPS } from '../../scenes/styles';
import { Scene, StyleBake } from '../../scenes/types';
import { styleBake } from '../../scenes/stylesBaked';

// The wizard's steps for one scene: the app's design steps, each trimmed to what this scene can
// really show (styles generated and baked for every item of their group, finishes for items that
// are baked), then the summary. A step left with nothing to choose is dropped. Pure, unit-tested.

export interface ReadyStep extends DesignStep {
  // The style group, when its scene has at least one ready design
  styleGroup?: (typeof STYLE_GROUPS)[number];
  // The finish's baked items and the materials that fit all of them
  finishItems?: string[];
  materials?: ReturnType<typeof materialsFor>;
}

export type WizardStep = ({ kind: 'design' } & ReadyStep) | { kind: 'scene'; id: 'scene'; title: string; hint: string } | { kind: 'summary'; id: 'summary'; title: string; hint: string };

/** A group's ready styles: generated, and baked for every item of the group. */
export const readyStyles = (sceneId: string, groupId: string) => {
  const group = STYLE_GROUPS.find((g) => g.id === groupId && g.sceneId === sceneId);
  if (!group) return [];
  return optionsFor(group.id)
    .map((option) => ({ option, bake: styleBake(sceneId, group.id, option.id) }))
    .filter((s): s is { option: (typeof s)['option']; bake: StyleBake } => !!s.bake && group.itemIds.every((id) => s.bake!.items[id]));
};

export const wizardSteps = (app: AppConfig, scene: Scene, isBaked: (itemId: string) => boolean, sceneCount = 1): WizardStep[] => {
  const steps: WizardStep[] = [];
  if (sceneCount > 1) steps.push({ kind: 'scene', id: 'scene', title: 'Choose your layout', hint: 'Pick the one closest to yours. We measure properly on the visit.' });
  for (const step of app.steps) {
    const ready: ReadyStep = { ...step };
    if (step.style && readyStyles(scene.id, step.style).length) ready.styleGroup = STYLE_GROUPS.find((g) => g.id === step.style && g.sceneId === scene.id);
    if (step.finish) {
      const items = scene.items.filter((i) => step.finish!.itemIds.includes(i.id) && isBaked(i.id));
      const materials = materialsFor(scene.collection ?? scene.id, [...new Set(items.map((i) => i.role))]).filter((m) => !step.finish!.exclude?.includes(m.category));
      if (items.length && materials.length) Object.assign(ready, { finishItems: items.map((i) => i.id), materials });
    }
    if (ready.styleGroup || ready.finishItems) steps.push({ kind: 'design', ...ready });
  }
  steps.push({ kind: 'summary', id: 'summary', title: 'Your design', hint: 'Download it, share it, or ask us for a quote.' });
  return steps;
};

/** The finish chosen for a step: the one its items share, else null (none yet, or mixed). */
export const stepMaterial = (step: ReadyStep, assignments: Record<string, string>) => {
  const ids = new Set((step.finishItems ?? []).map((i) => assignments[i]));
  return ids.size === 1 ? (materialById([...ids][0] ?? '') ?? null) : null;
};

/** The style chosen for a step, as its label (absent = as designed). */
export const stepStyle = (step: ReadyStep, styles: Record<string, string>) => {
  const id = step.styleGroup && styles[step.styleGroup.id];
  return id && id !== ORIGINAL ? (optionsFor(step.styleGroup!.id).find((o) => o.id === id) ?? null) : null;
};

/** The few words on the preview: each step's chosen design and finish ("Slab · Midnight Navy · Thick stone"). */
export const lookLabel = (steps: WizardStep[], styles: Record<string, string>, assignments: Record<string, string>, max = 3): string => {
  const parts: string[] = [];
  for (const s of steps) {
    if (s.kind !== 'design') continue;
    const style = stepStyle(s, styles);
    const material = stepMaterial(s, assignments);
    if (style) parts.push(style.label);
    if (material) parts.push(material.name.replace(/ (Lacquer|Veneer)$/, ''));
  }
  // The same finish on two steps (doors and panels both Burgundy) is named once
  return [...new Set(parts)].slice(0, max).join(' · ');
};

/** The step that changes an item (a click on the picture jumps there). */
export const stepOfItem = (steps: WizardStep[], itemId: string): number =>
  steps.findIndex((s) => s.kind === 'design' && (s.finishItems?.includes(itemId) || s.styleGroup?.itemIds.includes(itemId)));

/** The items a step changes, outlined while it is open. */
export const stepItems = (step: WizardStep | undefined): string[] =>
  step?.kind === 'design' ? [...new Set([...(step.styleGroup?.itemIds ?? []), ...(step.finishItems ?? [])])] : [];
