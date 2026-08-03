/**
 * Timestamps must not desynchronise the server render from the client one.
 *
 * The bug this pins: `new Date(x).toLocaleString()` in the render path of a
 * client component put Vercel's UTC/en-US string into the SSR HTML and the
 * professor's local string into the hydration render. React saw a text node
 * it did not expect, failed hydration with error #418 and re-rendered the
 * entire root on the client — a whole-page failure caused by one table cell.
 *
 * The guard is therefore about the SERVER-SIDE output specifically: whatever
 * `LocalDateTime` puts in the HTML has to be the same string on every
 * machine, in every timezone, under every locale. Local formatting is an
 * effect, and effects don't run during `renderToString`.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { LocalDateTime, utcLabel } from "@/components/ui/local-date-time";

const STAMP = "2026-08-03T19:37:17.482+00:00";

/** Renders with the process pinned to `tz`, then restores it. */
function renderUnderTimezone(tz: string, node: React.ReactElement): string {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return renderToString(node);
  } finally {
    process.env.TZ = previous;
  }
}

describe("LocalDateTime", () => {
  it("renders the same markup in every server timezone", () => {
    const utc = renderUnderTimezone("UTC", <LocalDateTime value={STAMP} />);
    const kolkata = renderUnderTimezone("Asia/Kolkata", <LocalDateTime value={STAMP} />);
    const honolulu = renderUnderTimezone("Pacific/Honolulu", <LocalDateTime value={STAMP} />);

    expect(kolkata).toBe(utc);
    expect(honolulu).toBe(utc);
  });

  it("labels the server-side value as UTC rather than passing it off as local", () => {
    const html = renderUnderTimezone("Asia/Kolkata", <LocalDateTime value={STAMP} />);
    expect(html).toContain("2026-08-03 19:37 UTC");
  });

  it("keeps the machine-readable instant in the datetime attribute", () => {
    // Case-insensitive on the attribute name: React spells it `dateTime` in
    // the serialised markup, and HTML attribute names are case-insensitive
    // to the parser, so the browser reads it as `datetime` either way.
    const html = renderToString(<LocalDateTime value={STAMP} />);
    expect(html).toMatch(new RegExp(`datetime="${STAMP.replace(/[.+]/g, "\\$&")}"`, "i"));
  });

  it("renders the fallback, and no <time>, when there is no timestamp", () => {
    expect(renderToString(<LocalDateTime value={null} />)).toBe("—");
    expect(renderToString(<LocalDateTime value={null} fallback="Not submitted" />)).toBe(
      "Not submitted"
    );
  });

  it("passes an unparseable value through instead of rendering Invalid Date", () => {
    expect(utcLabel("not a date")).toBe("not a date");
  });
});
