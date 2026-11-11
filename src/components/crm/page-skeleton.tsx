import { cn } from "@/lib/utils";

/*
 * 路由切换时的骨架屏（各路由的 loading.tsx 用）。
 * 点击后立刻切到目标页，先显示和真实页面同结构的灰块，数据到了再替换。
 * 骨架整体带 120ms 延迟淡入：很快就加载完的页面不会闪一下灰块。
 */

/** 单个灰块：横扫的柔光，而不是整块闪烁 */
export function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cn("skeleton-bone block rounded-full", className)} style={style} />;
}

function Shell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-label="正在加载" aria-busy className={cn("skeleton-shell", className)}>
      {children}
      <span className="sr-only">正在加载…</span>
    </div>
  );
}

/** 与 PageHeader 同尺寸：大标题 + 一行说明 + 右侧按钮 */
export function HeaderBones({ action = true }: { action?: boolean }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4 md:mb-6">
      <div className="space-y-2.5">
        <Bone className="h-7 w-32 rounded-lg md:h-8 md:w-40" />
        <Bone className="h-3.5 w-48 md:w-64" />
      </div>
      {action && <Bone className="h-9 w-24" />}
    </div>
  );
}

/** 顶部统计卡片行：手机两张，桌面四张 */
function StatBones({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-3 md:mb-6 md:gap-4 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn("surface space-y-4 p-4 md:p-5", i >= 2 && "hidden lg:block")}>
          <Bone className="h-3.5 w-16" />
          <Bone className="h-7 w-20 rounded-lg" />
          <div className="space-y-2">
            <Bone className="h-2 w-full" />
            <Bone className="h-2 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 一行表格/列表：头像 + 两行文字 + 右侧状态 */
function RowBone({ i }: { i: number }) {
  // 宽度轮换，避免整齐划一像假的
  const w = ["w-40", "w-56", "w-32", "w-48", "w-36"][i % 5];
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 md:px-5">
      <Bone className="size-9 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <Bone className={cn("h-3.5 max-w-full", w)} />
        <Bone className="h-3 w-24" />
      </div>
      <Bone className="hidden h-3.5 w-20 sm:block" />
      <Bone className="hidden h-3.5 w-16 md:block" />
      <Bone className="h-6 w-14" />
    </div>
  );
}

/** 列表页：标题 + （可选统计卡）+ 白卡片里的工具条和若干行 */
export function ListSkeleton({ stats = false, rows = 8, action = true }: { stats?: boolean; rows?: number; action?: boolean }) {
  return (
    <Shell>
      <HeaderBones action={action} />
      {stats && <StatBones />}
      <div className="surface overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3 md:px-5">
          <Bone className="h-9 w-full max-w-64" />
          <Bone className="ml-auto hidden h-9 w-20 sm:block" />
          <Bone className="hidden h-9 w-20 sm:block" />
        </div>
        <div className="divide-y divide-border/50">
          {Array.from({ length: rows }, (_, i) => (
            <RowBone key={i} i={i} />
          ))}
        </div>
      </div>
    </Shell>
  );
}

