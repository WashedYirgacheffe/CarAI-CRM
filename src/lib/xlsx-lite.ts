/**
 * 浏览器里读 .xlsx 的第一个工作表（只取单元格文本，不要公式和样式），不引第三方库：
 * xlsx 是 zip 包，用浏览器自带的 DecompressionStream 解压，DOMParser 读 XML。
 */

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 读 zip 里的文件：文件名 → 内容（只解需要的） */
async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // 中央目录结尾记录（从后往前找签名 0x06054b50）
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 Excel 文件");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflate(raw));
  }
  return out;
}

const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** 读第一个工作表，返回行列文本 */
export async function readXlsx(file: File): Promise<string[][]> {
  const files = await unzip(await file.arrayBuffer(), (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const sheetName = [...files.keys()].filter((n) => n.startsWith("xl/worksheets/")).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))[0];
  if (!sheetName) throw new Error("Excel 里没有工作表");
  const dec = new TextDecoder();
  const parse = (b: Uint8Array) => new DOMParser().parseFromString(dec.decode(b), "application/xml");

  const shared: string[] = [];
  const ss = files.get("xl/sharedStrings.xml");
  if (ss) for (const si of Array.from(parse(ss).getElementsByTagName("si"))) shared.push(Array.from(si.getElementsByTagName("t")).map((t) => t.textContent ?? "").join(""));

  const rows: string[][] = [];
  for (const row of Array.from(parse(files.get(sheetName)!).getElementsByTagName("row"))) {
    const cells: string[] = [];
    for (const c of Array.from(row.getElementsByTagName("c"))) {
      const t = c.getAttribute("t");
      const val = c.getElementsByTagName("v")[0]?.textContent ?? "";
      const text =
        t === "s" ? (shared[Number(val)] ?? "") : t === "inlineStr" ? Array.from(c.getElementsByTagName("t")).map((x) => x.textContent ?? "").join("") : t === "b" ? (val === "1" ? "TRUE" : "FALSE") : val;
      const ref = c.getAttribute("r");
      const i = ref ? colIndex(ref) : cells.length;
      while (cells.length < i) cells.push("");
      cells[i] = text;
    }
    rows.push(cells);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}
