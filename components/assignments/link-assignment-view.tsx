import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { LocalDateTime } from "@/components/ui/local-date-time";

/**
 * What a student sees for a Google Form link assignment (migration 0032):
 * the title, the professor's description and instructions, and one button
 * that opens the Form in a new tab. Nothing is answered, saved or
 * submitted here — there is no grid, no attempt and no receipt.
 */
export function LinkAssignmentView({
  title,
  description,
  instructions,
  linkUrl,
  closeAt,
}: {
  title: string;
  description: string | null;
  instructions: string | null;
  linkUrl: string;
  closeAt: string | null;
}) {
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <p className="eyebrow">Google Form</p>
        <h1 className="title-md">{title}</h1>
        {closeAt && (
          <p className="note">
            Available until <LocalDateTime value={closeAt} />
          </p>
        )}
      </div>

      {description && <p className="text-sm">{description}</p>}
      {instructions && <p className="well p-3 text-sm text-ink-secondary">{instructions}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary inline-flex items-center gap-2"
        >
          Open
          <ExternalLink className="size-4" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <Link href="/assignments" className="btn btn-secondary">
          Back to your assignments
        </Link>
      </div>

      <p className="note-muted">
        This assignment is a Google Form. You answer and submit it there, in the new tab.
      </p>
    </section>
  );
}
