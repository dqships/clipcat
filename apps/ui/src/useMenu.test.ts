import { afterEach, describe, expect, it } from "vitest";
import { typing } from "./useMenu";

afterEach(() => {
  document.body.innerHTML = "";
});

const focus = (html: string) => {
  document.body.innerHTML = html;
  (document.body.firstElementChild as HTMLElement).focus();
};

describe("typing", () => {
  it("is true in a text box", () => {
    focus('<input type="text">');
    expect(typing()).toBe(true);
    focus("<textarea></textarea>");
    expect(typing()).toBe(true);
  });

  it("is false on a checkbox, a slider or a button", () => {
    for (const type of ["checkbox", "range", "button"]) {
      focus(`<input type="${type}">`);
      expect(typing(), type).toBe(false);
    }
    focus("<button>Go</button>");
    expect(typing()).toBe(false);
  });
});
