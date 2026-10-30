import * as THREE from 'three';
import type { CircuitData } from '@/data/circuits/types';
import type { TrackGeometry } from '@/data/circuits/geometry';
import type { TrackModel } from '@/sim/trackModel';
import type { ModelQuality } from '@/three/models/types';
import { PROP_UNIFORMS, resetSiteMap } from '@/three/models/props';
import { PIT_HALF_WIDTH } from './trackMesh';

/**
 * Baked "site map": one RGBA8 texture over the circuit (world XZ) that every
 * environment shader samples instead of using real lights.
 *   r  proximity to the road edge: 255 on the road → 0 at SITE_NEAR_RANGE metres (linear, see above)
 *   g  night light (track floodlighting, lamp / stand / landmark pools)
 *   b  paved ground (track, pit lane, paddock, roads); 0.5 sits on the true edge
 *   a  diffuse city / floodlight glow (warm haze on the ground)
 * Texel (i, j) covers world x = originX + (i + ½)·px, z = originZ + (j + ½)·px
 * (no flip), matching `texture2D(uSiteMap, (xz − uSiteRect.xy) · uSiteRect.zw)`.
 * Outside the map the clamped border reads dark, unpaved, far from the track.
 */

/**
 * r channel encoding: edge distance e (m, negative on the road) → `1 − (e + LEAD) / (RANGE + LEAD)`;
 * the lead keeps the ramp linear (kink-free) across the road edge.
 */
export const SITE_NEAR_RANGE = 96;
export const SITE_NEAR_LEAD = 8;

/** A night light pool: world position, radius (m) and strength 0..1. */
export interface SiteLight {
  x: number;
  z: number;
  r: number;
  k: number;
}

/** A paved rectangle: world centre, width along local X, depth along local Z, yaw (rotation.y). */
export interface SitePaved {
  cx: number;
  cz: number;
  w: number;
  d: number;
  yaw: number;
}

export interface SiteMapOptions {
  circuit: CircuitData;
  model: TrackModel;
  quality: ModelQuality;
  /** 0 = day … 1 = night (drives `uSiteNight`). */
  night: number;
  lights: readonly SiteLight[];
  paved: readonly SitePaved[];
  roads: ReadonlyArray<{ pts: THREE.Vector3[]; width: number }>;
  /** Floodlight level along the track at night (0..1). */
  trackLight: number;
}

export interface SiteMap {
  texture: THREE.DataTexture;
  dispose(): void;
}

const MARGIN = 450;
const KERB = 1.2;
const LEAD = SITE_NEAR_LEAD;
const BORDER_FADE = 120;
const RESOLUTION: Record<ModelQuality, number> = { low: 512, medium: 1024, high: 2048 };

