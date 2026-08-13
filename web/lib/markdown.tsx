/* Markdown renderer for Resource Library posts.

   Posts are written in markdown rather than in a WYSIWYG editor, and rendered
   to React elements here rather than to an HTML string. That choice is the
   whole point of this file: nothing ever reaches dangerouslySetInnerHTML, so a
   post body cannot inject markup no matter what an author pastes into it.
   Links are restricted to http/https/mailto and images to https/data, which
   closes the two ways a "safe" markdown renderer normally still lets script
   through (javascript: hrefs and data: URLs that aren't images).

   The dialect is deliberately small — headings, emphasis, code, links,
   images, lists, quotes, rules — plus one addition the PRD asks for:

     @[resource](RS-003)

   embeds another Resource Item inline, which is how a post becomes the
   connective narrative around a downloadable checklist (PRD 3.2) instead of
   just linking away to it. */

import React from "react";

export interface MarkdownProps {
  text: string;
  /** Renders an @[resource](ID) embed. Omit and the embed falls back to a link. */
  renderEmbed?: (id: string) => React.ReactNode;
  className?: string;
}

const SAFE_HREF = /^(https?:|mailto:)/i;
const SAFE_IMAGE = /^(https:|data:image\/)/i;
const EMBED_LINE = /^@\[resource\]\(\s*([A-Za-z0-9-]+)\s*\)$/;

/* Inline pass. Ordered so that code spans win over emphasis (backticks are
   literal inside them) and links win over bare images.

   The URL group allows one level of balanced parentheses so that links like
   .../wiki/Foo_(bar) survive: stopping at the first ")" would both truncate
   the href and leave the extra ")" stranded in the rendered text. */
const URL_PART = String.raw`([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)`;
const INLINE = [
  { kind: "code", re: /`([^`]+)`/ },
  { kind: "image", re: new RegExp(String.raw`!\[([^\]]*)\]\(` + URL_PART + String.raw`\)`) },
  { kind: "link", re: new RegExp(String.raw`\[([^\]]+)\]\(` + URL_PART + String.raw`\)`) },
  { kind: "strong", re: /\*\*([^*]+)\*\*/ },
  { kind: "em", re: /(?:\*([^*\n]+)\*|_([^_\n]+)_)/ },
] as const;

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = text;
  let n = 0;

  while (rest) {
    let best: { kind: string; index: number; match: RegExpMatchArray } | null = null;
    for (const { kind, re } of INLINE) {
      const m = rest.match(re);
      if (m && m.index !== undefined && (!best || m.index < best.index))
        best = { kind, index: m.index, match: m };
    }
    if (!best) {
      out.push(rest);
      break;
    }

    if (best.index > 0) out.push(rest.slice(0, best.index));
    const key = `${keyBase}-i${n++}`;
    const [whole, a, b] = best.match;

    if (best.kind === "code") {
      out.push(
        <code key={key} className="rounded bg-violet-pale px-1 py-0.5 font-mono text-[0.85em]">
          {a}
        </code>
      );
    } else if (best.kind === "image") {
      out.push(
        SAFE_IMAGE.test(b) ? (
          /* Author-supplied URLs can't be enumerated for next/image's
             remotePatterns allowlist, and the export is unoptimized anyway. */
          // eslint-disable-next-line @next/next/no-img-element
          <img key={key} src={b} alt={a} className="my-3 max-w-full rounded-lg border border-hair" />
        ) : (
          <span key={key}>{a}</span>
        )
      );
    } else if (best.kind === "link") {
      out.push(
        SAFE_HREF.test(b) ? (
          <a
            key={key}
            href={b}
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-deep underline underline-offset-2"
          >
            {a}
          </a>
        ) : (
          <span key={key}>{a}</span>
        )
      );
    } else if (best.kind === "strong") {
      out.push(<strong key={key} className="font-semibold text-ink">{inline(a, key)}</strong>);
    } else {
      out.push(<em key={key}>{inline(a ?? b, key)}</em>);
    }

    rest = rest.slice(best.index + whole.length);
  }
  return out;
}

/* Block pass. Consumes the source line by line, grouping runs of list items,
   fenced code, and quotes rather than re-scanning with multiline regexes. */
export function Markdown({ text, renderEmbed, className }: MarkdownProps) {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  const k = () => `b${key++}`;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code — everything until the closing fence is literal.
    if (trimmed.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(
        <pre
          key={k()}
          className="my-3 overflow-x-auto rounded-lg border border-hair bg-paper p-3 font-mono text-xs text-ink-soft"
        >
          <code>{body.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const embed = trimmed.match(EMBED_LINE);
    if (embed) {
      blocks.push(
        <div key={k()} className="my-4">
          {renderEmbed ? renderEmbed(embed[1]) : <span className="text-sm text-ink-mute">{trimmed}</span>}
        </div>
      );
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push(<hr key={k()} className="my-6 border-hair" />);
      i++;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const size =
        level === 1 ? "text-xl" : level === 2 ? "text-lg" : "text-base";
      const Tag = `h${Math.min(level + 1, 6)}` as "h2";
      blocks.push(
        <Tag key={k()} className={`mt-5 mb-2 font-serif ${size} text-ink first:mt-0`}>
          {inline(heading[2], k())}
        </Tag>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">"))
        body.push(lines[i++].trim().replace(/^>\s?/, ""));
      blocks.push(
        <blockquote
          key={k()}
          className="my-3 border-l-2 border-violet-light pl-4 text-sm text-ink-soft italic"
        >
          {inline(body.join(" "), k())}
        </blockquote>
      );
      continue;
    }

    const ordered = /^\d+[.)]\s+/;
    const bullet = /^[-*]\s+/;
    if (ordered.test(trimmed) || bullet.test(trimmed)) {
      const isOrdered = ordered.test(trimmed);
      const re = isOrdered ? ordered : bullet;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i].trim()))
        items.push(lines[i++].trim().replace(re, ""));
      const List = isOrdered ? "ol" : "ul";
      blocks.push(
        <List
          key={k()}
          className={`my-3 ml-5 flex flex-col gap-1 text-sm text-ink-soft ${
            isOrdered ? "list-decimal" : "list-disc"
          }`}
        >
          {items.map((item, idx) => (
            <li key={idx}>{inline(item, `${k()}-${idx}`)}</li>
          ))}
        </List>
      );
      continue;
    }

    // Paragraph — consecutive non-blank lines that started no other block.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i].trim()))
      para.push(lines[i++].trim());
    blocks.push(
      <p key={k()} className="my-3 text-sm leading-relaxed text-ink-soft first:mt-0">
        {inline(para.join(" "), k())}
      </p>
    );
  }

  return <div className={className}>{blocks}</div>;
}

function isBlockStart(trimmed: string): boolean {
  return (
    trimmed.startsWith("```") ||
    trimmed.startsWith(">") ||
    /^#{1,6}\s/.test(trimmed) ||
    /^(-{3,}|\*{3,})$/.test(trimmed) ||
    /^\d+[.)]\s+/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    EMBED_LINE.test(trimmed)
  );
}
