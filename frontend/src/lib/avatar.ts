import type { Role } from "./types";

export type HairStyle = "short" | "parted" | "bob" | "bun" | "textured";

export interface AvatarAppearance {
  skinColor: string;
  hairStyle: HairStyle;
  hairColor: string;
  shirtColor: string;
  trouserColor: string;
  idlePhase: number;
  idleSpeed: number;
}

const SKIN_TONES = [
  "#F1C7A8",
  "#E4B28E",
  "#D19A72",
  "#B97F58",
  "#96613E",
  "#72472C",
] as const;

const HAIR_STYLES: readonly HairStyle[] = [
  "short",
  "parted",
  "bob",
  "bun",
  "textured",
] as const;

const HAIR_COLORS = [
  "#1E1B18",
  "#2F241D",
  "#4A3728",
  "#6B4E35",
  "#3B3734",
  "#7C5C3E",
] as const;

const SHIRT_COLORS = [
  "#3B5B8C",
  "#4A6B5D",
  "#7A4F5B",
  "#5B6073",
  "#8A6548",
  "#3F6D78",
  "#6B5B7B",
  "#556B4E",
  "#7A5B47",
  "#4D647A",
] as const;

const TROUSER_COLORS = [
  "#334155",
  "#3F3F46",
  "#475569",
  "#44403C",
] as const;

const MODERATOR_SHIRT_COLOR = "#1E293B";

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mixHash(seed: number, salt: number): number {
  let x = (seed ^ salt) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * Generates deterministic, realistic low-poly appearance traits from participant id + name.
 * AI participants intentionally share the exact same appearance generator as human players.
 */
export function getParticipantAppearance(
  id: number,
  name: string,
  role: Role = "player"
): AvatarAppearance {
  const key = `${id}:${name.trim().toLowerCase()}`;
  const base = fnv1a32(key);

  const skinColor = SKIN_TONES[mixHash(base, 0x11111111) % SKIN_TONES.length];
  const hairStyle =
    HAIR_STYLES[mixHash(base, 0x22222222) % HAIR_STYLES.length];
  const hairColor =
    HAIR_COLORS[mixHash(base, 0x33333333) % HAIR_COLORS.length];
  const shirtColor =
    role === "moderator"
      ? MODERATOR_SHIRT_COLOR
      : SHIRT_COLORS[mixHash(base, 0x44444444) % SHIRT_COLORS.length];
  const trouserColor =
    TROUSER_COLORS[mixHash(base, 0x55555555) % TROUSER_COLORS.length];

  const phaseNorm = (mixHash(base, 0x66666666) % 1000) / 1000;
  const speedNorm = (mixHash(base, 0x77777777) % 1000) / 1000;

  return {
    skinColor,
    hairStyle,
    hairColor,
    shirtColor,
    trouserColor,
    idlePhase: phaseNorm * Math.PI * 2,
    idleSpeed: 0.88 + speedNorm * 0.26,
  };
}

