import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn("min-h-[38px] rounded-md border border-line bg-surface px-3.5 py-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-160 placeholder:text-neutral focus:border-accent focus:ring-3 focus:ring-[color-mix(in_srgb,var(--accent)_12%,transparent)] disabled:cursor-default disabled:opacity-50", className)} {...props} />,
);
Input.displayName = "Input";
