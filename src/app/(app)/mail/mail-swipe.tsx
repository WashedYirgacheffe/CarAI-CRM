"use client";

import { Check, MailOpen, MailWarning, Star, StarOff } from "@/components/icons";
import { SwipeRow } from "@/components/crm/swipe-row";
import { runAction } from "@/hooks/use-action-form";
import { setMailDoneAction, setSeenAction, setStarredAction } from "./actions";

/** 手机邮件列表一行：右滑标已读 / 未读，左滑「已处理」「星标」 */
export function MailSwipe({
  id,
  seen,
  starred,
  inbox,
  children,
}: {
  id: string;
  seen: boolean;
  starred: boolean;
  inbox: boolean;
  children: React.ReactNode;
}) {
  return (
    <SwipeRow
      contentClassName="bg-card"
      left={[
        { label: seen ? "未读" : "已读", icon: seen ? MailWarning : MailOpen, tone: "sky", onAction: () => void runAction(setSeenAction(id, !seen)) },
      ]}
      right={[
        { label: "已处理", icon: Check, tone: "emerald", hidden: !inbox, onAction: () => void runAction(setMailDoneAction(id, true)) },
        {
          label: starred ? "取消星标" : "星标",
          icon: starred ? StarOff : Star,
          tone: "amber",
          onAction: () => void runAction(setStarredAction(id, !starred)),
        },
      ]}
    >
      {children}
    </SwipeRow>
  );
}
