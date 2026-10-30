import * as THREE from 'three';
import type { CircuitData, EnvironmentTheme } from '@/data/circuits/types';
import type { ModelQuality } from '@/three/models/types';
import { Rng, injectSiteLight } from '@/three/models/props';
import { SITE_NEAR_LEAD, SITE_NEAR_RANGE } from './site';

/**
 * Procedural ground: one world-space shader driven by the baked site map
 * (track proximity, paved areas, night light pools) plus a small tileable noise
 * texture sampled at three scales, so nothing repeats visibly.
 *   grass   mown bands that follow the track edge, long meadow and field bands beyond, worn verge
 *   desert  wind-rippled sand, rocky patches, scrub
 *   dunes   sand with marram tufts and large slope shading
 *   street  jointed paving slabs, dark wear along the road, occasional lawns
 * Paved site-map areas become asphalt with slab joints; at night everything away
 * from the light pools falls to dark (shared `injectSiteLight`).
 */

type Kind = 0 | 1 | 2 | 3;

interface Palette {
  kind: Kind;
  /** [mown dark | pavement | sand, mown light | sand light, far / rock / wear, dry / scrub / lawn / marram, dirt]. */
  c: [string, string, string, string, string];
  asphalt: string;
  /** Slope-shading height range (m) of the macro noise; 0 = flat. */
  relief: number;
}

const PALETTES: Record<EnvironmentTheme, Palette> = {
  countryside: { kind: 0, c: ['#4a8436', '#5a9742', '#3d6a2c', '#7e8a48', '#6b5a3d'], asphalt: '#484b50', relief: 5 },
  parkland: { kind: 0, c: ['#4c8c39', '#5ca046', '#41742f', '#86974f', '#695a40'], asphalt: '#484b50', relief: 5 },
  forest: { kind: 0, c: ['#3c6a2e', '#467836', '#2f5524', '#667a3c', '#5a4a34'], asphalt: '#484b50', relief: 5 },
  desert: { kind: 1, c: ['#cdb48d', '#e4d0a8', '#a98660', '#7a7040', '#8d7455'], asphalt: '#4a4d52', relief: 12 },
  dunes: { kind: 2, c: ['#cdb384', '#e0cb9c', '#a98e5e', '#7d8f4a', '#86724e'], asphalt: '#4a4d52', relief: 32 },
  street: { kind: 3, c: ['#8a8c90', '#9a9ca0', '#55585d', '#4d7c3a', '#5d5a55'], asphalt: '#3f4247', relief: 0 },
};

const TINT: Record<CircuitData['timeOfDay'], string> = { day: '#ffffff', dusk: '#f2dccb', night: '#c9d2e6' };
const GLOW = '#ffb066';
const GLOW_GAIN = ['0.1', '0.12', '0.1', '0.2'];

/* ------------------------------------------------------------------ */
/* Tileable noise                                                      */
/* ------------------------------------------------------------------ */

/**
 * RGBA tile of periodic value noise; each channel has its own feature size so
 * one fetch at a given world scale yields several uncorrelated patterns:
 * r = fine grain, g / b = medium blotches, a = broad patches.
 */
const OCTAVES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[32, 0.1], [64, 0.3], [128, 0.6]],
  [[8, 0.2], [16, 0.3], [32, 0.3], [64, 0.2]],
  [[4, 0.3], [8, 0.35], [16, 0.35]],
  [[3, 0.4], [6, 0.35], [12, 0.25]],
];
const noiseCache = new Map<number, Uint8Array>();

