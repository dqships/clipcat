import { describe, expect, it } from "vitest";
import { applyCorrections, validateCorrections } from "./corrections";
import { words } from "./fixtures";

const w = words("a", "welcome to clip cat by dakwan");

describe("corrections", () => {
  it("keeps real one-word fixes and explains the rest", () => {
    const { fixes, errors } = validateCorrections(
      {
        corrections: [
          { index: 5, text: "DaQuan" },
          { index: 0, text: "welcome" },
          { index: 9, text: "x" },
          { index: 2, text: "Clip Cat" },
          { index: 5, text: "Dakwan" },
        ],
      },
      w,
    );
    expect([...fixes]).toEqual([["a-w5", "DaQuan"]]);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/no word 9/);
    expect(errors[1]).toMatch(/one word/);
    expect(errors[2]).toMatch(/twice/);
  });

  it("changes the text and remembers what was heard", () => {
    const fixed = applyCorrections(w, new Map([["a-w5", "DaQuan"]]));
    expect(fixed[5]).toMatchObject({ text: "DaQuan", heard: "dakwan", start: w[5]!.start });
    const again = applyCorrections(fixed, new Map([["a-w5", "Daquan"]]));
    expect(again[5]!.heard).toBe("dakwan");
  });
});
