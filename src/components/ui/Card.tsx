import type { HTMLAttributes, ReactNode } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`card ${className}`} {...props} />;
}

export function CardHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <header className="card-header">
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </header>
  );
}
