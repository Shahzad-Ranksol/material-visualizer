import { APP } from '../apps';
import { SCENES } from './scenes';

// The scenes this build's app ships (VITE_APP). The dev tools keep using every scene in SCENES;
// node scripts never import this file (it reads import.meta.env)
export const APP_SCENES = SCENES.filter((s) => APP.sceneIds.includes(s.id));
