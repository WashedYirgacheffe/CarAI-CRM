"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** 产品卡主图 + 缩略图，点缩略图切换 */
export function ProductGallery({ images, alt }: { images: string[]; alt: string }) {
  const [i, setI] = useState(0);
  if (!images.length) {
    return <div className="flex aspect-square items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">No image</div>;
  }
  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={images[i]} alt={alt} className="aspect-square w-full rounded-xl bg-muted object-contain" />
      {images.length > 1 && (
        <div className="mt-3 grid grid-cols-5 gap-2">
          {images.map((src, k) => (
            <button
              key={src}
              type="button"
              data-track-click="image"
              aria-label={`Image ${k + 1}`}
              aria-current={k === i}
              onClick={() => setI(k)}
              className={cn(
                "overflow-hidden rounded-lg ring-2 ring-transparent ring-offset-2 ring-offset-card",
                k === i ? "ring-primary" : "opacity-70 hover:opacity-100",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="aspect-square w-full bg-muted object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
