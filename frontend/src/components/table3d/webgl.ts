export function isWebGLAvailable(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false }) ||
      canvas.getContext("webgl", { failIfMajorPerformanceCaveat: false }) ||
      canvas.getContext("experimental-webgl", {
        failIfMajorPerformanceCaveat: false,
      });
    if (!gl) return false;
    const loseExt = (gl as WebGLRenderingContext).getExtension?.(
      "WEBGL_lose_context"
    );
    loseExt?.loseContext();
    return true;
  } catch {
    return false;
  }
}