function noiseBytes(size: number): Uint8Array {
  const hit = noiseCache.get(size);
  if (hit) return hit;
  const out = new Uint8Array(size * size * 4);
  const rng = new Rng('ground-noise');
  OCTAVES.forEach((octaves, ch) => {
    const field = new Float32Array(size * size);
    for (const [period, weight] of octaves) {
      const p = Math.min(period, size);
      const lattice = new Float32Array(p * p);
      for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
      for (let y = 0; y < size; y++) {
        const v = (y / size) * p;
        const j0 = Math.floor(v);
        const fy = v - j0;
        const wy = fy * fy * (3 - 2 * fy);
        const r0 = (j0 % p) * p;
        const r1 = ((j0 + 1) % p) * p;
        for (let x = 0; x < size; x++) {
          const u = (x / size) * p;
          const i0 = Math.floor(u);
          const fx = u - i0;
          const wx = fx * fx * (3 - 2 * fx);
          const i1 = (i0 + 1) % p;
          const a = lattice[r0 + (i0 % p)]!;
          const b = lattice[r0 + i1]!;
          const c = lattice[r1 + (i0 % p)]!;
          const d = lattice[r1 + i1]!;
          field[y * size + x]! += weight * (a + (b - a) * wx + (c - a + (a - b - c + d) * wx) * wy);
        }
      }
    }
    // Stretch to the full range so every channel has similar contrast.
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of field) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const k = 255 / Math.max(1e-6, hi - lo);
    for (let i = 0; i < field.length; i++) out[i * 4 + ch] = Math.round((field[i]! - lo) * k);
  });
  noiseCache.set(size, out);
  return out;
}

/* ------------------------------------------------------------------ */
/* Shader                                                              */
/* ------------------------------------------------------------------ */

const FRAG_PARS = /* glsl */ `
uniform sampler2D uNoise;
uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uC4;
uniform vec3 uAsphalt;
uniform vec3 uGlow;
uniform vec2 uAx;
uniform vec2 uAcross;
uniform float uRelief;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 gMacroUv(vec2 p) { return p * 0.002439 + 0.71; }
float gMacroH(vec2 p) { return texture2D(uNoise, gMacroUv(p), 1.0).a; }
`;

const KIND_GRASS = /* glsl */ `
  float sx = gD * 0.41888;
  float band = clamp(0.5 + sin(sx) / max(fwidth(sx) * 1.5, 0.02), 0.0, 1.0);
  band = mix(0.5, band, 1.0 - smoothstep(0.4, 1.2, fwidth(sx)));
  float mowK = 1.0 - smoothstep(40.0, 84.0, gD + (gPat - 0.5) * 44.0);
  vec3 mown = mix(uC0, uC1, band) * (0.86 + 0.28 * nF.r) * (0.93 + 0.14 * nM.g);
  vec3 meadow = mix(uC2, uC3, smoothstep(0.56, 0.86, gMac) * 0.8);
  meadow *= (0.74 + 0.5 * nF.r * nM.r * 2.0) * (0.9 + 0.2 * gHash(vec2(floor(dot(gP, uAcross) / 52.0), 3.0)));
  gAlb = mix(meadow, mown, mowK);
  float wear = (1.0 - smoothstep(1.0, 12.0, gD)) * (0.35 + 0.65 * nM.r);
  gAlb = mix(gAlb, uC4 * (0.8 + 0.4 * nF.g), wear * 0.5);
  gAlb *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 22.0, gD));
`;

const KIND_DESERT = /* glsl */ `
  vec3 sand = mix(uC0, uC1, smoothstep(0.3, 0.72, gMac));
  sand = mix(sand, uC2, smoothstep(0.62, 0.9, gPat) * 0.5);
  float rp = dot(gP, vec2(0.83, 0.56)) * 1.9 + (nM.r - 0.5) * 9.0 + nL.r * 20.0;
  sand *= 1.0 + 0.07 * sin(rp) * (1.0 - smoothstep(0.5, 1.5, fwidth(rp)));
  sand *= (0.86 + 0.28 * nF.r) * (0.9 + 0.2 * nM.g);
  sand *= 1.0 - 0.22 * smoothstep(0.8, 0.9, nF.r);
  sand = mix(sand, uC3 * (0.8 + 0.4 * nF.g), smoothstep(0.74, 0.86, nM.g) * smoothstep(0.42, 0.62, gMac) * 0.5);
  float wear = 1.0 - smoothstep(0.0, 30.0, gD);
  sand = mix(sand, uC4 * (0.85 + 0.3 * nF.g), wear * 0.35 * (0.5 + nM.r));
  gAlb = sand;
`;

