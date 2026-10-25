import bakedJson from './baked.json';
import { BakedScenes } from './types';

// Written by /dev/scenes (scripts/sceneBakeDevServer.ts); JSON can't carry the Vec3 tuples' type
export const BAKED = bakedJson as unknown as BakedScenes;
