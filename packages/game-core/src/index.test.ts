import { describe, expect, it } from "vitest";

import {
  calculateInvalidStreakPenalty,
  createRoomCode,
  getAnswerOutcome,
  pickRoundLetter,
  scoreAnswer,
  scoreOutcome,
} from "./index";

describe("scoreAnswer", () => {
  it("scores a valid answer as 10 points", () => {
    expect(scoreAnswer({ verdict: "valid" })).toBe(10);
  });

  it("scores a duplicate answer as 5 points", () => {
    expect(scoreAnswer({ verdict: "duplicate" })).toBe(5);
  });

  it("scores a spelling/accent variant as half score", () => {
    expect(scoreAnswer({ verdict: "variant" })).toBe(5);
  });

  it("scores an invalid answer as 0 points", () => {
    expect(scoreAnswer({ verdict: "invalid" })).toBe(0);
  });

  it("scores a blank answer as 0 points", () => {
    expect(scoreAnswer({ verdict: "blank" })).toBe(0);
  });

  it("scores a reviewable answer as 0 provisional points", () => {
    expect(scoreAnswer({ verdict: "disputed" })).toBe(0);
  });
});

describe("calculateInvalidStreakPenalty", () => {
  it("does not penalize fewer than 3 invalid answers in a row", () => {
    expect(calculateInvalidStreakPenalty({ invalidStreak: 2 })).toBe(0);
  });

  it("deducts 5 points for 3 invalid answers in a row", () => {
    expect(calculateInvalidStreakPenalty({ invalidStreak: 3 })).toBe(-5);
  });
});

describe("player-facing scoring outcomes", () => {
  it("maps valid answers to Unique", () => {
    expect(getAnswerOutcome("valid")).toBe("unique");
    expect(scoreOutcome("unique")).toBe(10);
  });

  it("maps duplicate answers to Shared", () => {
    expect(getAnswerOutcome("duplicate")).toBe("shared");
    expect(scoreOutcome("shared")).toBe(5);
  });

  it("maps technical rejection reasons to No score", () => {
    expect(getAnswerOutcome("variant")).toBe("no_score");
    expect(getAnswerOutcome("invalid")).toBe("no_score");
    expect(getAnswerOutcome("blank")).toBe("no_score");
    expect(getAnswerOutcome("disputed")).toBe("no_score");
    expect(scoreOutcome("no_score")).toBe(0);
  });
});

describe("pickRoundLetter", () => {
  it("picks an uppercase round letter from provided letters", () => {
    expect(pickRoundLetter("a")).toBe("A");
  });

  it("rejects an empty letter set", () => {
    expect(() => pickRoundLetter("123")).toThrow("At least one letter is required.");
  });
});

describe("createRoomCode", () => {
  it("creates a room code with the requested length", () => {
    expect(createRoomCode(6)).toHaveLength(6);
  });

  it("creates secure-readable room codes without ambiguous characters", () => {
    expect(createRoomCode(30)).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
  });
});
