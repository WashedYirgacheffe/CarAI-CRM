"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Download,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NativeSelect } from "@/components/native-select";
import {
  FilePreviewDialog,
  type PreviewFile,
} from "@/components/crm/file-preview";
import { FILE_CATEGORIES, fileCategoryLabel, fileSizeText } from "@/lib/files";
import { uploadCrmFile } from "@/lib/upload-file";
import { formatDate } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { deleteFileAction, updateFileAction } from "@/app/(app)/files/actions";
import { PaneEmpty, PaneToolbar } from "./detail-ui";

export type CustomerFileRow = {
  id: string;
  name: string;
  mime: string;
  size: number;
  category: string;
  note: string | null;
  source: string;
  createdAt: string;
  createdBy: string | null;
};

const SOURCE_LABEL: Record<string, string> = {
  ai: "AI 生成",
  whatsapp: "来自 WhatsApp",
  mail: "来自邮件",
};

export function CustomerFiles({
  customerId,
  files,
  canEdit,
  tz,
}: {
  customerId: string;
  files: CustomerFileRow[];
  canEdit: boolean;
  tz: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [filter, setFilter] = useState<string>("ALL");
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const [editing, setEditing] = useState<CustomerFileRow | null>(null);
  const [deleting, setDeleting] = useState<CustomerFileRow | null>(null);
  const [pending, start] = useTransition();

  const upload = async (list: FileList | null) => {
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    setUploading(picked.length);
    let ok = 0;
    for (const f of picked) {
      try {
        await uploadCrmFile(f, { customerId });
        ok++;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "上传失败");
      }
      setUploading((n) => n - 1);
    }
    if (ok) toast.success(`已上传 ${ok} 个文件`);
    router.refresh();
  };

  const counts = new Map<string, number>();
  for (const f of files)
    counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  const shown =
    filter === "ALL" ? files : files.filter((f) => f.category === filter);
  const open = (f: CustomerFileRow) =>
    setPreview({
      src: `/api/crm-files/${f.id}`,
      download: `/api/crm-files/${f.id}?download`,
      name: f.name,
      mime: f.mime,
      size: f.size,
    });

  return (
    <div
      onDragOver={(e) => canEdit && e.preventDefault()}
      onDrop={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        void upload(e.dataTransfer.files);
      }}
    >
      <PaneToolbar
        action={
          canEdit && (
            <>
              <input
                ref={input}
                type="file"
                multiple
                hidden
                onChange={(e) => (
                  void upload(e.target.files),
                  (e.target.value = "")
                )}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={uploading > 0}
                onClick={() => input.current?.click()}
              >
                {uploading > 0 ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Plus />
                )}{" "}
                {uploading > 0 ? `上传中（${uploading}）` : "上传文件"}
              </Button>
            </>
          )
        }
      >
        {files.length > 0
          ? `共 ${files.length} 个文件，可拖进来上传；AI 助手也能读这些文件`
          : null}
      </PaneToolbar>

      {files.length > 0 && counts.size > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {[
            ["ALL", files.length] as const,
            ...FILE_CATEGORIES.filter((c) => counts.has(c.value)).map(
              (c) => [c.value, counts.get(c.value)!] as const,
            ),
          ].map(([v, n]) => (
            <button
              key={v}
              type="button"
              onClick={() => setFilter(v)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs",
                filter === v
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              )}
            >
              {v === "ALL" ? "全部" : fileCategoryLabel(v)}{" "}
              <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>
      )}

      {files.length === 0 ? (
        <PaneEmpty>
          {canEdit
            ? "还没有文件。PI、CI、装箱单、原产地证、合同都可以传上来，拖进来也行"
            : "还没有文件"}
        </PaneEmpty>
      ) : (
        <ul className="divide-y divide-border/70">
          {shown.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2.5">
              <button
                type="button"
                onClick={() => open(f)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                title="点击预览"
              >
                <FileText className="size-8 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium hover:underline">
                      {f.name}
                    </span>
                    <Badge variant="secondary" className="shrink-0">
                      {fileCategoryLabel(f.category)}
                    </Badge>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[
                      fileSizeText(f.size),
                      formatDate(f.createdAt, tz),
                      f.createdBy,
                      SOURCE_LABEL[f.source],
                      f.note,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label="更多">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <a href={`/api/crm-files/${f.id}?download`}>
                      <Download /> 下载
                    </a>
                  </DropdownMenuItem>
                  {canEdit && (
                    <>
                      <DropdownMenuItem onSelect={() => setEditing(f)}>
                        <Pencil /> 改名 / 分类
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setDeleting(f)}
                      >
                        <Trash2 /> 删除
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <FilePreviewDialog file={preview} onClose={() => setPreview(null)} />
      {editing && (
        <EditFileDialog file={editing} onClose={() => setEditing(null)} />
      )}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除「{deleting?.name}」？</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">删除后不能恢复。</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteFileAction(deleting!.id);
                  (r.ok ? toast.success : toast.error)(r.message);
                  setDeleting(null);
                  router.refresh();
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />} 删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditFileDialog({
  file,
  onClose,
}: {
  file: CustomerFileRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(file.name);
  const [category, setCategory] = useState(file.category);
  const [note, setNote] = useState(file.note ?? "");
  const [pending, start] = useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑文件</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="file-name">文件名</Label>
            <Input
              id="file-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="file-cat">分类</Label>
            <NativeSelect
              id="file-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {FILE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="file-note">备注</Label>
            <Textarea
              id="file-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await updateFileAction(file.id, {
                  name,
                  category,
                  note,
                });
                (r.ok ? toast.success : toast.error)(r.message);
                if (r.ok) {
                  onClose();
                  router.refresh();
                }
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />} 保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
