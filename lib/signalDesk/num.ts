/** A price or R as text: `.` decimals, no float noise (0.1 + 0.2 → "0.3"). Shared by the wire, the posts and the UI. */
export const num = (x: number) => String(Number(x.toPrecision(10)));
