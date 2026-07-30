import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn("resize-y rounded-md border border-line bg-surface px-3.5 py-2.5 text-xs text-foreground outline-none transition-[border-color,box-shadow] duration-160 placeholder:text-neutral focus:border-accent focus:ring-3 focus:ring-[color-mix(in_srgb,var(--accent)_12%,transparent)] disabled:cursor-default disabled:opacity-50", className)} {...props} />,
);
Textarea.displayName = "Textarea";