const KIND_DUNES = /* glsl */ `
  vec3 sand = mix(uC0, uC1, smoothstep(0.25, 0.75, gMac));
  sand = mix(sand, uC2, smoothstep(0.55, 0.9, gPat) * 0.35);
  float rp = dot(gP, vec2(0.7, 0.71)) * 2.4 + (nM.g - 0.5) * 8.0 + nL.g * 18.0;
  sand *= 1.0 + 0.06 * sin(rp) * (1.0 - smoothstep(0.5, 1.5, fwidth(rp)));
  sand *= (0.88 + 0.24 * nF.r) * (0.92 + 0.16 * nM.g);
  float tuft = smoothstep(0.58, 0.72, gMac * 0.6 + nM.b * 0.4) * (0.55 + 0.45 * smoothstep(0.4, 0.8, nF.g));
  sand = mix(sand, uC3 * (0.8 + 0.4 * nF.r), tuft);
  float wear = 1.0 - smoothstep(0.0, 24.0, gD);
  sand = mix(sand, uC4 * (0.85 + 0.3 * nF.g), wear * 0.3);
  gAlb = sand;
`;

const KIND_STREET = /* glsl */ `
  vec2 gR = vec2(dot(gP, uAx), dot(gP, uAcross)) * 0.3846;
  float tone = gHash(floor(gR));
  vec2 gf = abs(fract(gR) - 0.5);
  float jw = fwidth(gR.x) + fwidth(gR.y);
  float joint = smoothstep(0.465 - jw, 0.5, max(gf.x, gf.y)) * (1.0 - smoothstep(0.3, 1.0, jw));
  vec3 slab = mix(uC0, uC1, tone) * (0.9 + 0.2 * nF.r) * (0.9 + 0.2 * nM.g);
  slab *= 1.0 - 0.3 * joint;
  slab = mix(slab, uC2, 0.55 * (1.0 - smoothstep(2.0, 46.0, gD)) * (0.5 + 0.5 * nM.r));
  float park = smoothstep(0.63, 0.7, gMac) * smoothstep(30.0, 52.0, gD);
  slab = mix(slab, uC3 * (0.7 + 0.6 * nF.r) * (0.85 + 0.3 * nM.g), park);
  gAlb = slab;
`;

const KIND_CODE = [KIND_GRASS, KIND_DESERT, KIND_DUNES, KIND_STREET];

function buildFrag(kind: Kind): string {
  return /* glsl */ `
vec2 gP = vSiteXZ;
vec4 gS = siteSample();
float gD = max((1.0 - gS.r) * ${(SITE_NEAR_RANGE + SITE_NEAR_LEAD).toFixed(1)} - ${SITE_NEAR_LEAD.toFixed(1)}, 0.0);
vec4 nF = texture2D(uNoise, gP * 0.3448);
vec4 nM = texture2D(uNoise, gP * 0.03226 + 0.37);
vec4 nL = texture2D(uNoise, gMacroUv(gP));
float gMac = nL.g * 0.55 + nL.b * 0.45;
float gPat = nM.g * 0.55 + nM.b * 0.45;
vec3 gAlb = vec3(1.0);
${KIND_CODE[kind]}
float bw = max(fwidth(gS.b), 0.04);
float gPaved = smoothstep(0.5 - bw, 0.5 + bw, gS.b);
vec3 asph = uAsphalt * (0.85 + 0.3 * nF.g) * (0.92 + 0.16 * nM.b);
vec2 jq = vec2(dot(gP, uAx), dot(gP, uAcross)) * 0.15625;
vec2 jf = abs(fract(jq) - 0.5);
float jw2 = fwidth(jq.x) + fwidth(jq.y);
asph *= 1.0 - 0.16 * smoothstep(0.482 - jw2, 0.5, max(jf.x, jf.y)) * (1.0 - smoothstep(0.3, 1.0, jw2));
float rim = gPaved * (1.0 - smoothstep(0.5 + bw, 0.78 + bw, gS.b));
asph = mix(asph, asph * 1.5 + 0.015, rim * 0.5);
gAlb = mix(gAlb, asph, gPaved);
diffuseColor.rgb *= gAlb;
`;
}

