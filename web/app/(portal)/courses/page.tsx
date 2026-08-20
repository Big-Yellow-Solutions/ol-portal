"use client";

/* Courses merged into /resources (the Claude Design "Resources" artboard covers
   both it and the Resource Library). This route stays so existing links and
   bookmarks keep working, including the ?c=<id> deep link the old page minted. */

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function CoursesRedirect() {
  return <Suspense fallback={null}><Redirect /></Suspense>;
}

function Redirect() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const c = params.get("c");
    router.replace(c ? `/resources?c=${c}` : "/resources");
  }, [router, params]);

  return <p className="text-sm text-ink-mute">Taking you to Resources…</p>;
}
