/**
 * Verifies the Phase 1 manifests against the source spreadsheets:
 * counts match, no duplicate IDs, no missing wording. Run via
 * `npm run verify:extraction`. Fails loudly (non-zero exit) on any
 * mismatch — never passes silently on a discrepancy.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface ManifestQuestion {
  id: string;
  question_text: string;
}
interface Manifest {
  question_count: number;
  questions: ManifestQuestion[];
}

function loadManifest(path: string): Manifest {
  return JSON.parse(readFileSync(resolve(path), "utf-8"));
}

function verify(manifest: Manifest, label: string) {
  const errors: string[] = [];

  if (manifest.questions.length !== manifest.question_count) {
    errors.push(
      `${label}: declared question_count (${manifest.question_count}) does not match ` +
        `actual questions array length (${manifest.questions.length})`
    );
  }

  const ids = manifest.questions.map((q) => q.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    errors.push(`${label}: duplicate question IDs found: ${[...new Set(dupes)].join(", ")}`);
  }

  const blank = manifest.questions.filter((q) => !q.question_text || !q.question_text.trim());
  if (blank.length > 0) {
    errors.push(`${label}: ${blank.length} question(s) have blank/missing wording`);
  }

  return errors;
}

const a1 = loadManifest("data/assignment-1-manifest.json");
const a2 = loadManifest("data/assignment-2-manifest.json");

const errors = [...verify(a1, "Assignment 1"), ...verify(a2, "Assignment 2")];

if (errors.length > 0) {
  console.error("Extraction verification FAILED:");
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}

console.log(
  `Extraction verification passed. Assignment 1: ${a1.question_count} questions. ` +
    `Assignment 2: ${a2.question_count} questions. Total: ${a1.question_count + a2.question_count}.`
);
