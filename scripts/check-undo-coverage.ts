/**
 * §16.3 CI check (Stage 0): every action verb whose executor can return
 * `undoable: true` MUST have a registered undoer — an engineered inverse,
 * not a model behavior. A new verb merged without its inverse fails CI here,
 * before any runtime ever discovers the gap.
 *
 * Static by design: we read executors.ts source and flag each executor block
 * that contains an `undoable: true` literal, then require a matching entry in
 * the `undoers` registry (imported for real, so a typo'd key also fails).
 *
 * Run:  npx -y tsx scripts/check-undo-coverage.ts   (wired into npm test)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { executors, undoers } from "../agent/lib/nova/executors";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../agent/lib/nova/executors.ts"), "utf8");

// Slice the `executors` registry source into per-verb blocks: `async <verb>(`
// at the top level of the object literal.
const executorSection = source.slice(source.indexOf("export const executors"), source.indexOf("export const undoers"));
const blocks = new Map<string, string>();
const header = /async ([a-z_]+)\(/g;
let match: RegExpExecArray | null;
const marks: { verb: string; start: number }[] = [];
while ((match = header.exec(executorSection)) !== null) {
  marks.push({ verb: match[1], start: match.index });
}
marks.forEach((mark, index) => {
  blocks.set(mark.verb, executorSection.slice(mark.start, marks[index + 1]?.start ?? executorSection.length));
});

let failed = false;
const verbs = Object.keys(executors);

for (const verb of verbs) {
  const block = blocks.get(verb);
  if (!block) {
    console.error(`✗ ${verb}: executor block not found by the static parser — update check-undo-coverage.ts`);
    failed = true;
    continue;
  }
  const canBeUndoable = /undoable:\s*true/.test(block);
  const hasUndoer = verb in undoers && typeof undoers[verb as keyof typeof undoers] === "function";
  if (canBeUndoable && !hasUndoer) {
    console.error(`✗ ${verb}: executor can return undoable:true but registers NO undoer (§16.3 — engineered inverse required before merge)`);
    failed = true;
  } else if (!canBeUndoable && hasUndoer) {
    console.error(`✗ ${verb}: registers an undoer but never returns undoable:true — dead inverse or missing undoable flag`);
    failed = true;
  } else {
    console.log(`✓ ${verb}: ${canBeUndoable ? "undoable, inverse registered" : "irreversible by design, no inverse"}`);
  }
}

// The parser itself must have seen every verb the registry declares.
if (blocks.size !== verbs.length) {
  console.error(`✗ parser saw ${blocks.size} executor blocks but the registry has ${verbs.length} verbs`);
  failed = true;
}

if (failed) {
  console.error("\nUNDO COVERAGE CHECK FAILED");
  process.exit(1);
}
console.log(`\nUNDO COVERAGE CHECK PASSED — ${verbs.length} verbs audited.`);
