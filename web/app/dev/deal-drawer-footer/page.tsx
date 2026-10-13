"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { DealDrawerFooter } from "@/components/pipeline/deal-drawer-footer";

/*
 Layout harness for the deal drawer's action bar. The bar has no unit-test
 runner behind it, so this page is the regression check: it renders every
 hint/permission combination at every width the drawer can be given and audits
 the rendered boxes for overlap, for escaping the padding box, and for gaps
 that have collapsed below the design's 12px. Visit /dev/deal-drawer-footer and
 read the banner, or call window.auditFooterLayout() from the console.
*/

// Every branch of the drawer's hint ladder, plus a token that cannot be broken
// on a space — the worst case for a text node sat between two buttons.
const HINTS = [
  "Ready to save",
  "A deal name is required",
  "Link a company or a person to save this deal at Proposal Sent",
  "Unlinked — fine at Lead, required at Proposal Sent",
  "Upload a proposal before saving this deal at Proposal Sent",
  "A signed contract is required to close this deal",
  "Set the date this deal closed",
  "Blocked-by-an-unbreakable-identifier-0000000000000000000000",
];

// Drawer is `w-full sm:max-w-[520px]`, so the bar sees anything from the
// narrowest phone to 520px. The extremes on both ends are deliberate.
const WIDTHS = [240, 280, 320, 339, 340, 360, 393, 440, 520];

const CASES = [
  { label: "delete + save", del: true, save: true, saveLabel: "Save" },
  { label: "save only (new deal)", del: false, save: true, saveLabel: "Create deal" },
  { label: "delete only (locked)", del: true, save: false, saveLabel: "Save" },
  { label: "hint only (read-only)", del: false, save: false, saveLabel: "Save" },
];

const PAD = 16; // p-4 on the bar's inner row
const MIN_GAP = 12; // gap-x-3
const EPSILON = 0.5; // sub-pixel layout rounding

type Rect = { left: number; right: number; top: number; bottom: number };

function overlaps(a: Rect, b: Rect) {
  return a.left < b.right - EPSILON && b.left < a.right - EPSILON && a.top < b.bottom - EPSILON && b.top < a.bottom - EPSILON;
}

function sameLine(a: Rect, b: Rect) {
  return a.top < b.bottom - EPSILON && b.top < a.bottom - EPSILON;
}

function auditFooterLayout() {
  const failures: string[] = [];

  document.querySelectorAll<HTMLElement>("[data-slot='deal-drawer-footer']").forEach((bar) => {
    const name = bar.dataset.case ?? "?";
    const bounds = bar.getBoundingClientRect();
    const row = bar.firstElementChild as HTMLElement | null;
    if (!row) return;
    const items = Array.from(row.children) as HTMLElement[];
    const rects = items.map((el) => el.getBoundingClientRect());

    rects.forEach((r, i) => {
      const what = items[i].textContent?.slice(0, 24) ?? "";
      if (r.left < bounds.left + PAD - EPSILON || r.right > bounds.right - PAD + EPSILON) {
        failures.push(`${name}: "${what}" escapes the padding box (${Math.round(r.left - bounds.left)}…${Math.round(bounds.right - r.right)}px)`);
      }
      for (let j = i + 1; j < rects.length; j++) {
        const other = items[j].textContent?.slice(0, 24) ?? "";
        if (overlaps(r, rects[j])) {
          failures.push(`${name}: "${what}" overlaps "${other}"`);
        } else if (sameLine(r, rects[j])) {
          const gap = Math.max(r.left, rects[j].left) - Math.min(r.right, rects[j].right);
          if (gap < MIN_GAP - EPSILON) failures.push(`${name}: only ${gap.toFixed(1)}px between "${what}" and "${other}"`);
        }
      }
    });
  });

  return failures;
}

export default function DealDrawerFooterHarness() {
  if (process.env.NODE_ENV === "production") notFound();

  const [failures, setFailures] = useState<string[] | null>(null);

  useEffect(() => {
    (window as unknown as { auditFooterLayout: typeof auditFooterLayout }).auditFooterLayout = auditFooterLayout;
    // Web fonts change every text measurement, so audit only once they land.
    const run = () => setFailures(auditFooterLayout());
    document.fonts.ready.then(run);
    window.addEventListener("resize", run);
    return () => window.removeEventListener("resize", run);
  }, []);

  return (
    <main className="min-h-screen bg-paper p-6 text-ink">
      <h1 className="font-semibold">Deal drawer footer — layout harness</h1>

      <div
        data-testid="audit-result"
        className={`mt-3 rounded-lg border p-3 text-sm ${
          failures === null
            ? "border-hair text-ink-mute"
            : failures.length
              ? "border-red text-red"
              : "border-hair text-ink-mute"
        }`}
      >
        {failures === null
          ? "Measuring…"
          : failures.length === 0
            ? `PASS — no overlap, no overflow, no gap under ${MIN_GAP}px across ${WIDTHS.length * CASES.length * HINTS.length} bars.`
            : `FAIL (${failures.length})\n${failures.join("\n")}`}
      </div>

      {WIDTHS.map((w) => (
        <section key={w} className="mt-6">
          <h2 className="text-xs font-semibold tracking-wide text-ink-mute uppercase">{w}px</h2>
          <div className="mt-2 flex flex-wrap gap-4">
            {CASES.map((c) =>
              HINTS.map((hint) => (
                <div key={`${c.label}-${hint}`} className="shrink-0 border border-hair-soft bg-white">
                  <div
                    style={{ width: w }}
                    data-slot="deal-drawer-footer-wrap"
                    ref={(el) => {
                      const bar = el?.querySelector<HTMLElement>("[data-slot='deal-drawer-footer']");
                      if (bar) bar.dataset.case = `${w}px · ${c.label} · ${hint.slice(0, 28)}`;
                    }}
                  >
                    <DealDrawerFooter
                      hint={hint}
                      tone={hint === "Ready to save" ? "mute" : "warn"}
                      onDelete={c.del ? () => {} : undefined}
                      onSave={c.save ? () => {} : undefined}
                      saveLabel={c.saveLabel}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      ))}
    </main>
  );
}
