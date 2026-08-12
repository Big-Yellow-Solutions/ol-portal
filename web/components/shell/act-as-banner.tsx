"use client";

import { useRouter } from "next/navigation";
import { api, clearActingAs } from "@/lib/api";
import { usePortalData } from "@/lib/portal-data";

export function ActAsBanner() {
  const { actingAsBy, refresh } = usePortalData();
  const router = useRouter();

  if (!actingAsBy) return null;

  const stop = async () => {
    await api("/admin/act-as/stop", { method: "POST" });
    clearActingAs();
    await refresh();
    router.push("/admin");
  };

  return (
    <div className="flex w-full items-center justify-center gap-3 bg-red px-4 py-2 text-sm text-white">
      <span>
        You are acting as this user on behalf of <strong>{actingAsBy}</strong>.
      </span>
      <button onClick={stop} className="underline underline-offset-2">
        Stop acting as
      </button>
    </div>
  );
}
