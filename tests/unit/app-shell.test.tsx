/**
 * The global shell's two constants: the app's displayed name, and the
 * copyright notice. Both are shell-level on purpose — the notice must appear
 * on every authenticated page without being duplicated per-page, so it is
 * asserted here rather than on any one route.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AppShell, type ShellUser } from "@/components/shell/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("next/navigation", () => ({
  usePathname: () => "/classes",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: vi.fn(async () => ({})) } }),
}));

const professor: ShellUser = {
  fullName: "Ada Professor",
  email: "ada@example.edu",
  role: "PROFESSOR",
};

/** Mirrors RootLayout: the sidebar's collapsed tooltips need the provider. */
function renderShell(user: ShellUser = professor) {
  return render(
    <TooltipProvider delayDuration={200}>
      <AppShell user={user}>
        <main>page body</main>
      </AppShell>
    </TooltipProvider>
  );
}

describe("app shell", () => {
  // jsdom ships no matchMedia; the sidebar's mobile hook needs one.
  beforeAll(() => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the app's displayed name as the brand", () => {
    renderShell();
    expect(screen.getByText("EVALUATING ENERGY SOURCES")).toBeTruthy();
  });

  it("shows the copyright notice", () => {
    renderShell();
    expect(screen.getByText("© JINRAJ JOSHIPURA 1994")).toBeTruthy();
  });

  it("shows the notice exactly once, for every role", () => {
    for (const role of ["PROFESSOR", "STUDENT", "ADMIN"]) {
      cleanup();
      renderShell({ ...professor, role });
      expect(
        screen.getAllByText("© JINRAJ JOSHIPURA 1994"),
        `exactly one notice for ${role}`
      ).toHaveLength(1);
    }
  });

  it("still renders the page body beneath it", () => {
    renderShell();
    expect(screen.getByText("page body")).toBeTruthy();
  });
});
