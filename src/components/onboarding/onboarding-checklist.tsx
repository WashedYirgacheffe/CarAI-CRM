"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runAction } from "@/hooks/use-action-form";
import { dismissOnboardingAction } from "@/app/(app)/dashboard/actions";
import type { OnboardingStep } from "@/server/onboarding";
import { cn } from "@/lib/utils";

/** 工作台顶部的上手清单：做完一项自动打勾，全部完成后不再出现 */
export function OnboardingChecklist({ steps }: { steps: OnboardingStep[] }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  return (
    <section aria-labelledby="onboarding-title" className="surface mb-4 overflow-hidden">
      <header className="flex items-center gap-3 px-4 pt-4 pb-3 md:px-5">
        <div className="min-w-0 flex-1">
          <h2 id="onboarding-title" className="font-semibold">
            上手清单 <span className="ml-1 text-sm font-normal text-muted-foreground tabular-nums">{`${done}/${steps.length}`}</span>
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">做完这几步，邮件、WhatsApp、客户和产品就都连起来了</p>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="收起上手清单"
          title="收起，不再显示"
          onClick={async () => {
            setHidden(true);
            await runAction(dismissOnboardingAction());
          }}
        >
          <X />
        </Button>
      </header>
      <div
        className="mx-4 h-1.5 overflow-hidden rounded-full bg-muted md:mx-5"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="grid gap-px p-2 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.key}>
            <Link
              href={s.href}
              className={cn(
                "group flex h-full items-start gap-3 rounded-xl p-3 transition-colors hover:bg-muted/50",
                s === next && "bg-primary/[0.04] ring-1 ring-primary/20",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                  s.done ? "bg-emerald-500 text-white" : "border-2 border-border text-muted-foreground",
                )}
                aria-label={s.done ? "已完成" : "未完成"}
              >
                {s.done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-medium", s.done && "text-muted-foreground line-through decoration-muted-foreground/50")}>
                  {s.title}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{s.why}</span>
                {!s.done && (
                  <span className="mt-1.5 inline-flex items-center gap-0.5 text-xs font-medium text-primary group-hover:underline">
                    {s.cta} <ArrowRight className="size-3" />
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
