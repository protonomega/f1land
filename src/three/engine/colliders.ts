import * as THREE from 'three';

/**
 * Camera occlusion proxies derived from the static scenery (grandstands,
 * buildings, trees, landmarks, pit complex).
 *
 * Props are baked into a few huge vertex-coloured meshes plus instanced
 * trees, so per-mesh boxes would be useless. Instead every sizeable triangle
 * is rasterised into a sparse 2D height-field (3 m cells, 3×3 coverage
 * samples per cell): up-facing triangles give the roof height and a coverage
 * mask, walls and undersides give the lowest solid Y (so bridges and canopies
 * can be passed under). A cell only counts as solid when ≥ 4 of its 9 samples
 * are covered, which drops poles, fences, lattice masts and other thin
 * features a camera may safely brush past. Queries are 2D grid walks.
 */

const CELL = 3;
const SUB = 3;
const SAMPLE = CELL / SUB;
const TILE_BITS = 5;
const TILE = 1 << TILE_BITS;
const TILE_MASK = TILE - 1;
const MIN_HITS = 4;
/** Lowest roof that still blocks a camera. */
const MIN_TOP = 3;
/** Triangles entirely below this never contribute (ground decals, kerbs, barriers). */
const MIN_Y = 2;
/** Backdrops and sky-sized triangles are not occluders. */
const MAX_SPAN = 400;
const MAX_STEPS = 4096;
const BIT_COUNT = new Uint8Array(1 << (SUB * SUB));
for (let i = 1; i < BIT_COUNT.length; i++) BIT_COUNT[i] = BIT_COUNT[i >> 1]! + (i & 1);

/** Props that never occlude (backdrop, crowds, thin masts, the cameras' own towers). */
const SKIP_NAME = /^(sky-dome|mountains|crowd|halos|tv-towers|lamp-posts|marshal-posts|light-towers|gantry-lamps|boats-|ferris-gondolas|pit-screen)/;

interface Tile {
  /** Coverage bit per sample; dropped after `finish()`. */
  mask: Uint16Array | null;
  /** Roof height per cell; 0 = empty. */
  top: Float32Array;
  /** Lowest solid Y per cell. */
  bot: Float32Array;
}

const _m = new THREE.Matrix4();
const _box = new THREE.Box3();

export class SceneColliders {
  private readonly tiles = new Map<number, Tile>();
  private lastKey = -1;
  private lastTile: Tile | null = null;
  private count = 0;

  /** Number of solid cells. */
  get size(): number {
    return this.count;
  }

  clear(): void {
    this.tiles.clear();
    this.lastKey = -1;
    this.lastTile = null;
    this.count = 0;
  }

  dispose(): void {
    this.clear();
  }

  /** Rasterises every visible static mesh under `roots` (call once the scenery is final). */
  build(roots: readonly THREE.Object3D[]): void {
    this.clear();
    for (const root of roots) {
      root.updateWorldMatrix(true, true);
      this.visit(root);
    }
    this.finish();
  }

  /**
   * Fraction (0..1) along from→to of the first obstruction, or 1 when clear.
   * Hits within `skipEnd` metres of `to` are ignored (the subject sits near
   * barriers and stands); `radius` fattens the ray vertically.
   */
  segmentHit(from: THREE.Vector3, to: THREE.Vector3, radius = 0.35, skipEnd = 0): number {
    if (!this.count) return 1;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-4) return 1;
    const tEnd = 1 - skipEnd / len;
    if (tEnd <= 0) return 1;

