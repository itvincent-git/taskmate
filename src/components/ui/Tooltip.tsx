import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentProps, ReactElement } from "react";

export function Tooltip({ label, children, side }: { label: string; children: ReactElement; side?: ComponentProps<typeof TooltipPrimitive.Content>["side"] }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal><TooltipPrimitive.Content className="z-[250] rounded-md bg-foreground px-2 py-1 text-xs text-surface shadow-panel" side={side} sideOffset={5}>{label}<TooltipPrimitive.Arrow className="fill-foreground" /></TooltipPrimitive.Content></TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