/** 工作台 / 报表：统计卡 + 两列图表卡 */
export function DashboardSkeleton() {
  return (
    <Shell>
      <HeaderBones action={false} />
      <StatBones />
      <div className="grid gap-3 md:gap-4 lg:grid-cols-3">
        <div className="surface space-y-5 p-5 lg:col-span-2">
          <Bone className="h-4 w-28" />
          <div className="flex h-48 items-end gap-2">
            {[45, 70, 55, 85, 40, 65, 90, 50, 75, 60].map((h, i) => (
              <Bone key={i} className="flex-1 rounded-md" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
        <div className="surface space-y-4 p-5">
          <Bone className="h-4 w-24" />
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Bone className="size-8 shrink-0" />
              <div className="flex-1 space-y-2">
                <Bone className="h-3 w-3/4" />
                <Bone className="h-2.5 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

/** 详情页：标题区 + 左侧主卡 + 右侧信息卡 */
export function DetailSkeleton() {
  return (
    <Shell>
      <div className="mb-3 flex items-center gap-3 md:mb-6">
        <Bone className="size-12 shrink-0 md:size-14" />
        <div className="flex-1 space-y-2.5">
          <Bone className="h-6 w-44 rounded-lg md:h-7" />
          <Bone className="h-3.5 w-60 max-w-full" />
        </div>
        <Bone className="hidden h-9 w-24 sm:block" />
      </div>
      <div className="grid gap-3 md:gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="surface space-y-5 p-5">
          <div className="flex gap-2">
            {[16, 20, 16, 14].map((w, i) => (
              <Bone key={i} className="h-8" style={{ width: `${w * 4}px` }} />
            ))}
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex gap-3">
              <Bone className="size-8 shrink-0" />
              <div className="flex-1 space-y-2">
                <Bone className="h-3.5 w-1/3" />
                <Bone className="h-3 w-full" />
                <Bone className="h-3 w-4/5" />
              </div>
            </div>
          ))}
        </div>
        <div className="surface hidden space-y-4 p-5 lg:block">
          <Bone className="h-4 w-20" />
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex justify-between gap-4">
              <Bone className="h-3 w-14" />
              <Bone className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

/** 商机看板：横向几列卡片 */
export function BoardSkeleton() {
  return (
    <Shell>
      <HeaderBones />
      <div className="flex gap-3 overflow-hidden md:gap-4">
        {[3, 2, 4, 1, 2].map((n, c) => (
          <div key={c} className="w-64 shrink-0 space-y-3 rounded-2xl bg-muted/50 p-3">
            <Bone className="h-4 w-20" />
            {Array.from({ length: n }, (_, i) => (
              <div key={i} className="surface space-y-2.5 p-3.5">
                <Bone className="h-3.5 w-3/4" />
                <Bone className="h-3 w-1/2" />
                <Bone className="h-5 w-16" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Shell>
  );
}

/** 表单页（设置、新建、编辑）：标题 + 一张字段卡 */
export function FormSkeleton() {
  return (
    <Shell>
      <HeaderBones action={false} />
      <div className="surface max-w-3xl space-y-6 p-5 md:p-6">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="space-y-2.5">
            <Bone className="h-3.5 w-20" />
            <Bone className="h-10 w-full rounded-xl" />
          </div>
        ))}
        <Bone className="h-9 w-24" />
      </div>
    </Shell>
  );
}

/** 左列表 + 右阅读区（WhatsApp、邮件）。手机上只有列表，且和 WhatsApp 一样贴边 */
export function SplitSkeleton({ bleed = false }: { bleed?: boolean }) {
  return (
    <Shell
      className={cn(
        "flex overflow-hidden surface",
        bleed
          ? "-mx-3 -mt-3 -mb-4 h-[calc(100svh-6.75rem-1px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] rounded-none shadow-none md:m-0 md:h-[calc(100svh-6.5rem)] md:rounded-2xl md:shadow-[var(--card-shadow)]"
          : "h-[calc(100svh-8.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] md:h-[calc(100svh-6.5rem)]",
      )}
    >
      <div className="w-full md:w-[22rem] md:shrink-0 md:border-r md:border-border/70">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <Bone className="size-10 shrink-0" />
          <div className="flex-1 space-y-2">
            <Bone className="h-3.5 w-24" />
            <Bone className="h-3 w-36" />
          </div>
        </div>
        <div className="space-y-2.5 px-4 pb-3">
          <Bone className="h-9 w-full" />
          <div className="flex gap-1.5">
            {[10, 10, 10, 13].map((w, i) => (
              <Bone key={i} className="h-6" style={{ width: `${w * 4}px` }} />
            ))}
          </div>
        </div>
        <div className="px-4 md:px-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 py-3 md:px-2.5">
              <Bone className="size-12 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="flex justify-between gap-3">
                  <Bone className={cn("h-3.5", ["w-24", "w-36", "w-28", "w-20"][i % 4])} />
                  <Bone className="h-3 w-10" />
                </div>
                <Bone className={cn("h-3", ["w-4/5", "w-3/5", "w-2/3", "w-1/2"][i % 4])} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="hidden flex-1 flex-col md:flex">
        <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <Bone className="size-10" />
          <Bone className="h-3.5 w-32" />
        </div>
        <div className="flex-1 space-y-4 p-6">
          {[
            ["w-2/5", "mr-auto"],
            ["w-1/3", "ml-auto"],
            ["w-1/2", "mr-auto"],
            ["w-1/4", "ml-auto"],
          ].map(([w, side], i) => (
            <Bone key={i} className={cn("h-12 rounded-2xl", w, side)} />
          ))}
        </div>
      </div>
    </Shell>
  );
}