    let cx = Math.floor(from.x / CELL);
    let cz = Math.floor(from.z / CELL);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? CELL / Math.abs(dx) : Infinity;
    const tDeltaZ = dz !== 0 ? CELL / Math.abs(dz) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? cx + 1 : cx) * CELL - from.x) / dx : Infinity;
    let tMaxZ = dz !== 0 ? ((dz > 0 ? cz + 1 : cz) * CELL - from.z) / dz : Infinity;
    let t = 0;
    for (let n = 0; n < MAX_STEPS; n++) {
      const tNext = Math.min(tMaxX, tMaxZ, tEnd);
      const tile = this.tile(cx >> TILE_BITS, cz >> TILE_BITS);
      if (tile) {
        const i = (cz & TILE_MASK) * TILE + (cx & TILE_MASK);
        const top = tile.top[i]!;
        if (top > 0) {
          const y0 = from.y + dy * t;
          const y1 = from.y + dy * tNext;
          if (Math.max(y0, y1) + radius >= tile.bot[i]! && Math.min(y0, y1) - radius <= top) return Math.max(0, t);
        }
      }
      if (tNext >= tEnd) break;
      if (tMaxX < tMaxZ) {
        cx += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
      } else {
        cz += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
      }
    }
    return 1;
  }

  /** Is the point inside (or within `pad` metres of) scenery? */
  pointBlocked(p: THREE.Vector3, pad = 0): boolean {
    if (!this.count) return false;
    const x0 = Math.floor((p.x - pad) / CELL);
    const x1 = Math.floor((p.x + pad) / CELL);
    const z0 = Math.floor((p.z - pad) / CELL);
    const z1 = Math.floor((p.z + pad) / CELL);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const tile = this.tile(cx >> TILE_BITS, cz >> TILE_BITS);
        if (!tile) continue;
        const i = (cz & TILE_MASK) * TILE + (cx & TILE_MASK);
        const top = tile.top[i]!;
        if (top > 0 && p.y <= top + pad && p.y >= tile.bot[i]! - pad) return true;
      }
    }
    return false;
  }

  /** Highest roof (world Y) of scenery within `radius` of (x, z); 0 when there is none. */
  topNear(x: number, z: number, radius: number): number {
    if (!this.count) return 0;
    const x0 = Math.floor((x - radius) / CELL);
    const x1 = Math.floor((x + radius) / CELL);
    const z0 = Math.floor((z - radius) / CELL);
    const z1 = Math.floor((z + radius) / CELL);
    const r2 = radius * radius;
    let best = 0;
    for (let cz = z0; cz <= z1; cz++) {
      const nz = Math.min(Math.max(z, cz * CELL), (cz + 1) * CELL) - z;
      for (let cx = x0; cx <= x1; cx++) {
        const nx = Math.min(Math.max(x, cx * CELL), (cx + 1) * CELL) - x;
        if (nx * nx + nz * nz > r2) continue;
        const tile = this.tile(cx >> TILE_BITS, cz >> TILE_BITS);
        if (!tile) continue;
        const top = tile.top[(cz & TILE_MASK) * TILE + (cx & TILE_MASK)]!;
        if (top > best) best = top;
      }
    }
    return best;
  }

  /** Wireframe boxes of every solid cell (dev: `?colliders=1`). */
  debugMesh(): THREE.Object3D {
    const geo = new THREE.BoxGeometry(CELL, 1, CELL);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff2d55, wireframe: true, transparent: true, opacity: 0.55, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, this.count));
    const m = new THREE.Matrix4();
    let n = 0;
    for (const [key, tile] of this.tiles) {
      const tx = Math.floor(key / 4096) - 2048;
      const tz = (key % 4096) - 2048;
      for (let i = 0; i < TILE * TILE; i++) {
        const top = tile.top[i]!;
        if (top <= 0) continue;
        const bot = Math.min(tile.bot[i]!, top - 0.1);
        const cx = (tx << TILE_BITS) + (i & TILE_MASK);
        const cz = (tz << TILE_BITS) + (i >> TILE_BITS);
        m.makeScale(1, top - bot, 1).setPosition((cx + 0.5) * CELL, (top + bot) / 2, (cz + 0.5) * CELL);
        mesh.setMatrixAt(n++, m);
      }
    }
    mesh.count = n;
    mesh.frustumCulled = false;
    mesh.name = 'colliders-debug';
    return mesh;
  }

  /* ---------------- build ---------------- */

  private tile(tx: number, tz: number): Tile | null {
    const key = (tx + 2048) * 4096 + (tz + 2048);
    if (key === this.lastKey) return this.lastTile;
    this.lastKey = key;
    this.lastTile = this.tiles.get(key) ?? null;
    return this.lastTile;
  }

  private tileFor(tx: number, tz: number): Tile {
    let t = this.tile(tx, tz);
    if (!t) {
      t = { mask: new Uint16Array(TILE * TILE), top: new Float32Array(TILE * TILE), bot: new Float32Array(TILE * TILE).fill(Infinity) };
      this.tiles.set((tx + 2048) * 4096 + (tz + 2048), t);
      this.lastTile = t;
    }
    return t;
  }

  private visit(o: THREE.Object3D): void {
    if (!o.visible || o.userData.noCollide || SKIP_NAME.test(o.name)) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!mat || !(mat.transparent && !mat.depthWrite)) this.addMesh(mesh);
    }
    for (const c of o.children) this.visit(c);
  }

  private addMesh(mesh: THREE.Mesh): void {
    const geo = mesh.geometry;
    const attr = geo.getAttribute('position');
    if (!attr || attr.itemSize < 3) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;

    let arr: ArrayLike<number>;
    let stride = attr.itemSize;
    let off = 0;
    const ia = attr as unknown as { isInterleavedBufferAttribute?: boolean; data: { array: ArrayLike<number>; stride: number }; offset: number };
    if (ia.isInterleavedBufferAttribute) {
      arr = ia.data.array;
      stride = ia.data.stride;
      off = ia.offset;
    } else {
      arr = attr.array;
    }
    const index = geo.index ? geo.index.array : null;
    const count = index ? index.length : attr.count;
    const nor = geo.getAttribute('normal');

    if (!inst) {
      _box.copy(bb).applyMatrix4(mesh.matrixWorld);
      if (_box.max.y < MIN_TOP) return;
      this.rasterise(arr, stride, off, index, count, nor, mesh.matrixWorld, false);
      return;
    }
    // Instances (trees, bushes): roofs only — walls/undersides stay grounded.
    for (let i = 0; i < inst.count; i++) {
      inst.getMatrixAt(i, _m);
      _m.premultiply(mesh.matrixWorld);
      _box.copy(bb).applyMatrix4(_m);
      if (_box.max.y < MIN_TOP) continue;
      this.rasterise(arr, stride, off, index, count, nor, _m, true);
    }
  }

  private rasterise(
    arr: ArrayLike<number>,
    stride: number,
    off: number,
    index: ArrayLike<number> | null,
    count: number,
    nor: THREE.BufferGeometry['attributes'][string] | undefined,
    m: THREE.Matrix4,
    roofsOnly: boolean,
  ): void {
    const e = m.elements;
    const det = m.determinant() < 0 ? -1 : 1;
    for (let t = 0; t + 2 < count; t += 3) {
      const i0 = (index ? index[t]! : t) * stride + off;
      const i1 = (index ? index[t + 1]! : t + 1) * stride + off;
      const i2 = (index ? index[t + 2]! : t + 2) * stride + off;
      const lx0 = arr[i0]!, ly0 = arr[i0 + 1]!, lz0 = arr[i0 + 2]!;
      const lx1 = arr[i1]!, ly1 = arr[i1 + 1]!, lz1 = arr[i1 + 2]!;
      const lx2 = arr[i2]!, ly2 = arr[i2 + 1]!, lz2 = arr[i2 + 2]!;
      const ay = e[1]! * lx0 + e[5]! * ly0 + e[9]! * lz0 + e[13]!;
      const by = e[1]! * lx1 + e[5]! * ly1 + e[9]! * lz1 + e[13]!;
      const cy = e[1]! * lx2 + e[5]! * ly2 + e[9]! * lz2 + e[13]!;
      const maxY = Math.max(ay, by, cy);
      if (maxY < MIN_Y) continue;
      const ax = e[0]! * lx0 + e[4]! * ly0 + e[8]! * lz0 + e[12]!;
      const az = e[2]! * lx0 + e[6]! * ly0 + e[10]! * lz0 + e[14]!;
      const bx = e[0]! * lx1 + e[4]! * ly1 + e[8]! * lz1 + e[12]!;
      const bz = e[2]! * lx1 + e[6]! * ly1 + e[10]! * lz1 + e[14]!;
      const cx = e[0]! * lx2 + e[4]! * ly2 + e[8]! * lz2 + e[12]!;
      const cz = e[2]! * lx2 + e[6]! * ly2 + e[10]! * lz2 + e[14]!;
      const minX = Math.min(ax, bx, cx);
      const maxX = Math.max(ax, bx, cx);
      const minZ = Math.min(az, bz, cz);
      const maxZ = Math.max(az, bz, cz);
      if (maxX - minX > MAX_SPAN || maxZ - minZ > MAX_SPAN) continue;
      // Geometric normal, oriented to agree with the authored vertex normal.
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let ny = uz * vx - ux * vz;
      const nx = uy * vz - uz * vy;
      const nz = ux * vy - uy * vx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len < 1e-6) continue;
      let sgn = 1;
      if (nor) {
        const lux = lx1 - lx0, luy = ly1 - ly0, luz = lz1 - lz0;
        const lvx = lx2 - lx0, lvy = ly2 - ly0, lvz = lz2 - lz0;
        const d =
          (luy * lvz - luz * lvy) * nor.getX(index ? index[t]! : t) +
          (luz * lvx - lux * lvz) * nor.getY(index ? index[t]! : t) +
          (lux * lvy - luy * lvx) * nor.getZ(index ? index[t]! : t);
        if (d < 0) sgn = -1;
      }
      ny *= sgn * det;
      const ky = ny / len;
      if (ky > 0.25) {
        this.roof(ax, ay, az, bx, bz, cx, cz, nx * sgn * det, ny, nz * sgn * det, minZ, maxZ);
      } else if (!roofsOnly && maxY >= MIN_Y) {
        const minY = Math.min(ay, by, cy);
        if (ky < -0.25) this.underside(ax, az, bx, bz, cx, cz, ay, by, cy, minX, maxX, minZ, maxZ);
        else this.wall(ax, az, bx, bz, cx, cz, minY);
      }
    }
  }

  /** Up-facing triangle: coverage mask + highest Y per cell. */
  private roof(
    ax: number, ay: number, az: number,
    bx: number, bz: number,
    cx: number, cz: number,
    nx: number, ny: number, nz: number,
    minZ: number, maxZ: number,
  ): void {
    const j0 = Math.ceil(minZ / SAMPLE - 0.5);
    const j1 = Math.floor(maxZ / SAMPLE - 0.5);
    const inv = 1 / ny;
    for (let j = j0; j <= j1; j++) {
      const z = (j + 0.5) * SAMPLE;
      let xl = Infinity;
      let xr = -Infinity;
      // Intersections of the scanline with the three edges.
      if ((az <= z && bz > z) || (bz <= z && az > z)) {
        const x = ax + ((z - az) / (bz - az)) * (bx - ax);
        if (x < xl) xl = x;
        if (x > xr) xr = x;
      }
      if ((bz <= z && cz > z) || (cz <= z && bz > z)) {
        const x = bx + ((z - bz) / (cz - bz)) * (cx - bx);
        if (x < xl) xl = x;
        if (x > xr) xr = x;
      }
      if ((cz <= z && az > z) || (az <= z && cz > z)) {
        const x = cx + ((z - cz) / (az - cz)) * (ax - cx);
        if (x < xl) xl = x;
        if (x > xr) xr = x;
      }
      if (xl > xr) continue;
      const i0 = Math.ceil(xl / SAMPLE - 0.5);
      const i1 = Math.floor(xr / SAMPLE - 0.5);
      const cellZ = Math.floor(j / SUB);
      const subZ = (j - cellZ * SUB) * SUB;
      for (let i = i0; i <= i1; i++) {
        const cellX = Math.floor(i / SUB);
        const tile = this.tileFor(cellX >> TILE_BITS, cellZ >> TILE_BITS);
        const k = (cellZ & TILE_MASK) * TILE + (cellX & TILE_MASK);
        const x = (i + 0.5) * SAMPLE;
        const y = ay - (nx * (x - ax) + nz * (z - az)) * inv;
        tile.mask![k]! |= 1 << (i - cellX * SUB + subZ);
        if (y > tile.top[k]!) tile.top[k] = y;
      }
    }
  }

  /** Down-facing triangle: lowest Y per cell (bridge decks, canopies). */
  private underside(
    ax: number, az: number, bx: number, bz: number, cx: number, cz: number,
    ay: number, by: number, cy: number,
    minX: number, maxX: number, minZ: number, maxZ: number,
  ): void {
    // Coarse: one conservative stamp at the lowest vertex over the triangle's cells.
    const y = Math.min(ay, by, cy);
    const c0x = Math.floor(minX / CELL);
    const c1x = Math.floor(maxX / CELL);
    const c0z = Math.floor(minZ / CELL);
    const c1z = Math.floor(maxZ / CELL);
    for (let z = c0z; z <= c1z; z++) {
      for (let x = c0x; x <= c1x; x++) {
        if (!triOverlapsCell(ax, az, bx, bz, cx, cz, x * CELL, z * CELL)) continue;
        const tile = this.tileFor(x >> TILE_BITS, z >> TILE_BITS);
        const k = (z & TILE_MASK) * TILE + (x & TILE_MASK);
        if (y < tile.bot[k]!) tile.bot[k] = y;
      }
    }
  }

  /** Near-vertical triangle: walk its XZ footprint, lowering the cell bottoms. */
  private wall(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, minY: number): void {
    let px = ax, pz = az, qx = bx, qz = bz;
    let best = (bx - ax) ** 2 + (bz - az) ** 2;
    const d2 = (cx - bx) ** 2 + (cz - bz) ** 2;
    if (d2 > best) {
      best = d2;
      px = bx; pz = bz; qx = cx; qz = cz;
    }
    if ((ax - cx) ** 2 + (az - cz) ** 2 > best) {
      px = cx; pz = cz; qx = ax; qz = az;
    }
    const len = Math.sqrt((qx - px) ** 2 + (qz - pz) ** 2);
    const n = Math.max(1, Math.ceil(len / (CELL * 0.5)));
    for (let s = 0; s <= n; s++) {
      const x = Math.floor((px + ((qx - px) * s) / n) / CELL);
      const z = Math.floor((pz + ((qz - pz) * s) / n) / CELL);
      const tile = this.tileFor(x >> TILE_BITS, z >> TILE_BITS);
      const k = (z & TILE_MASK) * TILE + (x & TILE_MASK);
      if (minY < tile.bot[k]!) tile.bot[k] = minY;
    }
  }

  /** Keeps only well-covered tall cells and resolves their solid Y range. */
  private finish(): void {
    let solid = 0;
    for (const [key, tile] of this.tiles) {
      const mask = tile.mask!;
      let any = false;
      for (let i = 0; i < TILE * TILE; i++) {
        const top = tile.top[i]!;
        if (top >= MIN_TOP && BIT_COUNT[mask[i]!]! >= MIN_HITS) {
          const b = tile.bot[i]!;
          tile.bot[i] = b < top - 0.5 ? Math.max(0, b) : 0;
          solid++;
          any = true;
        } else {
          tile.top[i] = 0;
        }
      }
      tile.mask = null;
      if (!any) this.tiles.delete(key);
    }
    this.count = solid;
    this.lastKey = -1;
    this.lastTile = null;
  }
}

