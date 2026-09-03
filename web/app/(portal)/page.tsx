"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { StarGlyph } from "@/components/shell/top-nav";
import { Digest } from "@/components/dashboard/digest";
import {
  PipelineCard,
  PresenceCard,
  type StageTotal,
} from "@/components/dashboard/aside";
import {
  listPosts,
  toCommunityPost,
  type CommunityPost,
} from "@/lib/community";
import {
  digestStories,
  editionLabel,
  presenceLeaders,
  todayLabel,
} from "@/lib/dashboard";
import { networkId, useMessages } from "@/lib/messages";
import { usePortalData } from "@/lib/portal-data";
import { fmtCompact, fullName, initials, isActive } from "@/lib/data";
import { STAGES, type Deal, type Stage } from "@/lib/types";
import { isClosedStage } from "@/lib/pipeline";

/* Home, rebuilt from the Claude Design artboard "Portal Dashboard".
 *
 * The morning read, in the order a leader wants it: what happened across the
 * network, then their own pipeline, then who is around to talk to. The
 * charts that used to live here are gone — the pipeline has its own screen
 * that draws them properly, and a dashboard that re-plots it is a second
 * place for the same numbers to be wrong.
 *
 * Where the numbers come from: the header stats and the pipeline card are the
 * real API, scoped by role the way the server scopes /deals. The digest and
 * the presence list are cut from the same posts the Community feed reads
 * (GET /posts) — see lib/dashboard.ts for why they read out of the same
 * records rather than holding content of their own. Both panels are editorial
 * fields a post does not carry yet (`headline` for the digest, presence for
 * the card), so a feed of ordinary posts still leaves the digest on its empty
 * state and the presence card unrendered: an "Around right now" that is
 * permanently empty says less than no card. A feed that fails to load is the
 * same shape as an empty one here — Home is not the place to report it.
 */

/* How many presence rows fit the card before it becomes a directory. */
const PRESENCE_ROWS = 4;

const OPEN_STAGES = STAGES.filter(
  (s): s is Exclude<Stage, "Closed" | "Closed Lost"> => !isClosedStage(s)
);

const DAY = 24 * 60 * 60 * 1000;

/* Whole days from today to a yyyy-mm-dd close date, comparing dates rather
   than instants so "closes today" does not depend on the time of day. */
