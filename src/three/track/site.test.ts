import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { loadCircuit } from '@/data/circuits';
import { buildTrackModel } from '@/sim/trackModel';
import { PROP_UNIFORMS } from '@/three/models/props';
import { SITE_NEAR_LEAD, SITE_NEAR_RANGE, buildSiteMap } from './site';

/** RGBA at a world XZ point, decoded exactly like the GLSL `texture2D(uSiteMap, (xz − rect.xy) · rect.zw)`. */
function texel(tex: THREE.DataTexture, x: number, z: number): [number, number, number, number] {
  const rect = PROP_UNIFORMS.uSiteRect.value;
  const { width, height, data } = tex.image as { width: number; height: number; data: Uint8Array };
  const i = Math.floor((x - rect.x) * rect.z * width);
  const j = Math.floor((z - rect.y) * rect.w * height);
  const o = (j * width + i) * 4;
  return [data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!];
}

describe('buildSiteMap', async () => {
  const circuit = await loadCircuit('ae-2009');
  const model = buildTrackModel(circuit);
  const at = (s: number, lat: number): [number, number] => {
    const p = model.track.pointAt(s, lat);
    return [p[0], -p[1]];
  };
  const light = at(900, 70);
  const site = buildSiteMap({
    circuit,
    model,
    quality: 'medium',
    night: 1,
    lights: [{ x: light[0], z: light[1], r: 40, k: 0.9 }],
    paved: [],
    roads: [],
    trackLight: 0.6,
  });

  it('publishes the map through the shared prop uniforms', () => {
    expect(PROP_UNIFORMS.uSiteMap.value).toBe(site.texture);
    expect(PROP_UNIFORMS.uSiteNight.value).toBe(1);
  });

  /** A world point whose true distance to the centreline lies in [lo, hi] and far from the test light. */
  const probe = (lo: number, hi: number): { x: number; z: number; d: number } => {
    for (let s = 0; s < model.track.length; s += 37) {
      for (const lat of [-1, 1]) {
        for (let off = lo; off <= hi; off += 5) {
          const [x, z] = at(s, lat * off);
          const d = model.track.project(x, -z).distance;
          if (d >= lo && d <= hi && Math.hypot(x - light[0], z - light[1]) > 200) return { x, z, d };
        }
      }
    }
    throw new Error('no probe point');
  };

  it('marks the road: r and b saturate on the track, r falls linearly beside it', () => {
    const [x, z] = at(300, 0);
    const [r, , b] = texel(site.texture, x, z);
    expect(r).toBeGreaterThan(245);
    expect(b).toBeGreaterThan(245);
    const hw = circuit.widthM / 2;
    const p = probe(hw + 30, hw + 60);
    const [rs, , bs] = texel(site.texture, p.x, p.z);
    const expected = 255 * (1 - (p.d - hw + SITE_NEAR_LEAD) / (SITE_NEAR_RANGE + SITE_NEAR_LEAD));
    expect(Math.abs(rs - expected)).toBeLessThan(14);
    expect(bs).toBe(0);
  });

  it('places light pools where the world position says (circuit Y maps to −Z)', () => {
    const [, g] = texel(site.texture, light[0], light[1]);
    expect(g).toBeGreaterThan(150);
    // The mirrored position (+Z instead of −Z) must not be lit.
    const [, gMirror] = texel(site.texture, light[0], -light[1]);
    expect(gMirror).toBeLessThan(150);
  });

  it('floodlights the track and fades into dark ground', () => {
    const [x, z] = at(300, 0);
    const [, gTrack] = texel(site.texture, x, z);
    const p = probe(60, 90);
    const [, gFar] = texel(site.texture, p.x, p.z);
    expect(gTrack).toBeGreaterThan(255 * 0.55);
    expect(gFar).toBeLessThan(255 * 0.05);
  });

  it('resets the shared map on dispose', () => {
    site.dispose();
    expect(PROP_UNIFORMS.uSiteMap.value).not.toBe(site.texture);
    expect(PROP_UNIFORMS.uSiteNight.value).toBe(0);
  });
});
