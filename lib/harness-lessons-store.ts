// The lessons on disk (docs/architecture/goose.md).
//
// The pure half of the lesson store is lib/harness-lessons.ts; this is the fs half. The lessons live in
// ~/.weft/harness-lessons.json, one file, keyed by card and by project, so a card's next task starts from
// what its last task learned and a new card in the same project starts from the project's lessons.
//
// The write is atomic (a temp file then a rename), because the store is written from a thread's turn and
// a half-written file would lose every lesson on the board.
//
// This is the fs layer: no logic lives here beyond the read and the write.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store";
import { lessonKey, reinforceLesson, type Lesson } from "./harness-lessons";

/** The lessons, as they sit on disk. */
interface LessonFile {
  // Per card, by card id.
  cards?: Record<string, Lesson[]>;
  // Per project, by the project's folder path.
  projects?: Record<string, Lesson[]>;
}

// Read when used, not at import, so a route that only passes through here loads without the store.
const lessonsFile = () => path.join(DATA_DIR, "harness-lessons.json");

function readFile(): LessonFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(lessonsFile(), "utf8")) as LessonFile;
    return { cards: parsed.cards ?? {}, projects: parsed.projects ?? {} };
  } catch {
    return { cards: {}, projects: {} };
  }
}

/** The lessons as they are on disk, with a lesson that lost its fields dropped. */
function clean(lessons: unknown): Lesson[] {
  if (!Array.isArray(lessons)) return [];
  return lessons.filter((lesson): lesson is Lesson => {
    if (!lesson || typeof lesson !== "object") return false;
    const l = lesson as Partial<Lesson>;
    return typeof l.name === "string" && typeof l.surface === "string" && typeof l.claim === "string" && Boolean(l.evidence);
  });
}

function writeFile(file: LessonFile) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${lessonsFile()}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(file, null, 2));
  fs.renameSync(temp, lessonsFile());
}

/** A card's own lessons. */
export function cardLessons(cardId: string): Lesson[] {
  return clean(readFile().cards?.[cardId]);
}

/** A project's lessons: the ones every card in that folder starts from. */
export function projectLessons(project: string): Lesson[] {
  return clean(readFile().projects?.[project]);
}

/** The lessons a card starts a round with: its own, and its project's. */
export function lessonsForCard(cardId: string, project: string): Lesson[] {
  return [...cardLessons(cardId), ...projectLessons(project)];
}

/** A card's lessons, written back. */
export function saveCardLessons(cardId: string, lessons: Lesson[]): void {
  const file = readFile();
  file.cards = { ...file.cards, [cardId]: lessons };
  writeFile(file);
}

/** A project's lessons, written back. */
export function saveProjectLessons(project: string, lessons: Lesson[]): void {
  const file = readFile();
  file.projects = { ...file.projects, [project]: lessons };
  writeFile(file);
}

/** A lesson added to a card's set and its project's, by key: an existing lesson is reinforced, not duplicated. */
export function recordLesson(cardId: string, project: string, lesson: Lesson, now = Date.now()): void {
  for (const [scope, key] of [
    [cardLessons(cardId), cardId] as const,
    [projectLessons(project), project] as const,
  ]) {
    const key2 = lessonKey(lesson.surface, lesson.name);
    const existing = scope.find((l) => lessonKey(l.surface, l.name) === key2);
    // The rule for how strong a lesson is lives in one place (reinforceLesson), so the store and the
    // pure module can never drift apart on what "held twice" means.
    let next: Lesson[];
    if (existing) {
      next = scope.map((l) => (lessonKey(l.surface, l.name) === key2 ? reinforceLesson(l, now) : l));
    } else {
      next = [...scope, lesson];
    }
    if (key === cardId) saveCardLessons(cardId, next);
    else saveProjectLessons(project, next);
  }
}
