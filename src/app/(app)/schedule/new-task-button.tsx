"use client";

import { useState } from "react";
import { Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TaskForm } from "@/components/crm/tasks";

export function NewTaskButton({ tz, customers }: { tz: string; customers: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> 新建提醒
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">{open && <TaskForm tz={tz} customers={customers} onDone={() => setOpen(false)} />}</DialogContent>
      </Dialog>
    </>
  );
}
