import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneColliders } from './colliders';

function scene(...objs: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.add(...objs);
  return g;
}

/** Axis-aligned box standing on the ground at (x, z). */
function box(x: number, z: number, w: number, h: number, d: number, y0 = 0): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  m.position.set(x, y0 + h / 2, z);
  return m;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('SceneColliders', () => {
  it('blocks a ray through a tall building and reports where', () => {
    const c = new SceneColliders();
    c.build([scene(box(0, 0, 30, 25, 30))]);
    expect(c.size).toBeGreaterThan(50);
    const t = c.segmentHit(v(-100, 2, 0), v(100, 2, 0));
    expect(t).toBeGreaterThan(0.3);
    expect(t).toBeLessThan(0.5);
    // Over the roof and around the side the line of sight is clear.
    expect(c.segmentHit(v(-100, 40, 0), v(100, 40, 0))).toBe(1);
    expect(c.segmentHit(v(-100, 2, 40), v(100, 2, 40))).toBe(1);
  });

  it('ignores hits within skipEnd of the target', () => {
    const c = new SceneColliders();
    c.build([scene(box(0, 0, 20, 20, 20))]);
    const from = v(-60, 2, 0);
    expect(c.segmentHit(from, v(0, 2, 0), 0.35, 0)).toBeLessThan(1);
    expect(c.segmentHit(from, v(0, 2, 0), 0.35, 12)).toBe(1);
  });

  it('answers pointBlocked and topNear', () => {
    const c = new SceneColliders();
    c.build([scene(box(50, -20, 24, 18, 24))]);
    expect(c.pointBlocked(v(50, 9, -20), 0)).toBe(true);
    expect(c.pointBlocked(v(50, 30, -20), 1)).toBe(false);
    expect(c.pointBlocked(v(0, 9, 0), 1)).toBe(false);
    expect(c.topNear(50, -20, 4)).toBeCloseTo(18, 1);
    expect(c.topNear(120, 80, 8)).toBe(0);
    expect(c.topNear(66, -20, 8)).toBeCloseTo(18, 1);
  });

  it('lets a camera pass under an elevated deck', () => {
    const c = new SceneColliders();
    c.build([scene(box(0, 0, 40, 1, 12, 7), box(-24, 0, 4, 8, 12), box(24, 0, 4, 8, 12))]);
    expect(c.segmentHit(v(0, 2, -60), v(0, 2, 60))).toBe(1);
    expect(c.segmentHit(v(0, 7.5, -60), v(0, 7.5, 60))).toBeLessThan(1);
  });

  it('skips thin, low, hidden and flagged props', () => {
    const c = new SceneColliders();
    const pole = box(0, 0, 0.3, 12, 0.3);
    const kerb = box(20, 0, 30, 1.2, 30);
    const hidden = box(40, 0, 30, 20, 30);
    hidden.visible = false;
    const flagged = box(60, 0, 30, 20, 30);
    flagged.userData.noCollide = true;
    const crowd = box(80, 0, 30, 20, 30);
    crowd.name = 'crowd';
    c.build([scene(pole, kerb, hidden, flagged, crowd)]);
    expect(c.size).toBe(0);
    expect(c.segmentHit(v(-50, 2, 0), v(100, 2, 0))).toBe(1);
  });

  it('rasterises every instance of an InstancedMesh and honours world transforms', () => {
    const c = new SceneColliders();
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 10, 6), new THREE.MeshBasicMaterial(), 2);
    const m = new THREE.Matrix4();
    inst.setMatrixAt(0, m.makeTranslation(0, 5, 0));
    inst.setMatrixAt(1, m.makeTranslation(40, 5, 0));
    const root = scene(inst);
    root.position.set(100, 0, 100);
    c.build([root]);
    expect(c.topNear(100, 100, 2)).toBeCloseTo(10, 1);
    expect(c.topNear(140, 100, 2)).toBeCloseTo(10, 1);
    expect(c.topNear(120, 100, 2)).toBe(0);
  });
});
