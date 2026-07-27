import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Button } from "./Button";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  drawer = false,
  closeLabel = "Close",
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  drawer?: boolean;
  closeLabel?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-dialog-overlay" />
        <DialogPrimitive.Content
          className={`ui-dialog-content${drawer ? " ui-dialog-drawer" : ""}`}
          onCloseAutoFocus={returnFocusRef ? (event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          } : undefined}
        >
          <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
          {description ? <DialogPrimitive.Description>{description}</DialogPrimitive.Description> : null}
          <div className="ui-dialog-body">{children}</div>
          {footer ? <div className="ui-dialog-footer">{footer}</div> : null}
          <DialogPrimitive.Close asChild><Button variant="ghost" size="icon" className="ui-dialog-close" aria-label={closeLabel}><X size={16} /></Button></DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
