import { describe, expect, it } from 'vitest';
import { APPS, appFor } from '../../apps/registry';
import { SCENES } from '../../scenes/scenes';
import { BAKED } from '../../scenes/baked';
import { STYLE_GROUPS } from '../../scenes/styles';
import { lookLabel, stepItems, stepOfItem, wizardSteps } from '../../components/configurator/wizard';

const sceneOf = (id: string) => SCENES.find((s) => s.id === id)!;
const steps = (appId: keyof typeof APPS) => {
  const scene = sceneOf(APPS[appId].sceneIds[0]);
  return wizardSteps(APPS[appId], scene, (i) => !!BAKED[scene.id]?.items[i]);
};

describe('apps', () => {
  it('picks the app by id and refuses unknown ones', () => {
    expect(appFor(undefined).id).toBe('kitchen');
    expect(appFor('fencing').id).toBe('fencing');
    expect(() => appFor('garage')).toThrow(/Unknown VITE_APP/);
  });

  it('every step of an app whose scenes exist names real style groups and items', () => {
    for (const app of Object.values(APPS)) {
      for (const sceneId of app.sceneIds) {
        const scene = SCENES.find((s) => s.id === sceneId);
        if (!scene) continue; // not delivered yet (the bathroom)
        for (const step of app.steps) {
          if (step.style) expect(STYLE_GROUPS.some((g) => g.id === step.style && g.sceneId === sceneId), `${app.id}/${step.id}`).toBe(true);
          for (const id of step.finish?.itemIds ?? []) expect(scene.items.some((i) => i.id === id), `${app.id}/${step.id}/${id}`).toBe(true);
        }
        // Every item can be reached from some step (a click on it jumps there)
        const ws = wizardSteps(app, scene, () => true);
        for (const item of scene.items) expect(stepOfItem(ws, item.id), `${app.id}/${item.id}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('fencing changes the fence design only: style steps, no finish', () => {
    const ws = steps('fencing');
    expect(ws.map((s) => s.kind)).toEqual(['design', 'summary']);
    expect(ws.every((s) => s.kind !== 'design' || !s.finishItems)).toBe(true);
    expect(ws[0].kind === 'design' && ws[0].styleGroup?.id).toBe('fence');
  });

  it('kitchen asks design and finish, ending on the summary', () => {
    const ws = steps('kitchen');
    expect(ws.map((s) => s.id)).toEqual(['doors', 'colour', 'worktop', 'splashback', 'floor', 'summary']);
    expect(stepItems(ws[1])).toContain('island');
    expect(stepOfItem(ws, 'worktop')).toBe(2);
    expect(lookLabel(ws, { 'kitchen-doors': 'slab' }, { island: 'kit-navy-lacquer', 'wall-cabinets': 'kit-navy-lacquer', 'tall-units': 'kit-navy-lacquer', canopy: 'kit-navy-lacquer', 'base-cabinets': 'kit-navy-lacquer' })).toBe('Slab · Midnight Navy');
  });

  it('drops a step with nothing to choose', () => {
    const scene = sceneOf('kitchen');
    const ws = wizardSteps(APPS.kitchen, scene, (i) => i !== 'floor');
    expect(ws.some((s) => s.id === 'floor')).toBe(false);
  });
});
