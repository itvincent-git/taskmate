import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent text-xs font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-160 enabled:hover:-translate-y-px focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[color-mix(in_srgb,var(--accent)_14%,transparent)] disabled:cursor-default disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-accent text-[#fdfdfd] enabled:hover:bg-accent-hover enabled:hover:shadow-[0_4px_12px_color-mix(in_srgb,var(--accent)_35%,transparent)]",
        secondary: "bg-surface-soft text-foreground",
        ghost: "bg-transparent text-muted enabled:hover:bg-surface-soft enabled:hover:text-foreground aria-pressed:bg-surface-soft aria-pressed:text-foreground",
        destructive: "border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,var(--surface))] text-danger enabled:hover:bg-danger enabled:hover:text-[#fdfdfd]",
        outline: "border-line bg-surface text-foreground enabled:hover:border-accent enabled:hover:text-accent aria-pressed:border-accent aria-pressed:text-accent",
      },
      size: {
        default: "h-[34px] px-3.5",
        sm: "h-[30px] px-2.5",
        lg: "h-[38px] px-5",
        icon: "size-8 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";