function daysUntil(close: string, now: Date): number {
  const target = new Date(`${close}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / DAY);
}

export default function DashboardPage() {
  const { deals, labs, people, me, role } = usePortalData();

  const meRecord = me ? people[me] : undefined;
  const meName = fullName(meRecord);
  const meInitials = initials(meRecord);

  /* One clock for the whole render, so the eyebrow's date, the digest's
     edition line and a sent message's timestamp cannot disagree. Safe to read
     at render: the shell holds this page behind its loading state until the
     bootstrap resolves, so it never runs during the static prerender. */
  const now = useMemo(() => new Date(), []);

  const [posts, setPosts] = useState<CommunityPost[]>([]);

  useEffect(() => {
    let live = true;
    listPosts()
      .then((records) => {
        if (live) setPosts(records.map((r) => toCommunityPost(r, people, labs, new Date())));
      })
      .catch(() => {
        // Both panels already render correctly with nothing in them.
      });
    return () => {
      live = false;
    };
  }, [people, labs]);

  const stories = useMemo(() => digestStories(posts), [posts]);
  const leaders = useMemo(
    () => presenceLeaders(posts, meName),
    [posts, meName]
  );

  /* Messaging lives in the shell now, so a presence row opens the same panel
     the top nav and the bench open — one conversation, wherever it starts. */
  const { openWith } = useMessages();

  const openDeals = useMemo(
    () => deals.filter((d) => !isClosedStage(d.stage)),
    [deals]
  );

  const openPipeline = openDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0);

  /* Year to date on the expected close date — the only date a deal carries.
     For a won deal that is when it was marked closed, near enough. */
  const wonYTD = deals
    .filter(
      (d) =>
        d.stage === "Closed" &&
        d.outcome === "Won" &&
        d.close?.startsWith(String(now.getFullYear()))
    )
    .reduce((sum, d) => sum + (d.amount ?? 0), 0);

  const leaderCount = Object.values(people).filter(
    (p) => isActive(p) && p.role === "Lab Leader"
  ).length;

  const stageTotals: StageTotal[] = OPEN_STAGES.map((stage) => ({
    stage,
    amount: openDeals
      .filter((d) => d.stage === stage)
      .reduce((sum, d) => sum + (d.amount ?? 0), 0),
  }));

  /* The design closes the pipeline card with one nudge: a deal that needs
     attention today. It reads "quiet for six days", which no record supports —
     a deal carries no last-touched date — so the nudge is the open deal
     closing soonest, which the close date does support. */
  const nextClose = openDeals
    .filter((d) => d.close)
    .sort((a, b) => a.close.localeCompare(b.close))[0];

  /* Admins see every lab's deals, so the same sums mean something wider for
     them than for the Lab Leader the design was drawn for. Say which. */
  const network = role === "Admin";

  const stats: { value: string; label: string }[] = [];
  if (role !== "Contributor") {
    stats.push({
      value: fmtCompact(openPipeline),
      label: network ? "Network open pipeline" : "Your open pipeline",
    });
    stats.push({
      value: fmtCompact(wonYTD),
      label: network ? "Network won, YTD" : "Won by your labs, YTD",
    });
  }
  stats.push({
    value: String(leaderCount),
    label: `Leaders across ${labs.length} ${labs.length === 1 ? "lab" : "labs"}`,
  });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-warm-gray uppercase">
            <StarGlyph size={13} className="text-violet-deep" />
            {todayLabel(now)}
          </span>
          <h1 className="mt-2.5 mb-0 text-[30px] leading-[1.08] font-bold tracking-[-0.015em] sm:text-[38px]">
            Welcome back,{" "}
            <span className="font-serif font-normal text-violet-deep italic">
              {meRecord?.firstName || "there"}
            </span>
          </h1>
        </div>
        <StatStrip stats={stats} />
      </div>

      <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_372px]">
        <main className="flex min-w-0 flex-col gap-4">
          <Digest
            stories={stories}
            edition={stories.length ? editionLabel(now, stories.length) : ""}
            meInitials={meInitials}
          />
        </main>

        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24">
          {role !== "Contributor" && (
            <PipelineCard
              title={network ? "The pipeline" : "Your pipeline"}
              stages={stageTotals}
              nudge={nextClose && <CloseNudge close={nextClose} now={now} />}
            />
          )}
          {leaders.length > 0 && (
            <PresenceCard
              leaders={leaders.slice(0, PRESENCE_ROWS)}
              more={Math.max(0, leaders.length - PRESENCE_ROWS)}
              onMessage={(leader) => openWith([networkId(leader.name)])}
            />
          )}
        </aside>
      </div>
    </>
  );
}

/* Three numbers beside the greeting. Wide: a row split by hairlines. Narrow:
   a grid without them. Narrowest: one labelled row per stat, because three
   stacked headline numbers with nothing between them read as a list of
   unrelated figures. */
function StatStrip({ stats }: { stats: { value: string; label: string }[] }) {
  return (
    <div className="flex w-full flex-col sm:grid sm:w-auto sm:auto-cols-fr sm:grid-flow-col sm:gap-3.5 lg:flex lg:flex-row lg:items-stretch lg:gap-7 lg:pb-1.5">
      {stats.map((stat, i) => (
        <Fragment key={stat.label}>
          {/* Display:none leaves no grid cell, so the rules exist only in the
              wide row where the design draws them. */}
          {i > 0 && (
            <span aria-hidden="true" className="hidden w-px bg-hair lg:block" />
          )}
          <div className="flex items-baseline justify-between gap-3 border-t border-hair py-2.5 sm:block sm:border-0 sm:py-0">
            <div className="text-xl font-bold tracking-[-0.01em] tabular-nums lg:text-2xl">
              {stat.value}
            </div>
            <div className="text-right text-[11px] leading-[1.35] text-warm-gray sm:mt-0.5 sm:text-left lg:text-xs">
              {stat.label}
            </div>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function CloseNudge({ close, now }: { close: Deal; now: Date }) {
  const days = daysUntil(close.close, now);
  const when =
    days < 0
      ? `was expected to close ${-days} ${days === -1 ? "day" : "days"} ago`
      : days === 0
        ? "is expected to close today"
        : days === 1
          ? "is expected to close tomorrow"
          : `is expected to close in ${days} days`;

  return (
    <>
      {close.client} {when}.{" "}
      <Link href="/pipeline" className="text-violet-deep hover:text-violet">
        {days < 0 ? "Check in" : "Open the deal"}
      </Link>
      .
    </>
  );
}
