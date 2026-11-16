"use client";

import { useParams } from "next/navigation";
import { Bone } from "@/components/crm/page-skeleton";
import { HeroPage, HeroText, useHero } from "@/lib/nav-hero";

/*
 * 客户详情的骨架：和真实页面同一套标题栏、同一张档案卡片，方块和客户名落在同一个位置。
 * 从列表点进来时（nav-hero 里记下了名字）客户名直接写出来，列表里的名字移到这里，
 * 数据到了换成真页面时标题原地不动，不会跳。
 */
export default function Loading() {
  const { id } = useParams<{ id: string }>();
  const hero = useHero();
  const key = `cust:${id}`;
  const name = hero?.key === key ? hero.name : null;

  return (
    <HeroPage>
      <div
        role="status"
        aria-busy
        aria-label="正在加载"
        className="skeleton-shell space-y-3 md:space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Bone className="h-4 w-[4.5rem]" />
            <span className="h-4 w-px bg-border" aria-hidden />
            <h1 className="text-lg font-medium tracking-tight">客户详情</h1>
          </div>
          <Bone className="size-9 md:h-10 md:w-24 md:rounded-lg" />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 md:gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <section className="surface relative overflow-hidden">
            <div className="relative space-y-4 p-4 md:p-5">
              <div className="flex items-start gap-4">
                <Bone className="size-14 shrink-0 rounded-[30%_30%_30%_9%]" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <h2 className="text-xl leading-snug font-normal break-words">
                    {name ? (
                      <HeroText
                        heroKey={key}
                        className="inline-block max-w-full"
                      >
                        {name}
                      </HeroText>
                    ) : (
                      <Bone className="my-0.5 h-6 w-44 rounded-lg" />
                    )}
                  </h2>
                  <Bone className="h-5 w-28" />
                </div>
              </div>
              <div className="space-y-2.5">
                {["w-32", "w-40", "w-28", "w-36"].map((w) => (
                  <Bone key={w} className={`h-3.5 ${w}`} />
                ))}
              </div>
            </div>
          </section>

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
        </div>
        <span className="sr-only">正在加载…</span>
      </div>
    </HeroPage>
  );
}
