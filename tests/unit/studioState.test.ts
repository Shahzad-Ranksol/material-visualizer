import { describe, expect, it } from 'vitest';
import { decodeLook, encodeLook, initialStudioState, lookKey, studioReducer } from '../../scenes/studioState';

describe('studioReducer', () => {
  const base = initialStudioState('kitchen');

  it('plain click selects one item, clicking it again deselects', () => {
    let s = studioReducer(base, { type: 'select', itemId: 'island', additive: false });
    expect(s.selected).toEqual(['island']);
    s = studioReducer(s, { type: 'select', itemId: 'worktop', additive: false });
    expect(s.selected).toEqual(['worktop']);
    s = studioReducer(s, { type: 'select', itemId: 'worktop', additive: false });
    expect(s.selected).toEqual([]);
  });

  it('additive click toggles items in a multi-selection', () => {
    let s = studioReducer(base, { type: 'select', itemId: 'island', additive: true });
    s = studioReducer(s, { type: 'select', itemId: 'base-cabinets', additive: true });
    expect(s.selected).toEqual(['island', 'base-cabinets']);
    s = studioReducer(s, { type: 'select', itemId: 'island', additive: true });
    expect(s.selected).toEqual(['base-cabinets']);
  });

  it('applies a finish to every selected item and keeps others', () => {
    let s = studioReducer(base, { type: 'selectAll', itemIds: ['island', 'base-cabinets'] });
    s = studioReducer(s, { type: 'apply', materialId: 'kit-navy-lacquer' });
    s = studioReducer(s, { type: 'select', itemId: 'worktop', additive: false });
    s = studioReducer(s, { type: 'apply', materialId: 'kit-bianco-quartz' });
    expect(s.assignments).toEqual({ island: 'kit-navy-lacquer', 'base-cabinets': 'kit-navy-lacquer', worktop: 'kit-bianco-quartz' });
  });

  it('applying with nothing selected changes nothing', () => {
    expect(studioReducer(base, { type: 'apply', materialId: 'x' })).toBe(base);
  });

  it('removes one finish; reset clears all; switching scene starts fresh', () => {
    let s = studioReducer(base, { type: 'selectAll', itemIds: ['island', 'worktop'] });
    s = studioReducer(s, { type: 'apply', materialId: 'm' });
    s = studioReducer(s, { type: 'remove', itemId: 'island' });
    expect(s.assignments).toEqual({ worktop: 'm' });
    expect(studioReducer(s, { type: 'reset' }).assignments).toEqual({});
    const other = studioReducer(s, { type: 'scene', sceneId: 'fencing' });
    expect(other).toEqual(initialStudioState('fencing'));
  });
});

describe('look encoding', () => {
  const state = { sceneId: 'kitchen' as const, assignments: { worktop: 'kit-bianco-quartz', island: 'kit-navy-lacquer' } };

  it('round-trips through the URL', () => {
    const decoded = decodeLook(encodeLook(state), () => true, () => true, () => true);
    expect(decoded).toEqual({ ...state, styles: {} });
  });

  it('drops unknown scenes, items and materials', () => {
    expect(decodeLook('scene=garage', () => false, () => true, () => true)).toBeNull();
    const decoded = decodeLook(encodeLook(state), () => true, (_, item) => item === 'island', (m) => m !== 'gone');
    expect(decoded?.assignments).toEqual({ island: 'kit-navy-lacquer' });
  });

  it('lookKey ignores assignment order', () => {
    expect(lookKey(state)).toBe(lookKey({ sceneId: 'kitchen', assignments: { island: 'kit-navy-lacquer', worktop: 'kit-bianco-quartz' } }));
  });
});

describe('design styles', () => {
  it('picks a style per group, keeps finishes, and Original clears it', () => {
    let s = studioReducer(initialStudioState('fencing', { 'front-fence': 'fen-cedar' }), { type: 'style', groupId: 'fence', optionId: 'picket' });
    expect(s.styles).toEqual({ fence: 'picket' });
    expect(s.assignments).toEqual({ 'front-fence': 'fen-cedar' });
    s = studioReducer(s, { type: 'style', groupId: 'fence', optionId: 'original' });
    expect(s.styles).toEqual({});
  });

  it('round-trips styles through the share link, dropping unknown ones', () => {
    const state = { sceneId: 'fencing' as const, assignments: { 'front-fence': 'fen-cedar' }, styles: { fence: 'picket', bogus: 'x' } };
    const decoded = decodeLook(encodeLook(state), () => true, () => true, () => true, (_, g) => g === 'fence');
    expect(decoded?.styles).toEqual({ fence: 'picket' });
    expect(lookKey(state)).not.toBe(lookKey({ ...state, styles: {} }));
  });
});
