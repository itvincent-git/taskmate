import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { DayPicker, getDefaultClassNames, type DayPickerProps } from "react-day-picker";
import { cn } from "../../lib/utils";
import { buttonVariants } from "./Button";

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: DayPickerProps) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("w-fit p-3", className)}
      classNames={{
        root: cn("relative", defaultClassNames.root),
        months: cn("relative flex flex-col gap-4", defaultClassNames.months),
        month: cn("flex w-full flex-col gap-3", defaultClassNames.month),
        month_caption: cn("flex h-8 items-center justify-center", defaultClassNames.month_caption),
        caption_label: cn("text-xs font-semibold", defaultClassNames.caption_label),
        nav: cn("absolute inset-x-0 top-0 flex items-center justify-between", defaultClassNames.nav),
        button_previous: cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-8", defaultClassNames.button_previous),
        button_next: cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-8", defaultClassNames.button_next),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn("w-8 text-center text-[11px] font-normal text-muted", defaultClassNames.weekday),
        week: cn("mt-1 flex w-full", defaultClassNames.week),
        day: cn("relative size-8 p-0 text-center", defaultClassNames.day),
        day_button: cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-8 font-normal", defaultClassNames.day_button),
        selected: cn("[&_button]:bg-accent [&_button]:text-white", defaultClassNames.selected),
        today: cn("rounded-md bg-accent-soft text-accent", defaultClassNames.today),
        outside: cn("text-neutral opacity-50", defaultClassNames.outside),
        disabled: cn("text-neutral opacity-40", defaultClassNames.disabled),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Chevron: ({ className: chevronClassName, orientation }) => {
          const Icon = orientation === "left" ? ChevronLeft : orientation === "right" ? ChevronRight : orientation === "up" ? ChevronUp : ChevronDown;
          return <Icon className={cn("size-4", chevronClassName)} />;
        },
      }}
      {...props}
    />
  );
}
