import Image from "next/image";
import { cn } from "@/lib/utils";

/** CarAI 方块图标（紫蓝底 + 白色 C 和三角） */
export function BrandMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/carai-mark.svg"
      alt=""
      aria-hidden
      width={64}
      height={64}
      priority
      className={cn("size-8 shrink-0 rounded-[25%]", className)}
    />
  );
}

/** CarAI 字标，高度由 className 控制（宽高比 1909:437）。onDark 用深底版 */
export function Brand({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  return (
    <Image
      src={onDark ? "/brand/carai-wordmark-dark-bg.svg" : "/brand/carai-wordmark.svg"}
      alt="CarAI"
      width={1909}
      height={437}
      priority
      className={cn("h-7 w-auto", className)}
    />
  );
}
