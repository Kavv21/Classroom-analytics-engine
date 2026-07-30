import { questionLabel, type QuestionLabelFields } from "@/lib/ui/question-label";

/**
 * The one way a question is rendered anywhere a person reads it: the wording
 * is the prominent label, the code is a muted secondary detail beside or
 * beneath it. Never the code alone — see lib/ui/question-label.ts.
 *
 * `layout="stacked"` puts the code on its own line underneath (table cells,
 * list rows with room); `layout="inline"` keeps it on the same line (tight
 * rows, badges).
 */
export function QuestionLabel({
  question,
  layout = "stacked",
  className,
  labelClassName,
  codeClassName,
}: {
  question: QuestionLabelFields;
  layout?: "stacked" | "inline";
  className?: string;
  labelClassName?: string;
  codeClassName?: string;
}) {
  const label = questionLabel(question);
  const code = (question.code ?? "").trim();
  const showCode = code !== "" && code !== label;

  return (
    <span className={["min-w-0", layout === "stacked" ? "block" : "", className].filter(Boolean).join(" ")}>
      <span className={labelClassName ?? "text-ink"}>{label}</span>
      {showCode && (
        <span
          className={
            codeClassName ??
            [
              "mono text-ink-muted",
              layout === "stacked" ? "mt-0.5 block" : "ml-1.5",
            ].join(" ")
          }
        >
          {code}
        </span>
      )}
    </span>
  );
}