function polyline(g: TrackGeometry, step: number): Float32Array {
  const n = Math.max(2, Math.ceil(g.length / step));
  const out = new Float32Array((n + 1) * 2);
  const p: [number, number] = [0, 0];
  for (let i = 0; i <= n; i++) {
    g.pointAt((i / n) * g.length, 0, p);
    out[i * 2] = p[0];
    out[i * 2 + 1] = -p[1];
  }
  return out;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function buildSiteMap(opts: SiteMapOptions): SiteMap {
  const { circuit, model, quality, night, lights, paved, roads, trackLight } = opts;
  const hw = circuit.widthM / 2;
  const street = circuit.theme === 'street';
  const R = SITE_NEAR_RANGE;

  const b = circuit.bounds;
  const main = polyline(model.track, 3);
  const pit = polyline(model.pit, 3);
  let minX = b.minX;
  let maxX = b.maxX;
  let minZ = -b.maxY;
  let maxZ = -b.minY;
  for (const pts of [main, pit]) {
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i]!);
      maxX = Math.max(maxX, pts[i]!);
      minZ = Math.min(minZ, pts[i + 1]!);
      maxZ = Math.max(maxZ, pts[i + 1]!);
    }
  }
  minX -= MARGIN;
  maxX += MARGIN;
  minZ -= MARGIN;
  maxZ += MARGIN;
  const px = Math.max(Math.max(maxX - minX, maxZ - minZ) / RESOLUTION[quality], 1.5);
  const W = Math.ceil((maxX - minX) / px);
  const H = Math.ceil((maxZ - minZ) / px);
  const originX = (minX + maxX) / 2 - (W * px) / 2;
  const originZ = (minZ + maxZ) / 2 - (H * px) / 2;
  const data = new Uint8Array(W * H * 4);
  const lit = night > 0.001;
  if (!lit) for (let i = 1; i < data.length; i += 4) data[i] = 255;

  const cellI = (x: number) => (x - originX) / px;
  const cellJ = (z: number) => (z - originZ) / px;

  /** Paved strip: exact distance to each segment → b (0.5 on the true edge). */
  const stampPaved = (pts: ArrayLike<number>, halfPaved: number) => {
    const reach = halfPaved + px;
    for (let s = 0; s + 3 < pts.length; s += 2) {
      const ax = pts[s]!, az = pts[s + 1]!, bx = pts[s + 2]!, bz = pts[s + 3]!;
      const ex = bx - ax;
      const ez = bz - az;
      const l2 = ex * ex + ez * ez;
      if (l2 < 1e-9) continue;
      const i0 = Math.max(0, Math.floor(cellI(Math.min(ax, bx) - reach)));
      const i1 = Math.min(W - 1, Math.ceil(cellI(Math.max(ax, bx) + reach)));
      const j0 = Math.max(0, Math.floor(cellJ(Math.min(az, bz) - reach)));
      const j1 = Math.min(H - 1, Math.ceil(cellJ(Math.max(az, bz) + reach)));
      for (let j = j0; j <= j1; j++) {
        const z = originZ + (j + 0.5) * px;
        for (let i = i0; i <= i1; i++) {
          const x = originX + (i + 0.5) * px;
          const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / l2));
          const dx = x - (ax + t * ex);
          const dz = z - (az + t * ez);
          const v = Math.round(Math.min(1, Math.max(0, 0.5 + (halfPaved - Math.sqrt(dx * dx + dz * dz)) / px)) * 255);
          const o = (j * W + i) * 4 + 2;
          if (v > data[o]!) data[o] = v;
        }
      }
    }
  };
  stampPaved(main, hw + KERB);
  stampPaved(pit, PIT_HALF_WIDTH + 0.6);
  {
    // Apron between the pit lane and the track where it runs alongside, and the garage floor behind the lane.
    const lane = model.pit;
    const pl = circuit.pitLane;
    const garage = pl.side === 'left' ? 1 : -1;
    const a: [number, number] = [0, 0];
    const e: [number, number] = [0, 0];
    let hint: number | undefined;
    for (let d = 0; d <= lane.length; d += 3) {
      lane.pointAt(d, 0, a);
      const pr = model.track.project(a[0], a[1], hint, hint === undefined ? undefined : 160);
      hint = pr.s;
      if (Math.abs(pr.lateral) - hw - PIT_HALF_WIDTH > 16) continue;
      model.track.pointAt(pr.s, Math.sign(pr.lateral) * hw, e);
      stampPaved([a[0], -a[1], e[0], -e[1]], 2.2);
    }
    const floor: number[] = [];
    for (let d = Math.max(0, pl.boxesStartS - 24); d <= Math.min(lane.length, pl.boxesEndS + 24); d += 6) {
      lane.pointAt(d, garage * (PIT_HALF_WIDTH + 12), a);
      floor.push(a[0], -a[1]);
    }
    stampPaved(floor, 12);
  }

  // r: exact road-edge distance on a coarse grid (the ramp is smooth), sampled bilinearly below.
  const cpx = Math.max(px, 6);
  const CW = Math.ceil((W * px) / cpx);
  const CH = Math.ceil((H * px) / cpx);
  const coarse = new Uint8Array(CW * CH);
  const stampNear = (pts: ArrayLike<number>, halfRoad: number) => {
    const reach = R + halfRoad + cpx;
    for (let s = 0; s + 3 < pts.length; s += 2) {
      const ax = pts[s]!, az = pts[s + 1]!, bx = pts[s + 2]!, bz = pts[s + 3]!;
      const ex = bx - ax;
      const ez = bz - az;
      const l2 = ex * ex + ez * ez;
      if (l2 < 1e-9) continue;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - originX) / cpx));
      const i1 = Math.min(CW - 1, Math.ceil((Math.max(ax, bx) + reach - originX) / cpx));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - originZ) / cpx));
      const j1 = Math.min(CH - 1, Math.ceil((Math.max(az, bz) + reach - originZ) / cpx));
      for (let j = j0; j <= j1; j++) {
        const z = originZ + (j + 0.5) * cpx;
        for (let i = i0; i <= i1; i++) {
          const x = originX + (i + 0.5) * cpx;
          const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / l2));
          const dx = x - (ax + t * ex);
          const dz = z - (az + t * ez);
          const edge = Math.sqrt(dx * dx + dz * dz) - halfRoad;
          if (edge >= R) continue;
          const v = Math.round(Math.min(1, (1 - (edge + LEAD) / (R + LEAD))) * 255);
          if (v > coarse[j * CW + i]!) coarse[j * CW + i] = v;
        }
      }
    }
  };
  stampNear(polyline(model.track, 8), hw);
  stampNear(polyline(model.pit, 8), PIT_HALF_WIDTH);
  {
    const ci = new Int32Array(W);
    const cf = new Float32Array(W);
    for (let i = 0; i < W; i++) {
      const u = Math.min(CW - 1, Math.max(0, ((i + 0.5) * px) / cpx - 0.5));
      ci[i] = Math.min(CW - 2, Math.floor(u));
      cf[i] = u - ci[i]!;
    }
    for (let j = 0; j < H; j++) {
      const v = Math.min(CH - 1, Math.max(0, ((j + 0.5) * px) / cpx - 0.5));
      const j0 = Math.min(CH - 2, Math.floor(v));
      const fy = v - j0;
      const r0 = j0 * CW;
      const r1 = r0 + CW;
      for (let i = 0; i < W; i++) {
        const i0 = ci[i]!;
        const fx = cf[i]!;
        const top = coarse[r0 + i0]! + (coarse[r0 + i0 + 1]! - coarse[r0 + i0]!) * fx;
        const bot = coarse[r1 + i0]! + (coarse[r1 + i0 + 1]! - coarse[r1 + i0]!) * fx;
        data[(j * W + i) * 4] = top + (bot - top) * fy + 0.5;
      }
    }
  }

  for (const rd of roads) {
    const flat = new Float32Array(rd.pts.length * 2);
    rd.pts.forEach((p, i) => {
      flat[i * 2] = p.x;
      flat[i * 2 + 1] = p.z;
    });
    stampPaved(flat, rd.width / 2);
  }

  for (const pv of paved) {
    const hx = pv.w / 2;
    const hz = pv.d / 2;
    const reach = Math.hypot(hx, hz) + px;
    const c = Math.cos(pv.yaw);
    const s = Math.sin(pv.yaw);
    const i0 = Math.max(0, Math.floor(cellI(pv.cx - reach)));
    const i1 = Math.min(W - 1, Math.ceil(cellI(pv.cx + reach)));
    const j0 = Math.max(0, Math.floor(cellJ(pv.cz - reach)));
    const j1 = Math.min(H - 1, Math.ceil(cellJ(pv.cz + reach)));
    for (let j = j0; j <= j1; j++) {
      const dz = originZ + (j + 0.5) * px - pv.cz;
      for (let i = i0; i <= i1; i++) {
        const dx = originX + (i + 0.5) * px - pv.cx;
        // rotation.y = yaw maps local (x, z) → (x·cos + z·sin, −x·sin + z·cos); this is its inverse.
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        const sd = Math.min(hx - Math.abs(lx), hz - Math.abs(lz));
        const v = Math.round(Math.min(1, Math.max(0, 0.5 + sd / px)) * 255);
        const o = (j * W + i) * 4;
        if (v > data[o + 2]!) data[o + 2] = v;
      }
    }
  }

  if (lit) {
    // Radial pools (screen-blended so overlaps saturate smoothly); the glow channel gets a wider, fainter copy.
    const splat = (ch: number, x: number, z: number, radius: number, k: number) => {
      const i0 = Math.max(0, Math.floor(cellI(x - radius)));
      const i1 = Math.min(W - 1, Math.ceil(cellI(x + radius)));
      const j0 = Math.max(0, Math.floor(cellJ(z - radius)));
      const j1 = Math.min(H - 1, Math.ceil(cellJ(z + radius)));
      const inv = 1 / (radius * radius);
      for (let j = j0; j <= j1; j++) {
        const dz = originZ + (j + 0.5) * px - z;
        for (let i = i0; i <= i1; i++) {
          const dx = originX + (i + 0.5) * px - x;
          const t = (dx * dx + dz * dz) * inv;
          if (t >= 1) continue;
          const f = (1 - t) * (1 - t);
          const o = (j * W + i) * 4 + ch;
          const cur = data[o]!;
          data[o] = cur + k * f * (255 - cur) + 0.5;
        }
      }
    };
    for (const l of lights) {
      splat(1, l.x, l.z, l.r, Math.min(1, l.k));
      splat(3, l.x, l.z, l.r * 2.6, Math.min(1, l.k * 0.5));
    }

    // Track floodlighting and haze as functions of the r channel.
    const lutG = new Uint8Array(256);
    const lutA = new Uint8Array(256);
    const haze = street ? 0.5 : 0.22;
    for (let v = 1; v < 256; v++) {
      const edge = Math.max(0, (1 - v / 255) * (R + LEAD) - LEAD);
      const spill = 1 - smooth(6, 36, edge);
      lutG[v] = Math.round(255 * trackLight * spill * spill);
      lutA[v] = Math.round(255 * haze * Math.exp(-edge / 40) * (1 - smooth(50, R, edge)));
    }
    const fadeN = Math.max(1, BORDER_FADE / px);
    const fx = new Float32Array(W);
    for (let i = 0; i < W; i++) fx[i] = smooth(0, fadeN, Math.min(i, W - 1 - i));
    for (let j = 0; j < H; j++) {
      const fy = smooth(0, fadeN, Math.min(j, H - 1 - j));
      for (let i = 0; i < W; i++) {
        const o = (j * W + i) * 4;
        const r = data[o]!;
        const f = Math.min(fx[i]!, fy);
        const g = data[o + 1]!;
        const a = data[o + 3]!;
        data[o + 1] = (g + (lutG[r]! * (255 - g)) / 255) * f + 0.5;
        data[o + 3] = (a + (lutA[r]! * (255 - a)) / 255) * f + 0.5;
      }
    }
  }

  const texture = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  texture.name = `site-${circuit.id}`;

  PROP_UNIFORMS.uSiteMap.value = texture;
  PROP_UNIFORMS.uSiteRect.value.set(originX, originZ, 1 / (W * px), 1 / (H * px));
  PROP_UNIFORMS.uSiteNight.value = night;

  return {
    texture,
    dispose() {
      if (PROP_UNIFORMS.uSiteMap.value === texture) resetSiteMap();
      texture.dispose();
    },
  };
}
