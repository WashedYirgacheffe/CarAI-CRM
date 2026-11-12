import { Construction } from "@/components/icons";
import { PageHeader } from "@/components/page-header";

/** 尚未开发的模块占位页：说明上线阶段和计划能力，避免菜单点进去是 404。 */
export function PlannedModule({ title, phase, features }: { title: string; phase: string; features: string[] }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="rounded-xl border border-dashed bg-card p-8">
        <div className="flex items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Construction className="size-5" />
          </span>
          <div className="space-y-3">
            <p className="font-medium">
              该模块计划在 <span className="text-primary">{phase}</span> 阶段上线
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
