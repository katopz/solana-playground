import {
  PgFramework,
  PgLanguage,
  TutorialLevel,
  TUTORIAL_LEVELS,
} from "../../../../utils/pg";

/** All tutorial filters */
export const FILTERS = [
  {
    param: "level",
    filters: TUTORIAL_LEVELS,
    sortFn: sortByLevel,
  },
  {
    param: "framework",
    filters: PgFramework.all.map((f) => f.name),
  },
  {
    param: "languages",
    filters: PgLanguage.all.map((lang) => lang.name),
  },
  // TODO: Enable once there are more tutorials with various categories
  // {
  //   param: "categories",
  //   filters: TUTORIAL_CATEGORIES,
  // },
] as const;

/** Sort based on `TutorialLevel`. */
export function sortByLevel<T extends { level: TutorialLevel }>(a: T, b: T) {
  return TUTORIAL_LEVELS.indexOf(a.level) - TUTORIAL_LEVELS.indexOf(b.level);
}
