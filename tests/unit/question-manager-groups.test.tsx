/**
 * REGRESSION: the Assignment 2 review page logged 15 React
 * "Encountered two children with the same key" errors — one per energy
 * source.
 *
 * Cause: the group headings were built by walking the display-ordered
 * questions and starting a new group whenever the energy source differed
 * from the PREVIOUS row. Assignment 1 is source-major (Solar, Solar, Wind,
 * Wind, …) so that produced 15 contiguous groups and looked correct.
 * Assignment 2 is criterion-major (all 15 sources, then the next criterion)
 * so the same walk produced 255 single-row groups whose keys repeated 17
 * times each — hence exactly one duplicate-key error per source.
 *
 * These tests mount the real component with the real 255-question
 * Assignment 2 manifest and assert the two things the fix has to deliver:
 * exactly one section per source, and a clean console.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  QuestionManager,
  type QuestionRow,
} from "@/components/assignments/question-manager";
import assignment1 from "@/data/assignment-1-manifest.json";
import assignment2 from "@/data/assignment-2-manifest.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/assignments/actions", () => ({
  reorderQuestions: vi.fn(async () => ({ success: true, data: null })),
  updateQuestionLabels: vi.fn(async () => ({ success: true, data: null })),
}));

interface ManifestQuestion {
  display_order: number;
  external_question_code?: string | null;
  question_text: string;
  energy_source: string | null;
  criterion: string | null;
}

function rowsFrom(manifest: unknown): QuestionRow[] {
  const questions = (manifest as { questions: ManifestQuestion[] }).questions;
  return questions.map((q, i) => ({
    id: `q-${i}`,
    external_question_code: q.external_question_code ?? `Q-${i}`,
    question_text: q.question_text,
    energy_source: q.energy_source,
    criterion: q.criterion,
    response_zero_label: "No",
    response_one_label: "Yes",
    display_order: q.display_order,
  }));
}

/** The heading rows are the ones carrying the .eyebrow source label. */
function groupHeadings(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".eyebrow")].map((el) =>
    (el.textContent ?? "").trim()
  );
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  cleanup();
});

describe("QuestionManager grouping", () => {
  it("renders exactly 15 sections for criterion-major Assignment 2, not 255", () => {
    const questions = rowsFrom(assignment2);
    expect(questions).toHaveLength(255);

    const { container } = render(
      <QuestionManager
        assignmentId="a2"
        questions={questions}
        hasResponses={false}
        editable={false}
      />
    );

    const headings = groupHeadings(container);
    expect(headings).toHaveLength(15);
    expect(new Set(headings).size).toBe(15);
    expect(headings).toContain("Solar");
    expect(headings).toContain("Garbage");
  });

  it("logs no React duplicate-key error for Assignment 2", () => {
    render(
      <QuestionManager
        assignmentId="a2"
        questions={rowsFrom(assignment2)}
        hasResponses={false}
        editable={false}
      />
    );

    const messages = consoleError.mock.calls.map((call) => call.join(" "));
    expect(messages.filter((m) => /same key/i.test(m))).toEqual([]);
    expect(messages).toEqual([]);
  });

  it("still renders 15 sections for source-major Assignment 1, with a clean console", () => {
    const { container } = render(
      <QuestionManager
        assignmentId="a1"
        questions={rowsFrom(assignment1)}
        hasResponses={false}
        editable={false}
      />
    );

    expect(groupHeadings(container)).toHaveLength(15);
    expect(consoleError.mock.calls).toEqual([]);
  });

  it("renders every question exactly once across the sections", () => {
    const questions = rowsFrom(assignment2);
    render(
      <QuestionManager
        assignmentId="a2"
        questions={questions}
        hasResponses={false}
        editable={false}
      />
    );

    // 255 question rows + 15 heading rows, inside the table body.
    const body = screen.getByRole("table").querySelector("tbody")!;
    expect(within(body).getAllByRole("row")).toHaveLength(255 + 15);
  });
});
