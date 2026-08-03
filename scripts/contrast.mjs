// Ad-hoc WCAG contrast harness for the SaaS direction palette.
// Same tool used for the Ashfield pass; kept because it caught 18 failures then.

const hex = (h) => {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const lum = (h) => {
  const [r, g, b] = hex(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

const F = (n) => n.toFixed(2).padStart(6);

export function check(label, fg, bg, min) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  return { label, fg, bg, r, min, ok, line: `${ok ? "PASS" : "FAIL"} ${F(r)}:1 (min ${min})  ${label}  ${fg} on ${bg}` };
}

export function report(rows) {
  let fails = 0;
  for (const row of rows) {
    if (!row.ok) fails++;
    console.log(row.line);
  }
  console.log(`\n${rows.length} pairings, ${fails} failing`);
  return fails;
}
