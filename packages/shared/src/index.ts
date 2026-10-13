export const APP_NAME = "Word Brawl";

export const STARTER_CATEGORIES = [
  "Name",
  "Place",
  "Animal",
  "Food",
  "Object",
  "Job",
  "Brand",
] as const;

export type StarterCategory = (typeof STARTER_CATEGORIES)[number];

export const DEFAULT_ROUND_SECONDS = 90;
