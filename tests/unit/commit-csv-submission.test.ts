import { describe, expect, it, vi } from "vitest";
import {
  buildCsvQuestionKey,
  buildCsvTemplate,
  commitCsvSubmission,
  parseCsvAnswers,
  QUESTION_KEY_HEADERS,
  type CsvQuestion,
} from "@/lib/attempts/commit-csv-submission";

/**
 * The CSV submission core. These tests pin the validation contract the
 * whole Part 2/Part 3 design rests on: a file is either completely valid
 * and submitted, or rejected with every problem named — never partially
 * written, never coerced into something plausible.
 */

const questions: CsvQuestion[] = [
  { id: "q1", externalQuestionCode: "A1-001", questionText: "Solar — Conventional", displayOrder: 1 },
  { id: "q2", externalQuestionCode: "A1-002", questionText: "Solar — Renewable", displayOrder: 2 },
  { id: "q3", externalQuestionCode: "A1-003", questionText: "Wind — Conventional", displayOrder: 3 },
];

const header = "A1-001,A1-002,A1-003";

function fakeClient(overrides: { save?: unknown; submit?: unknown } = {}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "save_attempt_responses") {
      return overrides.save ?? { data: { saved: 3 }, error: null };
    }
    if (name === "submit_attempt") {
      return (
        overrides.submit ?? {
          data: {
            attemptId: "attempt-1",
            state: "SUBMITTED",
            submittedAt: "2026-07-28T00:00:00Z",
            submissionVersion: 1,
            answered: 3,
            totalQuestions: 3,
          },
          error: null,
        }
      );
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  return { rpc } as never;
}

// ============================================================
// Template
// ============================================================

describe("buildCsvTemplate", () => {
  it("uses question codes as headers, in display order", () => {
    const csv = buildCsvTemplate([...questions].reverse());
    const firstLine = csv.split("\r\n")[0];
    expect(firstLine).toBe("A1-001,A1-002,A1-003");
  });

  it("carries the question wording verbatim, never retyped", () => {
    const csv = buildCsvTemplate(questions);
    expect(csv).toContain("Solar — Conventional");
    expect(csv).toContain("Wind — Conventional");
  });

  it("round-trips: an untouched template is rejected as having no answers", () => {
    const parsed = parseCsvAnswers(buildCsvTemplate(questions), questions);
    expect(parsed.answers).toHaveLength(0);
    // Its headers are all recognised — the file is well-formed, just empty.
    expect(parsed.unknownColumns).toEqual([]);
    expect(parsed.issues.some((i) => i.message.includes("no answers underneath"))).toBe(true);
  });

  it("still reports blanks per column when the sheet is partly filled", () => {
    // The whole-row shortcut above must not mask a half-finished sheet.
    const parsed = parseCsvAnswers("A1-001,A1-002,A1-003\r\n1,,0", questions);
    expect(parsed.answers.map((a) => a.code)).toEqual(["A1-001", "A1-003"]);
    expect(parsed.issues.some((i) => i.column === "A1-002")).toBe(true);
  });

  it("puts the wording on a commented row under every code column", () => {
    // The code must stay the machine-readable header, so the wording lives
    // on a second row that the parser skips.
    const [header, wordingRow] = buildCsvTemplate(questions).split("\r\n");
    expect(header).toBe("A1-001,A1-002,A1-003");
    expect(wordingRow!.split(",").every((cell) => cell.trim().startsWith("#"))).toBe(true);
    expect(wordingRow).toContain("Solar — Conventional");
  });
});

// ============================================================
// Question key
// ============================================================

describe("buildCsvQuestionKey", () => {
  it("maps every code to its wording, energy source and criterion", () => {
    const csv = buildCsvQuestionKey([
      {
        id: "q1",
        externalQuestionCode: "A1-001",
        questionText: "Solar — Conventional",
        energySource: "Solar",
        criterion: "Conventional",
        displayOrder: 1,
      },
    ]);
    const [header, first] = csv.trim().split("\r\n");
    expect(header).toBe(QUESTION_KEY_HEADERS.join(","));
    expect(first).toBe("A1-001,Solar — Conventional,Solar,Conventional,1");
  });

  it("lists every question, in display order", () => {
    const csv = buildCsvQuestionKey([...questions].reverse());
    const codes = csv
      .trim()
      .split("\r\n")
      .slice(1)
      .map((line) => line.split(",")[0]);
    expect(codes).toEqual(["A1-001", "A1-002", "A1-003"]);
  });

  it("quotes wording containing a comma rather than splitting the row", () => {
    const csv = buildCsvQuestionKey([
      {
        id: "q1",
        externalQuestionCode: "A1-001",
        questionText: "Solar, wind and tidal — Conventional",
        displayOrder: 1,
      },
    ]);
    expect(csv).toContain('"Solar, wind and tidal — Conventional"');
    expect(csv.trim().split("\r\n")).toHaveLength(2);
  });
});

// ============================================================
// Parsing
// ============================================================

