import { T, useGT } from "gt-react";
import { useState, type FormEvent } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

interface KanbanReworkDialogProps {
  readonly open: boolean;
  readonly cardTitle: string;
  readonly onCancel: () => void;
  readonly onConfirm: (feedback: string | undefined) => Promise<void>;
}

export function KanbanReworkDialog({
  open,
  cardTitle,
  onCancel,
  onConfirm,
}: KanbanReworkDialogProps) {
  const gt = useGT();
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (sendFeedback: boolean) => {
    if (submitting) return;
    setSubmitting(true);
    const trimmed = feedback.trim();
    await onConfirm(sendFeedback && trimmed.length > 0 ? trimmed : undefined);
    setSubmitting(false);
    setFeedback("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit(true);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            <T>Move back to In Progress</T>
          </DialogTitle>
          <DialogDescription>
            {gt(
              'Send rework instructions to the existing thread for "{title}", or move the card without sending a message.',
              { title: cardTitle },
            )}
          </DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-col" onSubmit={handleSubmit}>
          <DialogPanel>
            <div className="space-y-1.5">
              <Label htmlFor="kanban-rework-feedback">
                <T>Rework instructions (optional)</T>
              </Label>
              <Textarea
                id="kanban-rework-feedback"
                rows={4}
                placeholder={gt("Describe what needs to be fixed or adjusted...")}
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" type="button" />}>
              <T>Cancel</T>
            </DialogClose>
            <Button
              variant="outline"
              type="button"
              disabled={submitting}
              onClick={() => void submit(false)}
            >
              <T>Move only</T>
            </Button>
            <Button type="submit" disabled={submitting} data-slot="dialog-action">
              {feedback.trim().length > 0 ? gt("Move & send to thread") : gt("Move to In Progress")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
