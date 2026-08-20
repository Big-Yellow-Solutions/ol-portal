"use client";

/* The Resource Library merged into /resources (the Claude Design "Resources"
   artboard covers both it and Courses). This route stays so existing links and
   bookmarks keep working, including the ?r=<id> deep link the old page minted. */

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LibraryRedirect() {
  return <Suspense fallback={null}><Redirect /></Suspense>;
}

function Redirect() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const r = params.get("r");
    router.replace(r ? `/resources?r=${r}` : "/resources");
  }, [router, params]);

  return <p className="text-sm text-ink-mute">Taking you to Resources…</p>;
}
