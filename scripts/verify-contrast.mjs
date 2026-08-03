import { check, report } from "./contrast.mjs";

// ---- proposed token values -------------------------------------------------
const T = {
  backdrop: "#f7c9a3",     // peach page behind the floating app frame
  frame: "#ffffff",        // the floating app frame itself
  page: "#f6f7fb",         // working canvas inside the frame
  raised: "#ffffff",       // cards
  sunken: "#f1f3f8",       // table header band, wells
  inset: "#e6e9f2",        // deepest tint (sticky row headers, zebra)
  navy: "#1b2340",         // sidebar
  navyHover: "#29314f",

  primary: "#131a2e",
  secondary: "#454e68",
  muted: "#5a6480",
  inverse: "#ffffff",

  sidebarIdle: "#a8b0c8",  // resting icon/label ink on navy
  sidebarActiveFg: "#ffffff",
  sidebarActive: "#f97316",     // bright orange pill on the dark rail
  sidebarActiveInk: "#1b2340",  // navy ink on that pill

  action: "#c2410c",
  actionHover: "#9a3412",
  focus: "#c2410c",

  frameBorder: "#ebeef5",
  hairline: "#e6e9f2",
  strong: "#6b7694",
};

// accent families: [soft, softer(border), vivid(graphic), text, solid]
const A = {
  orange: ["#fff1e6", "#ffe0cc", "#dd5409", "#9a3412", "#c2410c"],
  green:  ["#e8f7ef", "#ccf0dd", "#059669", "#036347", "#047857"],
  blue:   ["#e8f1fe", "#d5e6fd", "#3b82f6", "#1d4ed8", "#2563eb"],
  purple: ["#f1ecfe", "#e7dcfd", "#8b5cf6", "#6d28d9", "#7c3aed"],
  pink:   ["#fdecf4", "#fbd9e8", "#e0447f", "#be185d", "#db2777"],
  // amber vivid darkened from #d97706: at 3.19:1 it cleared white but only
  // 2.98:1 on --surface-page, i.e. it failed 1.4.11 on the surface a status
  // pill most often sits on. #bf6a06 clears 3:1 on every light surface.
  amber:  ["#fdf3dd", "#fbe8bd", "#bf6a06", "#92400e", "#b45309"],
  red:    ["#feecec", "#fcdada", "#ef4444", "#b91c1c", "#dc2626"],
  slate:  ["#f1f3f8", "#e6e9f2", "#6b7694", "#454e68", "#5a6480"],
};

const rows = [];
const lightSurfaces = [
  ["frame", T.frame], ["page", T.page], ["raised", T.raised],
  ["sunken", T.sunken], ["inset", T.inset],
];

// --- 1.4.3 body text on every light surface it can land on ------------------
for (const [sn, s] of lightSurfaces) {
  rows.push(check(`text-primary   on ${sn}`, T.primary, s, 4.5));
  rows.push(check(`text-secondary on ${sn}`, T.secondary, s, 4.5));
  rows.push(check(`text-muted     on ${sn}`, T.muted, s, 4.5));
}
// Text that can land on the peach backdrop. The unauthenticated screens
// (sign-in, not-provisioned) put their card straight on it, and their
// footer line sits on the bare backdrop.
//
// --text-muted is NOT checked as passing here because it does not pass:
// 3.88:1, below the 4.5 a 12px line owes. That is why the two footer
// `.eyebrow`s on those screens carry an explicit `text-ink-secondary`
// override — every other .eyebrow in the app is on a white surface, where
// muted is 6.2:1 and correct. Asserted rather than commented, so a future
// direction that darkens the backdrop cannot quietly re-break it:
rows.push(check("text-primary   on backdrop", T.primary, T.backdrop, 4.5));
rows.push(check("text-secondary on backdrop", T.secondary, T.backdrop, 4.5));
rows.push(
  check("backdrop footer eyebrow uses SECONDARY, not muted", T.secondary, T.backdrop, 4.5)
);

// --- sidebar (navy) ---------------------------------------------------------
rows.push(check("sidebar idle ink on navy", T.sidebarIdle, T.navy, 4.5));
rows.push(check("sidebar idle ink on navy-hover", T.sidebarIdle, T.navyHover, 4.5));
rows.push(check("sidebar active ink on navy", T.sidebarActiveFg, T.navy, 4.5));

rows.push(check("navy against peach backdrop (UI edge)", T.navy, T.backdrop, 3));
// NOTE: the white app frame against the peach backdrop is 1.52:1 and is NOT
// checked. It is a decorative page composition, not a UI component boundary
// and not a graphical object required to understand content (WCAG 1.4.11
// applies to neither). Nothing is conveyed by that edge — every control and
// every value inside the frame is measured on its own surface below. The
// frame is additionally separated by an offset shadow, not by the edge alone.

// --- 1.4.11 interactive boundaries -----------------------------------------
for (const [sn, s] of lightSurfaces) {
  rows.push(check(`border-strong (input/btn edge) on ${sn}`, T.strong, s, 3));
}
rows.push(check("focus ring on raised", T.focus, T.raised, 3));
rows.push(check("focus ring on page", T.focus, T.page, 3));
rows.push(check("focus ring on sunken", T.focus, T.sunken, 3));
rows.push(check("focus ring on backdrop", T.focus, T.backdrop, 3));
rows.push(check("focus ring on navy", "#fdba74", T.navy, 3));

// --- primary action ---------------------------------------------------------
rows.push(check("btn-primary label on fill", T.inverse, T.action, 4.5));
rows.push(check("btn-primary label on hover fill", T.inverse, T.actionHover, 4.5));
rows.push(check("btn-primary fill vs raised (UI edge)", T.action, T.raised, 3));
rows.push(check("btn-primary fill vs page (UI edge)", T.action, T.page, 3));

// --- accents: badge text on its own soft tint, and on every light surface ---
for (const [name, [soft, softer, vivid, text, solid]] of Object.entries(A)) {
  rows.push(check(`${name} badge text on its soft tint`, text, soft, 4.5));
  rows.push(check(`${name} badge text on its softer tint`, text, softer, 4.5));
  for (const [sn, s] of lightSurfaces) {
    rows.push(check(`${name} text on ${sn}`, text, s, 4.5));
  }
  rows.push(check(`${name} solid fill w/ white label`, "#ffffff", solid, 4.5));
  // The pill's OUTLINE is the vivid step, so the badge has a real boundary
  // that clears 1.4.11 on every surface it can sit on. (The soft FILL is
  // ~1.25:1 against white and is deliberately not checked: a fill is not a
  // boundary, and the pill's meaning is carried entirely by its text, which
  // is measured above. Colour is never the only channel — every badge prints
  // its status in words.)
  rows.push(check(`${name} pill outline on raised`, vivid, T.raised, 3));
  rows.push(check(`${name} pill outline on page`, vivid, T.page, 3));
  rows.push(check(`${name} pill outline on sunken`, vivid, T.sunken, 3));
  rows.push(check(`${name} pill outline on inset`, vivid, T.inset, 3));
}

// --- sidebar active indicator ----------------------------------------------
// The rail is DARK, so its active indicator inverts: a bright orange pill
// carrying navy ink. The dark --action orange used on white is only 2.98:1
// against the navy rail and cannot be reused here.
rows.push(check("active-item fill vs navy rail (UI edge)", T.sidebarActive, T.navy, 3));
rows.push(check("active-item fill vs navy hover (UI edge)", T.sidebarActive, T.navyHover, 3));
rows.push(check("active-item ink on its fill", T.sidebarActiveInk, T.sidebarActive, 4.5));

process.exit(report(rows) > 0 ? 1 : 0);
