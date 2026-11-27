import { Skeleton } from "@/components/ui/skeleton";

export default function WechatLoading() {
  return (
    <div className="flex h-[calc(100svh-6.5rem)] min-h-[34rem] overflow-hidden surface rounded-2xl">
      <div className="w-[22rem] shrink-0 space-y-3 border-r border-border/70 p-4">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-9 w-full rounded-lg" />
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
      <div className="flex flex-1 flex-col justify-between p-6">
        <Skeleton className="h-12 w-64 rounded-xl" />
        <div className="space-y-3">
          <Skeleton className="h-14 w-80 rounded-2xl" />
          <Skeleton className="ml-auto h-14 w-72 rounded-2xl" />
          <Skeleton className="h-16 w-96 rounded-2xl" />
        </div>
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
  );
}
