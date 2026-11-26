import * as THREE from "three";

export interface SceneGeometries {
  chairSeat: THREE.BoxGeometry;
  chairBack: THREE.BoxGeometry;
  modChairBack: THREE.BoxGeometry;
  chairLeg: THREE.CylinderGeometry;
  chairSpine: THREE.BoxGeometry;
  floorRing: THREE.RingGeometry;
  torso: THREE.CylinderGeometry;
  shoulders: THREE.CapsuleGeometry;
  collar: THREE.CylinderGeometry;
  neck: THREE.CylinderGeometry;
  head: THREE.SphereGeometry;
  ear: THREE.SphereGeometry;
  eye: THREE.SphereGeometry;
  eyebrow: THREE.BoxGeometry;
  nose: THREE.SphereGeometry;
  mouth: THREE.SphereGeometry;
  pelvis: THREE.BoxGeometry;
  thigh: THREE.CapsuleGeometry;
  shin: THREE.CapsuleGeometry;
  shoe: THREE.BoxGeometry;
  upperArm: THREE.CapsuleGeometry;
  forearm: THREE.CapsuleGeometry;
  hand: THREE.SphereGeometry;
  hairCap: THREE.SphereGeometry;
  hairPartedTuft: THREE.BoxGeometry;
  hairBobSide: THREE.BoxGeometry;
  hairBobBack: THREE.BoxGeometry;
  hairBun: THREE.SphereGeometry;
  hairCurl: THREE.SphereGeometry;
  modDeskTop: THREE.BoxGeometry;
  modDeskLeg: THREE.BoxGeometry;
  modNotepad: THREE.BoxGeometry;
}

export interface StaticSceneMaterials {
  floor: THREE.MeshStandardMaterial;
  rug: THREE.MeshStandardMaterial;
  tableTop: THREE.MeshStandardMaterial;
  tableFrame: THREE.MeshStandardMaterial;
  chairFrame: THREE.MeshStandardMaterial;
  chairCushion: THREE.MeshStandardMaterial;
  modChairCushion: THREE.MeshStandardMaterial;
  modDeskTop: THREE.MeshStandardMaterial;
  notepadPaper: THREE.MeshStandardMaterial;
  collar: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
  mouth: THREE.MeshStandardMaterial;
  shoe: THREE.MeshStandardMaterial;
  speakingRing: THREE.MeshBasicMaterial;
  thinkingRing: THREE.MeshBasicMaterial;
}

export interface SceneAssets {
  geometries: SceneGeometries;
  materials: StaticSceneMaterials;
  getMat: (color: string, roughness?: number) => THREE.MeshStandardMaterial;
  dispose: () => void;
}

