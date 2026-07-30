import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("rounded-xl border border-line bg-surface p-4", className)} {...props} />;
}

export function CardHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <header>
      <h2 className="font-heading text-base">{title}</h2>
      {description ? <p className="text-muted">{description}</p> : null}
    </header>
  );
}
