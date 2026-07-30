import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal><TooltipPrimitive.Content className="z-[250] rounded-md bg-foreground px-2 py-1 text-xs text-surface shadow-panel" sideOffset={5}>{label}<TooltipPrimitive.Arrow className="fill-foreground" /></TooltipPrimitive.Content></TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