export function createSceneAssets(): SceneAssets {
  const geometries: SceneGeometries = {
    chairSeat: new THREE.BoxGeometry(0.42, 0.05, 0.4),
    chairBack: new THREE.BoxGeometry(0.38, 0.36, 0.045),
    modChairBack: new THREE.BoxGeometry(0.42, 0.44, 0.05),
    chairLeg: new THREE.CylinderGeometry(0.018, 0.016, 0.42, 8),
    chairSpine: new THREE.BoxGeometry(0.04, 0.28, 0.025),
    floorRing: new THREE.RingGeometry(0.42, 0.52, 32),

    torso: new THREE.CylinderGeometry(0.16, 0.145, 0.42, 12),
    shoulders: new THREE.CapsuleGeometry(0.065, 0.28, 4, 8),
    collar: new THREE.CylinderGeometry(0.088, 0.098, 0.05, 10),
    neck: new THREE.CylinderGeometry(0.045, 0.052, 0.09, 10),
    head: new THREE.SphereGeometry(0.135, 16, 14),
    ear: new THREE.SphereGeometry(0.026, 8, 8),
    eye: new THREE.SphereGeometry(0.015, 8, 8),
    eyebrow: new THREE.BoxGeometry(0.036, 0.009, 0.012),
    nose: new THREE.SphereGeometry(0.018, 8, 8),
    mouth: new THREE.SphereGeometry(0.022, 10, 8),

    pelvis: new THREE.BoxGeometry(0.27, 0.09, 0.19),
    thigh: new THREE.CapsuleGeometry(0.056, 0.24, 4, 8),
    shin: new THREE.CapsuleGeometry(0.045, 0.26, 4, 8),
    shoe: new THREE.BoxGeometry(0.085, 0.048, 0.145),

    upperArm: new THREE.CapsuleGeometry(0.043, 0.18, 4, 8),
    forearm: new THREE.CapsuleGeometry(0.036, 0.17, 4, 8),
    hand: new THREE.SphereGeometry(0.036, 8, 8),

    hairCap: new THREE.SphereGeometry(
      0.142,
      14,
      10,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.58
    ),
    hairPartedTuft: new THREE.BoxGeometry(0.17, 0.05, 0.18),
    hairBobSide: new THREE.BoxGeometry(0.045, 0.18, 0.18),
    hairBobBack: new THREE.BoxGeometry(0.25, 0.2, 0.07),
    hairBun: new THREE.SphereGeometry(0.056, 10, 10),
    hairCurl: new THREE.SphereGeometry(0.052, 8, 8),

    modDeskTop: new THREE.BoxGeometry(0.84, 0.04, 0.44),
    modDeskLeg: new THREE.BoxGeometry(0.04, 0.7, 0.04),
    modNotepad: new THREE.BoxGeometry(0.22, 0.012, 0.28),
  };

  const materials: StaticSceneMaterials = {
    floor: new THREE.MeshStandardMaterial({
      color: "#E6EBF1",
      roughness: 0.94,
      metalness: 0.0,
    }),
    rug: new THREE.MeshStandardMaterial({
      color: "#DDE4EC",
      roughness: 0.96,
      metalness: 0.0,
    }),
    tableTop: new THREE.MeshStandardMaterial({
      color: "#C9B59C",
      roughness: 0.78,
      metalness: 0.04,
    }),
    tableFrame: new THREE.MeshStandardMaterial({
      color: "#64748B",
      roughness: 0.72,
      metalness: 0.12,
    }),
    chairFrame: new THREE.MeshStandardMaterial({
      color: "#475569",
      roughness: 0.72,
      metalness: 0.15,
    }),
    chairCushion: new THREE.MeshStandardMaterial({
      color: "#334155",
      roughness: 0.88,
      metalness: 0.02,
    }),
    modChairCushion: new THREE.MeshStandardMaterial({
      color: "#1E293B",
      roughness: 0.85,
      metalness: 0.04,
    }),
    modDeskTop: new THREE.MeshStandardMaterial({
      color: "#B8A287",
      roughness: 0.8,
      metalness: 0.04,
    }),
    notepadPaper: new THREE.MeshStandardMaterial({
      color: "#F8FAFC",
      roughness: 0.95,
      metalness: 0.0,
    }),
    collar: new THREE.MeshStandardMaterial({
      color: "#F8FAFC",
      roughness: 0.88,
      metalness: 0.0,
    }),
    eye: new THREE.MeshStandardMaterial({
      color: "#1E293B",
      roughness: 0.5,
      metalness: 0.0,
    }),
    mouth: new THREE.MeshStandardMaterial({
      color: "#5C2B2B",
      roughness: 0.85,
      metalness: 0.0,
    }),
    shoe: new THREE.MeshStandardMaterial({
      color: "#1E293B",
      roughness: 0.82,
      metalness: 0.05,
    }),
    speakingRing: new THREE.MeshBasicMaterial({
      color: "#1E40AF",
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
    thinkingRing: new THREE.MeshBasicMaterial({
      color: "#64748B",
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  };

  const pooledMaterials = new Map<string, THREE.MeshStandardMaterial>();

  const getMat = (
    color: string,
    roughness = 0.84
  ): THREE.MeshStandardMaterial => {
    const key = `${color}:${roughness.toFixed(2)}`;
    const existing = pooledMaterials.get(key);
    if (existing) return existing;
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness: 0.02,
    });
    pooledMaterials.set(key, mat);
    return mat;
  };

  const dispose = () => {
    Object.values(geometries).forEach((geo: THREE.BufferGeometry) => {
      geo.dispose();
    });
    Object.values(materials).forEach((mat: THREE.Material) => {
      mat.dispose();
    });
    pooledMaterials.forEach((mat) => {
      mat.dispose();
    });
    pooledMaterials.clear();
  };

  return {
    geometries,
    materials,
    getMat,
    dispose,
  };
}

