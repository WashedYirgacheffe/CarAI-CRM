/** AI 记忆：前后端共用的类型和文案 */

export const MEMORY_KINDS = { fact: "事实", preference: "偏好", rule: "规则", decision: "决定", howto: "做法" } as const;
export type MemoryKind = keyof typeof MEMORY_KINDS;
export type MemoryScope = "personal" | "customer" | "team";
export type MemorySource = "user_said" | "ai_found" | "outside";

export const MEMORY_SOURCES: Record<MemorySource, string> = { user_said: "你说的", ai_found: "AI 发现", outside: "来自邮件 / 网页" };
export const MEMORY_SCOPES: Record<MemoryScope, string> = { personal: "我的", customer: "客户", team: "团队" };

/** 对话里「记住了 / 忘掉了」的回执，以及这轮参考了哪些记忆 */
export type MemoryNote = { id: string; title: string; op: "saved" | "updated" | "merged" | "disputed" | "forgotten"; scope?: MemoryScope };
export type MemoryRef = { id: string; title: string };
