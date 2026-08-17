import Link from "next/link";
import { RippleMark } from "@/components/optimist/mark";
import { pillVariants } from "@/components/optimist/pill";

/* Contributor (design_handoff_the_optimist, 1i). Unchanged behavior, given
   somewhere to stand: a centered ripple mark and the one verbatim line, kept
   exactly as before. */
export function ContributorScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-12 py-14 text-center">
      <RippleMark className="size-[34px] text-violet-light" />
      <p className="max-w-[400px] font-sans text-[17px] leading-[1.55] text-ink-soft">
        The Optimist is available to Lab Leaders and Admins.
      </p>
      <div className="flex gap-2.5">
        <Link href="/" className={pillVariants({ tone: "outline", size: "sm" })}>
          Back to Dashboard
        </Link>
        <Link href="/library" className={pillVariants({ tone: "outline", size: "sm" })}>
          Resource Library
        </Link>
      </div>
    </div>
  );
}
