/**
 * A number input's step is counted from its min (the HTML "step base"), so `min={1} step={1000}`
 * makes every round number invalid — the browser refuses 600000 with "Enter a valid value".
 * Guard the whole tree against that class of bug.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const DIRS = ["app", "components"];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

/** Numeric literal in a JSX attribute: min={0.1} or min="0.1". */
const attr = (tag: string, name: string) =>
  new RegExp(`${name}=(?:\\{([\\d.]+)\\}|"([\\d.]+)")`).exec(tag)?.slice(1).find(Boolean);

describe("number inputs", () => {
  const inputs = DIRS.flatMap((d) => tsxFiles(join(ROOT, d))).flatMap((file) => {
    const src = readFileSync(file, "utf8");
    return [...src.matchAll(/<input[^>]*type="number"[^>]*>/g)].map((m) => ({
      file: file.slice(ROOT.length + 1),
      line: src.slice(0, m.index).split("\n").length,
      tag: m[0],
    }));
  });

  it("finds the number inputs to check", () => {
    expect(inputs.length).toBeGreaterThan(0);
  });

  it.each(inputs)("$file:$line accepts values a multiple of step", ({ tag }) => {
    const step = attr(tag, "step");
    const min = attr(tag, "min");
    if (!step || !min) return;
    // Work in integers: floats (step={0.05}) lose exactness otherwise.
    const scale = 10 ** Math.max(...[step, min].map((v) => (v.split(".")[1] ?? "").length));
    expect(Math.round(Number(min) * scale) % Math.round(Number(step) * scale)).toBe(0);
  });
});
