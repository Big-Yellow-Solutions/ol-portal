"use client";

import { useRouter } from "next/navigation";
import { api, clearActingAs } from "@/lib/api";
import { usePortalData } from "@/lib/portal-data";
import { fullName } from "@/lib/data";

export function ActAsBanner() {
  const { actingAs, me, people, refresh } = usePortalData();
  const router = useRouter();

  if (!actingAs) return null;

  const viewingAs = me ? fullName(people[me]) || me : me;

  const stop = async () => {
    await api("/admin/act-as/stop", { method: "POST" });
    clearActingAs();
    await refresh();
    router.push("/admin");
  };

  return (
    <div className="flex w-full items-center justify-center gap-3 bg-red px-4 py-2 text-sm text-white">
      <span>
        {actingAs.byName || actingAs.by} is viewing the portal as{" "}
        <strong>{viewingAs}</strong>.
      </span>
      <button onClick={stop} className="underline underline-offset-2">
        Stop acting as
      </button>
    </div>
  );
}
