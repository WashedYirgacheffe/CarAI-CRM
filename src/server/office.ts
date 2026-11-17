import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { extOf, fileKind } from "@/lib/files";

/*
 * Excel / Word / PPT 转 PDF：用 LibreOffice（Docker 镜像里装了 soffice + 中英文字体）。
 * 转出来的 PDF 跟用 Office 打开、打印出来的样子基本一致：合并单元格、边框、字体、图片、印章都在。
 * 表格默认「每张工作表一页」（SinglePageSheets），不会被打印分页切碎；特别大的表还是按正常分页。
 * 一次只转一个（soffice 同一个配置目录不能并发，内存也省），本机没装 soffice 时返回 null，页面退回表格预览。
 */

const SOFFICE = process.env.SOFFICE_PATH || "soffice";
const TIMEOUT = 90_000;
const PROFILE = `file://${path.join(os.tmpdir(), "crm-lo-profile")}`;

let missing = false;
let queue: Promise<unknown> = Promise.resolve();

export const officeAvailable = () => !missing;

export function officeToPdf(buf: Buffer, name: string): Promise<Buffer | null> {
  if (missing) return Promise.resolve(null);
  const run = queue.then(() => convert(buf, name));
  queue = run.catch(() => null);
  return run;
}

/** 行列不多的表才放一页：几千行的流水表放一页，缩到看不清 */
function singlePage(buf: Buffer) {
  try {
    const wb = XLSX.read(buf, { type: "buffer", sheetRows: 400, bookSheets: false, cellFormula: false, cellHTML: false, cellText: false });
    return wb.SheetNames.every((n) => {
      const ref = wb.Sheets[n]?.["!ref"];
      if (!ref) return true;
      const r = XLSX.utils.decode_range(ref);
      return r.e.r - r.s.r < 250 && r.e.c - r.s.c < 40;
    });
  } catch {
    return true;
  }
}

async function convert(buf: Buffer, name: string): Promise<Buffer | null> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crm-office-"));
  try {
    const ext = extOf(name) || "bin";
    const input = path.join(dir, `in.${ext}`);
    await writeFile(input, buf);
    const sheet = fileKind(name) === "sheet";
    const filter =
      sheet && singlePage(buf)
        ? 'pdf:calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"true"}}'
        : "pdf";
    await new Promise<void>((resolve, reject) =>
      execFile(
        SOFFICE,
        [`-env:UserInstallation=${PROFILE}`, "--headless", "--norestore", "--nologo", "--nolockcheck", "--convert-to", filter, "--outdir", dir, input],
        { timeout: TIMEOUT, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 },
        (err) => (err ? reject(err) : resolve()),
      ),
    );
    const pdf = await readFile(path.join(dir, "in.pdf"));
    return pdf.length > 100 ? pdf : null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT" && !(e as { path?: string }).path?.endsWith(".pdf")) {
      missing = true;
      console.warn("[office] 没有安装 LibreOffice（soffice），Office 文件只能按表格 / 文字预览");
    } else console.error("[office] convert", name, e instanceof Error ? e.message : e);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
