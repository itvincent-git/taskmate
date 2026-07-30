import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ReactNode } from "react";

export function Popover({ trigger, children, align = "start" }: { trigger: ReactNode; children: ReactNode; align?: "start" | "center" | "end" }) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal><PopoverPrimitive.Content className="z-[350] max-h-[min(360px,var(--radix-popover-content-available-height))] min-w-[210px] overflow-auto rounded-lg border border-line bg-surface p-2 shadow-[0_12px_30px_rgba(0,0,0,.14)]" align={align} sideOffset={6}>{children}</PopoverPrimitive.Content></PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
