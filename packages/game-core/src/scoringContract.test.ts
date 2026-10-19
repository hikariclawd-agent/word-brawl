import { describe, expect, it } from "vitest";
import { findDuplicateAnswerKeys, normalizeAnswer, scoreAnswer } from "./index";

describe("approved scoring contract", () => {
  it.each([
    ["valid", 10],
    ["duplicate", 5],
    ["variant", 5],
    ["invalid", 0],
    ["blank", 0],
    ["disputed", 0],
  ] as const)("scores %s as %i points", (verdict, points) => {
    expect(scoreAnswer({ verdict })).toBe(points);
  });
});

describe("display formatting versus comparison normalisation", () => {
  it("keeps display formatting separate from the comparison key", () => {
    const submitted = "  Alice  ";

    expect(submitted).toBe("  Alice  ");
    expect(normalizeAnswer(submitted)).toBe("alice");
  });

  it.each([
    ["  Alice  ", "alice"],
    ["ALICE", "alice"],
    ["New   York", "newyork"],
  ])("normalises case and whitespace for duplicate comparison", (input, expected) => {
    expect(normalizeAnswer(input)).toBe(expected);
  });

  it.each([
    ["Élodie", "elodie"],
    ["São Paulo", "saopaulo"],
    ["Łódź", "lodz"],
    ["München", "munchen"],
    ["N’Djamena", "ndjamena"],
  ])("folds explicitly mapped Latin characters and removes punctuation", (input, expected) => {
    expect(normalizeAnswer(input)).toBe(expected);
  });

  it("excludes blanks and scopes duplicate detection to a category", () => {
    expect(
      findDuplicateAnswerKeys([
        { playerId: "blank", category: "Name", text: "  " },
        { playerId: "first", category: "Name", text: "Alice" },
        { playerId: "second", category: "Name", text: " alice " },
        { playerId: "other-category", category: "Place", text: "Alice" },
      ]),
    ).toEqual(new Set(["first:Name", "second:Name"]));
  });
});