describe("parseCsvAnswers", () => {
  it("accepts a complete, valid sheet", () => {
    const parsed = parseCsvAnswers(`${header}\n1,0,1`, questions);
    expect(parsed.issues).toEqual([]);
    expect(parsed.answers).toEqual([
      { questionId: "q1", code: "A1-001", value: 1 },
      { questionId: "q2", code: "A1-002", value: 0 },
      { questionId: "q3", code: "A1-003", value: 1 },
    ]);
  });

  it("skips the template's commented wording row", () => {
    const parsed = parseCsvAnswers(`${header}\n# Solar — Conventional,# x,# y\n1,0,1`, questions);
    expect(parsed.issues).toEqual([]);
    expect(parsed.answers).toHaveLength(3);
  });

  it("rejects any value that is not 0 or 1", () => {
    for (const bad of ["2", "-1", "yes", "TRUE", "0.5", "01"]) {
      const parsed = parseCsvAnswers(`${header}\n${bad},0,1`, questions);
      expect(parsed.issues.some((i) => i.message.includes(bad)), bad).toBe(true);
      expect(parsed.answers.find((a) => a.code === "A1-001"), bad).toBeUndefined();
    }
  });

  it("never coerces a blank into a value", () => {
    const parsed = parseCsvAnswers(`${header}\n,0,1`, questions);
    expect(parsed.answers).toHaveLength(2);
    expect(parsed.issues.some((i) => i.column === "A1-001")).toBe(true);
  });

  it("flags unknown question columns", () => {
    const parsed = parseCsvAnswers(`${header},Z9-999\n1,0,1,1`, questions);
    expect(parsed.unknownColumns).toEqual(["Z9-999"]);
    expect(parsed.issues.some((i) => i.message.includes("not a question in this assignment"))).toBe(
      true
    );
  });

  it("flags duplicate question columns", () => {
    const parsed = parseCsvAnswers(`A1-001,A1-001,A1-002,A1-003\n1,0,0,1`, questions);
    expect(parsed.duplicateCodes).toEqual(["A1-001"]);
    expect(parsed.issues.some((i) => i.message.includes("more than once"))).toBe(true);
  });

  it("reports questions missing from the file entirely", () => {
    const parsed = parseCsvAnswers(`A1-001\n1`, questions);
    expect(parsed.missingCodes).toEqual(["A1-002", "A1-003"]);
    expect(parsed.issues.some((i) => i.message.includes("missing from the file"))).toBe(true);
  });

  it("ignores identity columns rather than treating them as questions", () => {
    const parsed = parseCsvAnswers(`student_identifier,${header}\nSTU001,1,0,1`, questions);
    expect(parsed.issues).toEqual([]);
    expect(parsed.answers).toHaveLength(3);
    expect(parsed.unknownColumns).toEqual([]);
  });

  it("is case- and whitespace-insensitive about question codes", () => {
    const parsed = parseCsvAnswers(` a1-001 , A1-002,a1-003 \n1,0,1`, questions);
    expect(parsed.issues).toEqual([]);
    expect(parsed.answers).toHaveLength(3);
  });

  it("refuses a multi-student file rather than silently taking row 1", () => {
    const parsed = parseCsvAnswers(`${header}\n1,0,1\n0,1,0`, questions);
    expect(parsed.issues.some((i) => i.message.includes("one student"))).toBe(true);
  });

  it("reports an empty file rather than committing nothing", () => {
    expect(parseCsvAnswers("", questions).issues.length).toBeGreaterThan(0);
    expect(parseCsvAnswers(header, questions).issues.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Commit
// ============================================================

describe("commitCsvSubmission", () => {
  it("saves then submits through the RPCs, never a direct write", async () => {
    const client = fakeClient();
    const result = await commitCsvSubmission(client, {
      attemptId: "attempt-1",
      questions,
      csvText: `${header}\n1,0,1`,
    });

    expect(result.success).toBe(true);
    const calls = (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc.mock.calls;
    expect(calls.map((c) => c[0])).toEqual(["save_attempt_responses", "submit_attempt"]);
    // Values reach the RPC as real 0/1 numbers, not strings.
    expect(calls[0]![1]).toEqual({
      p_attempt_id: "attempt-1",
      p_answers: [
        { questionId: "q1", value: 1 },
        { questionId: "q2", value: 0 },
        { questionId: "q3", value: 1 },
      ],
    });
  });

  it("writes NOTHING when the file has any problem", async () => {
    const client = fakeClient();
    const result = await commitCsvSubmission(client, {
      attemptId: "attempt-1",
      questions,
      csvText: `${header}\n1,7,1`,
    });

    expect(result.success).toBe(false);
    // The decisive assertion: a partial submission would leave the student
    // unable to tell which answers landed.
    expect((client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();
    if (!result.success) expect(result.issues?.length).toBeGreaterThan(0);
  });

  it("writes nothing when the sheet is incomplete", async () => {
    const client = fakeClient();
    const result = await commitCsvSubmission(client, {
      attemptId: "attempt-1",
      questions,
      csvText: `A1-001,A1-002\n1,0`,
    });
    expect(result.success).toBe(false);
    expect((client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();
  });

  it("does not submit when submit is false", async () => {
    const client = fakeClient();
    const result = await commitCsvSubmission(client, {
      attemptId: "attempt-1",
      questions,
      csvText: `${header}\n1,0,1`,
      submit: false,
    });
    expect(result.success).toBe(true);
    const calls = (client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc.mock.calls;
    expect(calls.map((c) => c[0])).toEqual(["save_attempt_responses"]);
  });

  it("surfaces a save failure without claiming success", async () => {
    const client = fakeClient({ save: { data: null, error: { message: "assignment is not open" } } });
    const result = await commitCsvSubmission(client, {
      attemptId: "attempt-1",
      questions,
      csvText: `${header}\n1,0,1`,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("not open");
  });

  it("says answers were saved when only the submit step failed", async () => {
    const client = fakeClient({
      submit: { data: null, error: { message: "already submitted" } },
    });
    const result = await commitCsvSubmission(client, {
      attemptId: "attempt-1",
      questions,
      csvText: `${header}\n1,0,1`,
    });
    expect(result.success).toBe(false);
    // Telling the student "upload failed" here would be a lie — the
    // answers are in the database.
    if (!result.success) expect(result.error).toContain("saved");
  });
});
