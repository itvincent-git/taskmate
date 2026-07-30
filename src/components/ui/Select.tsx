import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface SelectOption {
  value: string;
  label: ReactNode;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  ariaLabel,
  disabled,
  className,
}: {
  value?: string;
  onValueChange(value: string): void;
  options: SelectOption[];
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <SelectPrimitive.Root value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger className={cn("inline-flex h-[38px] min-w-28 cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-md border border-line bg-surface px-3 text-xs text-foreground outline-none transition-[border-color,box-shadow] duration-160 focus:border-accent focus:ring-3 focus:ring-[color-mix(in_srgb,var(--accent)_12%,transparent)] disabled:cursor-default disabled:opacity-50 [&>span:first-child]:min-w-0 [&>span:first-child]:truncate", className)} aria-label={ariaLabel}>
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon><ChevronDown size={14} /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="z-[350] max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-auto rounded-lg border border-line bg-surface p-[5px] shadow-[0_12px_30px_rgba(0,0,0,.14)]" position="popper" sideOffset={5}>
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item className="relative flex min-h-[34px] cursor-default items-center rounded-[5px] py-[7px] pr-7 pl-[30px] text-xs outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent [&>span:first-child]:absolute [&>span:first-child]:left-[9px]" value={option.value} key={option.value}>
                <SelectPrimitive.ItemIndicator><Check size={13} /></SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
