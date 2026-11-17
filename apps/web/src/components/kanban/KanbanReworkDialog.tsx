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
          <DialogTitle>Move back to In Progress</DialogTitle>
          <DialogDescription>
            Send rework instructions to the existing thread for "{cardTitle}", or move the card
            without sending a message.
          </DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-col" onSubmit={handleSubmit}>
          <DialogPanel>
            <div className="space-y-1.5">
              <Label htmlFor="kanban-rework-feedback">Rework instructions (optional)</Label>
              <Textarea
                id="kanban-rework-feedback"
                rows={4}
                placeholder="Describe what needs to be fixed or adjusted..."
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
            <Button
              variant="outline"
              type="button"
              disabled={submitting}
              onClick={() => void submit(false)}
            >
              Move only
            </Button>
            <Button type="submit" disabled={submitting} data-slot="dialog-action">
              {feedback.trim().length > 0 ? "Move & send to thread" : "Move to In Progress"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