const FRAG_RELIEF = /* glsl */ `
#include <normal_fragment_maps>
if (uRelief > 0.0) {
  float rh0 = gMacroH(gP);
  float rhx = gMacroH(gP + vec2(12.0, 0.0));
  float rhz = gMacroH(gP + vec2(0.0, 12.0));
  float rflat = (1.0 - gPaved) * smoothstep(0.0, 30.0, gD);
  vec2 slope = vec2(rhx - rh0, rhz - rh0) * (uRelief / 12.0) * rflat;
  normal = normalize((viewMatrix * vec4(normalize(vec3(-slope.x, 1.0, -slope.y)), 0.0)).xyz);
}
`;

/* ------------------------------------------------------------------ */
/* Ground                                                              */
/* ------------------------------------------------------------------ */

export interface GroundHandle {
  mesh: THREE.Mesh;
  dispose(): void;
}

export function createGround(circuit: CircuitData, quality: ModelQuality, size: number, heading0: number): GroundHandle {
  const pal = PALETTES[circuit.theme];
  const noiseSize = quality === 'low' ? 128 : 256;
  const noise = new THREE.DataTexture(noiseBytes(noiseSize), noiseSize, noiseSize, THREE.RGBAFormat, THREE.UnsignedByteType);
  noise.colorSpace = THREE.NoColorSpace;
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  noise.magFilter = THREE.LinearFilter;
  noise.minFilter = THREE.LinearMipmapLinearFilter;
  noise.generateMipmaps = true;
  noise.anisotropy = quality === 'low' ? 2 : quality === 'medium' ? 4 : 8;
  noise.needsUpdate = true;

  const relief = quality === 'low' ? 0 : pal.relief;
  const uniforms = {
    uNoise: { value: noise },
    uC0: { value: new THREE.Color(pal.c[0]) },
    uC1: { value: new THREE.Color(pal.c[1]) },
    uC2: { value: new THREE.Color(pal.c[2]) },
    uC3: { value: new THREE.Color(pal.c[3]) },
    uC4: { value: new THREE.Color(pal.c[4]) },
    uAsphalt: { value: new THREE.Color(pal.asphalt) },
    uGlow: { value: new THREE.Color(GLOW) },
    uAx: { value: new THREE.Vector2(Math.cos(heading0), -Math.sin(heading0)) },
    uAcross: { value: new THREE.Vector2(Math.sin(heading0), Math.cos(heading0)) },
    uRelief: { value: relief },
  };

  const mat = new THREE.MeshLambertMaterial({
    color: TINT[circuit.timeOfDay],
    // Sit behind the road ribbons so distant depth precision never lets the grass through.
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  const withRelief = relief > 0;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    injectSiteLight(shader, {
      pool: 0.22,
      dark: pal.kind === 3 ? 0.2 : 0.1,
      extra: `diffuseColor.rgb *= mix(1.0, 0.62, siteK * siteLit); totalEmissiveRadiance += gAlb * uGlow * (siteS.a * siteK * ${GLOW_GAIN[pal.kind]});`,
    });
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <map_fragment>', buildFrag(pal.kind));
    if (withRelief) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', FRAG_RELIEF);
  };
  mat.customProgramCacheKey = () => `pulse-ground|${pal.kind}|${withRelief ? 1 : 0}`;

  const geometry = new THREE.PlaneGeometry(size, size);
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = 'ground';
  mesh.userData.noCollide = true;
  mesh.rotation.x = -Math.PI / 2;
  const b = circuit.bounds;
  mesh.position.set((b.minX + b.maxX) / 2, -0.08, -(b.minY + b.maxY) / 2);
  mesh.receiveShadow = quality === 'high';

  return {
    mesh,
    dispose() {
      geometry.dispose();
      mat.dispose();
      noise.dispose();
    },
  };
}
