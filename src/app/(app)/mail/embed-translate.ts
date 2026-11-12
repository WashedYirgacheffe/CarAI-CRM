import { looksForeign } from "@/lib/lang";

/*
 * 嵌入式翻译（类似「沉浸式翻译」）：
 * 把邮件 HTML 按段落切开，逐段翻译，再把译文写回原段落里——译文继承原段的字体、字号、颜色、对齐。
 * - 双语：原文下面紧跟译文
 * - 译文：原文隐藏，只留译文（段内有图片的保留原文，免得图被一起藏掉）
 * 引用的历史邮件（On … wrote: / 发件人： 之后）不翻译。
 */

export type TrMode = "original" | "bilingual" | "translated";

const BLOCK = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "CAPTION",
  "CENTER",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);
const SKIP = new Set(["SCRIPT", "STYLE", "HEAD", "TITLE", "NOSCRIPT", "SVG", "CODE"]);

const QUOTE_TEXT = /^\s*(>|On .{4,200}wrote:|-{2,}\s*Original Message|From:\s|发件人[:：]|在 .{4,80}写道[:：]|-{2,}\s*原始邮件)/i;
const isQuoteEl = (el: Element) =>
  el.tagName === "BLOCKQUOTE" ||
  el.classList.contains("gmail_quote") ||
  el.classList.contains("yahoo_quoted") ||
  el.id === "divRplyFwdMsg" ||
  el.id === "appendonsend";

const MAX_SEGMENTS = 220;
const MAX_CHARS = 16000;

/** 段落里的文字：<br> 变换行，空白合并 */
function textOf(node: Node): string {
  let out = "";
  node.childNodes.forEach((c) => {
    if (c.nodeType === Node.TEXT_NODE) out += (c.textContent ?? "").replace(/\s+/g, " ");
    else if (c.nodeType === Node.ELEMENT_NODE) {
      const el = c as Element;
      if (SKIP.has(el.tagName)) return;
      if (el.tagName === "BR") out += "\n";
      else out += textOf(el);
    }
  });
  return out;
}

const hasBlockChild = (el: Element): boolean => Array.from(el.children).some((c) => BLOCK.has(c.tagName) || hasBlockChild(c));

/** 纯文本邮件转成简单 HTML，走同一套流程 */
export function textToHtml(text: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** 找出要翻译的段落：返回解析后的文档、段落元素和对应文字 */
function collect(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const els: Element[] = [];
  const texts: string[] = [];
  let chars = 0;
  let stopped = false;

  const push = (el: Element, t: string) => {
    const text = t
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!text) return;
    if (QUOTE_TEXT.test(text)) {
      stopped = true;
      return;
    }
    if (!looksForeign(text, 2) || chars + text.length > MAX_CHARS || els.length >= MAX_SEGMENTS) return;
    chars += text.length;
    els.push(el);
    texts.push(text);
  };

  const walk = (el: Element) => {
    if (stopped || SKIP.has(el.tagName)) return;
    if (isQuoteEl(el)) {
      stopped = true;
      return;
    }
    if (!hasBlockChild(el)) {
      push(el, textOf(el));
      return;
    }
    // 块里既有子块又有散落的文字：把连续的散字包成一段
    let run: Node[] = [];
    const flush = () => {
      if (run.length && run.some((n) => (n.textContent ?? "").trim())) {
        const span = doc.createElement("span");
        span.setAttribute("data-crm-run", "");
        run[0].parentNode!.insertBefore(span, run[0]);
        run.forEach((n) => span.appendChild(n));
        if (!stopped) push(span, textOf(span));
      }
      run = [];
    };
    for (const c of Array.from(el.childNodes)) {
      if (stopped) break;
      if (c.nodeType === Node.ELEMENT_NODE && (BLOCK.has((c as Element).tagName) || hasBlockChild(c as Element))) {
        flush();
        walk(c as Element);
      } else if (c.nodeType === Node.TEXT_NODE || (c.nodeType === Node.ELEMENT_NODE && !SKIP.has((c as Element).tagName))) run.push(c);
    }
    flush();
  };

  if (doc.body) walk(doc.body);
  return { doc, els, texts };
}

/** 要翻译的段落文字（顺序与 renderTranslated 一致） */
export function segmentsOf(html: string): string[] {
  if (typeof DOMParser === "undefined") return [];
  return collect(html).texts;
}

/** 把译文写回 HTML。translations 与 segmentsOf 的结果一一对应 */
export function renderTranslated(html: string, translations: string[] | null, mode: TrMode): string {
  if (mode === "original" || !translations?.length || typeof DOMParser === "undefined") return html;
  const { doc, els } = collect(html);
  els.forEach((el, i) => {
    const tr = translations[i]?.trim();
    if (!tr) return;
    const box = doc.createElement("font");
    box.className = "crm-tr";
    tr.split("\n").forEach((line, j) => {
      if (j) box.appendChild(doc.createElement("br"));
      box.appendChild(doc.createTextNode(line));
    });
    if (mode === "translated" && !el.querySelector("img")) {
      const orig = doc.createElement("span");
      orig.className = "crm-orig";
      while (el.firstChild) orig.appendChild(el.firstChild);
      el.appendChild(orig);
      box.classList.add("crm-tr-only");
    }
    el.appendChild(box);
  });
  return doc.body.innerHTML;
}
