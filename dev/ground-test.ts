// TEMP: loads a circuit without the sim for ground / site-map checks.
import '@/styles/scene.css';
import { loadCircuit } from '@/data/circuits';
import { buildTrackModel } from '@/sim/trackModel';
import { RaceScene } from '@/three/engine/RaceScene';
import * as THREE from 'three';

const params = new URLSearchParams(location.search);
const id = params.get('id') ?? 'ae-2009';
const quality = (params.get('q') ?? 'medium') as 'low' | 'medium' | 'high';
const circuit = await loadCircuit(id);
const model = buildTrackModel(circuit);
const s = new RaceScene(document.getElementById('wrap')!, { quality, reducedMotion: true, labelLayer: document.getElementById('labels')!, onContextLost: () => {}, onPick: () => {} });
Object.assign(window, { __scene: s, THREE });
const t0 = performance.now();
await s.load(circuit, model, []);
(window as unknown as { __loadMs: number }).__loadMs = performance.now() - t0;
s.setCameraMode('orbit');
s.showZones(false);
let last = performance.now();
const loop = (now: number) => {
  s.render(Math.min(0.1, (now - last) / 1000), false);
  last = now;
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
(window as unknown as { __ready: boolean }).__ready = true;
