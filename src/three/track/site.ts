/**
 * Baked circuit "site map": one RGBA texture in world XZ that drives cheap
 * night lighting and ground shading without real lights.
 *   r = proximity to the track centreline (1 on track → 0 ~150 m away)
 *   g = night light: track floodlighting + floodlight / landmark pools
 *   b = paved ground (track, pit lane, paddock, car parks, roads)
 *   a = city glow (wide, low ambient spill from lit areas and street cities)
 * Consumed through PROP_UNIFORMS (see models/props/core.ts `siteSample()`).
 */
import * as THREE from 'three';
import type { CircuitData } from '@/data/circuits/types';
import type { TrackModel } from '@/sim/trackModel';
import type { ModelQuality } from '@/three/models/types';
import { PROP_UNIFORMS, resetSiteMap } from '@/three/models/props';

export interface SiteLight {
  x: number;
  z: number;
  /** Radius in metres. */
  r: number;
  /** Strength 0..1. */
  k: number;
}

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
  /** 0 = day … 1 = full night. */
  night: number;
  lights: readonly SiteLight[];
  paved: readonly SitePaved[];
  roads: ReadonlyArray<{ pts: THREE.Vector3[]; width: number }>;
  /** Floodlight level along the racing surface (0..1). */
  trackLight: number;
}

export interface SiteMapHandle {
  texture: THREE.DataTexture;
  dispose(): void;
}

const MARGIN = 650;

export function buildSiteMap(o: SiteMapOptions): SiteMapHandle {
  const { circuit, model } = o;
  const res = o.quality === 'low' ? 512 : 1024;
  const b = circuit.bounds;
  // Square world rect → uniform metres per pixel (strokes stay round).
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY) + MARGIN * 2;
  const cx = (b.minX + b.maxX) / 2;
  const cz = -(b.minY + b.maxY) / 2;
  const ox = cx - span / 2;
  const oz = cz - span / 2;
  const ppm = res / span;

  const track = centreline(model.track, 4);
  const pit = model.pit.length > 20 ? centreline(model.pit, 3) : [];
  const street = circuit.theme === 'street';
  const halfW = circuit.widthM / 2;

  const layer = () => {
    const c = document.createElement('canvas');
    c.width = c.height = res;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, res, res);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return ctx;
  };
  const px = (x: number) => (x - ox) * ppm;
  const pz = (z: number) => (z - oz) * ppm;
  const path = (ctx: CanvasRenderingContext2D, pts: ReadonlyArray<{ x: number; z: number }>, closed: boolean) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(px(p.x), pz(p.z)) : ctx.moveTo(px(p.x), pz(p.z))));
    if (closed) ctx.closePath();
  };
  /** Soft falloff band: stacked additive strokes from wide/faint to narrow. */
  const band = (ctx: CanvasRenderingContext2D, pts: ReadonlyArray<{ x: number; z: number }>, closed: boolean, coreM: number, falloffM: number, peak: number, steps = 10) => {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = '#fff';
    for (let i = 0; i < steps; i++) {
      const w = coreM + falloffM * (1 - i / steps);
      ctx.globalAlpha = peak / steps;
      ctx.lineWidth = Math.max(1, w * 2 * ppm);
      path(ctx, pts, closed);
      ctx.stroke();
    }
    ctx.restore();
  };
  const radial = (ctx: CanvasRenderingContext2D, x: number, z: number, r: number, k: number) => {
    const rp = Math.max(1.5, r * ppm);
    const g = ctx.createRadialGradient(px(x), pz(z), 0, px(x), pz(z), rp);
    const a = Math.min(1, k);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.35, `rgba(255,255,255,${a * 0.72})`);
    g.addColorStop(0.7, `rgba(255,255,255,${a * 0.25})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(px(x) - rp, pz(z) - rp, rp * 2, rp * 2);
    ctx.restore();
  };

  // r — track proximity
  const r = layer();
  band(r, track, model.track.closed, halfW, 150, 1, 14);

  // g — night light
  const g = layer();
  band(g, track, model.track.closed, halfW + 4, 30, o.trackLight, 8);
  if (pit.length) band(g, pit, false, 6, 22, o.trackLight * 0.85, 6);
  for (const l of o.lights) radial(g, l.x, l.z, l.r, l.k);

  // b — paved ground (hard edges, 1 px soft)
  const bl = layer();
  bl.strokeStyle = '#fff';
  bl.lineWidth = Math.max(1, (circuit.widthM + 6) * ppm);
  path(bl, track, model.track.closed);
  bl.stroke();
  if (pit.length) {
    bl.lineWidth = Math.max(1, 26 * ppm);
    path(bl, pit, false);
    bl.stroke();
  }
  for (const road of o.roads) {
    bl.lineWidth = Math.max(1, road.width * ppm);
    path(bl, road.pts, false);
    bl.stroke();
  }
  bl.fillStyle = '#fff';
  for (const p of o.paved) {
    bl.save();
    bl.translate(px(p.cx), pz(p.cz));
    // World yaw rotates about +Y; in the XZ canvas (z down) that is a negative angle.
    bl.rotate(-p.yaw);
    bl.fillRect((-p.w / 2) * ppm, (-p.d / 2) * ppm, p.w * ppm, p.d * ppm);
    bl.restore();
  }

  // a — city glow
  const a = layer();
  for (const l of o.lights) radial(a, l.x, l.z, l.r * 2.6, l.k * 0.45);
  band(a, track, model.track.closed, halfW, street ? 260 : 90, street ? 0.55 : 0.22, 8);

  const R = r.getImageData(0, 0, res, res).data;
  const G = g.getImageData(0, 0, res, res).data;
  const B = bl.getImageData(0, 0, res, res).data;
  const A = a.getImageData(0, 0, res, res).data;
  const data = new Uint8Array(res * res * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = R[i]!;
    data[i + 1] = G[i]!;
    data[i + 2] = B[i]!;
    data[i + 3] = A[i]!;
  }
  // Canvas row 0 is z = oz, which is exactly uv.y = 0 with flipY off.
  const texture = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;

  PROP_UNIFORMS.uSiteMap.value = texture;
  PROP_UNIFORMS.uSiteRect.value.set(ox, oz, 1 / span, 1 / span);
  PROP_UNIFORMS.uSiteNight.value = THREE.MathUtils.clamp(o.night, 0, 1);

  return {
    texture,
    dispose() {
      if (PROP_UNIFORMS.uSiteMap.value === texture) resetSiteMap();
      texture.dispose();
    },
  };
}

/** World XZ polyline of a track geometry (circuit Y maps to world −Z). */
function centreline(geom: TrackModel['track'], stepM: number): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  const p: [number, number] = [0, 0];
  const n = Math.max(8, Math.ceil(geom.length / stepM));
  const last = geom.closed ? n - 1 : n;
  for (let i = 0; i <= last; i++) {
    geom.pointAt((i / n) * geom.length, 0, p);
    out.push({ x: p[0], z: -p[1] });
  }
  return out;
}
