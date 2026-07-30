import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { cn } from "../../lib/utils";
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
  contentClassName,
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
  contentClassName?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[300] bg-[rgba(10,10,10,.58)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-[301] max-h-[calc(100vh-48px)] w-[min(900px,calc(100vw-40px))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-line bg-surface p-5 shadow-[0_24px_80px_rgba(0,0,0,.26)] [&>h2]:mr-9 [&>h2]:mb-1 [&>h2]:font-heading [&>h2]:text-2xl [&>h2]:tracking-[-.03em] [&>p]:m-0 [&>p]:text-muted",
            drawer && "inset-y-0 right-0 left-auto flex h-screen max-h-none w-[min(380px,calc(100vw-24px))] translate-x-0 translate-y-0 flex-col overflow-hidden rounded-l-xl rounded-r-none border-y-0 border-r-0 [&>h2]:shrink-0",
            contentClassName,
          )}
          onCloseAutoFocus={returnFocusRef ? (event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          } : undefined}
        >
          <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
          {description ? <DialogPrimitive.Description>{description}</DialogPrimitive.Description> : null}
          <div className={cn("mt-4", drawer && "min-h-0 flex-1 overflow-hidden")}>{children}</div>
          {footer ? <div className="mt-5 flex justify-end gap-1.5">{footer}</div> : null}
          <DialogPrimitive.Close asChild><Button variant="ghost" size="icon" className="absolute top-3 right-3" aria-label={closeLabel}><X size={16} /></Button></DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
