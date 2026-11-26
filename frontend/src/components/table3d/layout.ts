export type Vec3 = [number, number, number];

export interface SeatTransform {
  index: number;
  angle: number;
  position: Vec3;
  rotationY: number;
}

export interface ModeratorTransform {
  angle: number;
  position: Vec3;
  rotationY: number;
  deskPosition: Vec3;
  deskRotationY: number;
}

export interface CameraConfig {
  position: Vec3;
  target: Vec3;
  minDistance: number;
  maxDistance: number;
}

export interface TableLayout {
  tableRadius: number;
  seatRadius: number;
  playerSeats: SeatTransform[];
  moderatorSeat: ModeratorTransform | null;
  cameraConfig: CameraConfig;
}

export interface ComputeTableLayoutOptions {
  totalPlayerSeats: number;
  hasModerator: boolean;
  localPlayerIndex: number;
  isLocalModerator: boolean;
  isCompact: boolean;
}

export function computeTableLayout({
  totalPlayerSeats,
  hasModerator,
  localPlayerIndex,
  isLocalModerator,
  isCompact,
}: ComputeTableLayoutOptions): TableLayout {
  const count = Math.max(2, totalPlayerSeats);

  const tableRadius =
    count <= 4 ? 1.25 : count <= 6 ? 1.5 : count <= 8 ? 1.8 : 2.05;
  const seatRadius = tableRadius + 0.68;

  const rawPlayerAngles: number[] = [];
  if (!hasModerator) {
    for (let i = 0; i < count; i += 1) {
      rawPlayerAngles.push((2 * Math.PI * i) / count);
    }
  } else {
    const totalRingSlots = count + 1;
    for (let i = 0; i < count; i += 1) {
      rawPlayerAngles.push((2 * Math.PI * (i + 1)) / totalRingSlots);
    }
  }

  let anchorRawAngle = rawPlayerAngles[0] ?? 0;
  if (isLocalModerator && hasModerator) {
    anchorRawAngle = 0;
  } else if (localPlayerIndex >= 0 && localPlayerIndex < rawPlayerAngles.length) {
    anchorRawAngle = rawPlayerAngles[localPlayerIndex];
  }

  const playerSeats: SeatTransform[] = rawPlayerAngles.map((rawAngle, index) => {
    const angle = rawAngle - anchorRawAngle;
    return {
      index,
      angle,
      position: [Math.sin(angle) * seatRadius, 0, Math.cos(angle) * seatRadius],
      rotationY: angle + Math.PI,
    };
  });

  let moderatorSeat: ModeratorTransform | null = null;
  if (hasModerator) {
    const modAngle = -anchorRawAngle;
    const modChairRadius = tableRadius + 1.18;
    const modDeskRadius = tableRadius + 0.65;
    moderatorSeat = {
      angle: modAngle,
      position: [
        Math.sin(modAngle) * modChairRadius,
        0,
        Math.cos(modAngle) * modChairRadius,
      ],
      rotationY: modAngle + Math.PI,
      deskPosition: [
        Math.sin(modAngle) * modDeskRadius,
        0,
        Math.cos(modAngle) * modDeskRadius,
      ],
      deskRotationY: modAngle + Math.PI,
    };
  }

  const camHeight = isCompact ? 2.85 : seatRadius * 0.45 + 1.75;
  const camBackOffset = isCompact ? 3.25 : 2.55;
  const cameraRadius =
    (isLocalModerator && hasModerator ? tableRadius + 1.18 : seatRadius) +
    camBackOffset;

  const cameraConfig: CameraConfig = {
    position: [0.32, camHeight, cameraRadius],
    target: [0, 0.86, -0.1],
    minDistance: Math.max(2.6, seatRadius + 0.85),
    maxDistance: seatRadius + 4.4,
  };

  return {
    tableRadius,
    seatRadius,
    playerSeats,
    moderatorSeat,
    cameraConfig,
  };
}

