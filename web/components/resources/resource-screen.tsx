"use client";

import { PillButton } from "@/components/resources/chrome";
import { AdminPanel, DetailPanel, RelatedPanel } from "@/components/resources/panels";
import { ResourceViewer } from "@/components/resource-viewer";
import { fileExt } from "@/lib/resources-view";
import { PERMISSION_LABELS, RESOURCE_TYPE_LABELS } from "@/lib/types";
import type { CourseBacklink, ResourceItem } from "@/lib/types";

function fmtDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.valueOf())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function ResourceScreen({
  resource,
  related,
  isAdmin,
  labName,
  onOpenResource,
  onOpenCourse,
  onEdit,
  onDelete,
  onViewed,
  lookup,
}: {
  resource: ResourceItem;
  related: ResourceItem[];
  isAdmin: boolean;
  labName: string;
  onOpenResource: (r: ResourceItem) => void;
  onOpenCourse: (c: CourseBacklink) => void;
  onEdit: () => void;
  onDelete: () => void;
  onViewed?: () => void;
  lookup: (id: string) => ResourceItem | undefined;
}) {
  const courses = resource.courses ?? [];

  return (
    <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_340px]">
      <main className="min-w-0">
        {courses.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[14px] border border-hair bg-violet-pale px-[18px] py-3.5">
            <span className="text-sm text-ink/[0.82]">
              This is a step in{" "}
              {courses.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ", "}
                  {c.title}
                </span>
              ))}
            </span>
            <span className="flex-1" />
            <PillButton
              onClick={() => onOpenCourse(courses[0])}
              className="px-[15px] py-[7px]"
            >
              Open course
            </PillButton>
          </div>
        )}

        {resource.description && (
          <p className="mt-0 mb-[22px] text-xl leading-[1.55] text-pretty text-ink/[0.82]">
            {resource.description}
          </p>
        )}

        {/* Files get the design's header — extension chip, name, size — above
            the viewer. The Download control itself stays inside ResourceViewer
            rather than being duplicated here, since that is what records the
            download and mints the presigned URL. */}
        {resource.type === "file" ? (
          <div className="mb-[22px] rounded-[20px] border border-hair bg-white p-5 shadow-card">
            <div className="mb-4 flex flex-wrap items-center gap-3.5">
              <span className="flex size-11 flex-none items-center justify-center rounded-[12px] bg-violet-pale text-[11px] font-bold tracking-[0.08em] text-violet-deep">
                {fileExt(resource)}
              </span>
              <div className="min-w-40 flex-1">
                <div className="text-[15px] font-semibold">
                  {resource.fileName ?? resource.title}
                </div>
                <div className="text-[13px] text-warm-gray">
                  {RESOURCE_TYPE_LABELS[resource.type]}
                </div>
              </div>
            </div>
            <ResourceViewer resource={resource} onViewed={onViewed} lookup={lookup} />
          </div>
        ) : (
          <div className="mb-[22px]">
            <ResourceViewer resource={resource} onViewed={onViewed} lookup={lookup} />
          </div>
        )}

        {(resource.tags ?? []).length > 0 && (
          <div className="flex flex-wrap gap-2.5">
            {(resource.tags ?? []).map((t) => (
              <span
                key={t}
                className="rounded-full bg-violet-pale px-3.5 py-2 text-[13px] font-medium text-violet-deep"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </main>

      <aside className="flex flex-col gap-4">
        <DetailPanel
          title="Details"
          rows={[
            { label: "Type", value: RESOURCE_TYPE_LABELS[resource.type] },
            { label: "Lab", value: labName },
            { label: "Published", value: fmtDate(resource.publishedAt ?? resource.created) },
            ...(resource.type === "file"
              ? [{ label: "Downloads", value: String(resource.downloads ?? 0) }]
              : []),
            { label: "Access", value: PERMISSION_LABELS[resource.permission] },
          ]}
        />

        <RelatedPanel items={related} onOpen={onOpenResource} />

        {isAdmin && (
          <AdminPanel
            title="Admin"
            body={
              courses.length > 0
                ? `Visible in the library and used as a step in ${courses.length} course${courses.length === 1 ? "" : "s"}.`
                : "Visible in the library. Not used in a course yet."
            }
          >
            <PillButton tone="solid" onClick={onEdit}>
              Edit resource
            </PillButton>
            <PillButton onClick={onDelete}>Delete</PillButton>
          </AdminPanel>
        )}
      </aside>
    </div>
  );
}