/** Does the triangle (XZ) touch the CELL-sized square at (x0, z0)? */
function triOverlapsCell(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, x0: number, z0: number): boolean {
  const x1 = x0 + CELL;
  const z1 = z0 + CELL;
  // Any vertex inside the cell.
  if ((ax >= x0 && ax <= x1 && az >= z0 && az <= z1) || (bx >= x0 && bx <= x1 && bz >= z0 && bz <= z1) || (cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1)) return true;
  // Cell centre inside the triangle.
  const px = x0 + CELL / 2;
  const pz = z0 + CELL / 2;
  const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
  const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
  if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
  // Edges crossing the cell box (slab test).
  return segCrossesBox(ax, az, bx, bz, x0, z0, x1, z1) || segCrossesBox(bx, bz, cx, cz, x0, z0, x1, z1) || segCrossesBox(cx, cz, ax, az, x0, z0, x1, z1);
}

function segCrossesBox(ax: number, az: number, bx: number, bz: number, x0: number, z0: number, x1: number, z1: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  for (let k = 0; k < 2; k++) {
    const p = k ? dz : dx;
    const lo = (k ? z0 : x0) - (k ? az : ax);
    const hi = (k ? z1 : x1) - (k ? az : ax);
    if (Math.abs(p) < 1e-9) {
      if (lo > 0 || hi < 0) return false;
    } else {
      let a = lo / p;
      let b = hi / p;
      if (a > b) [a, b] = [b, a];
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
  }
  return true;
}
