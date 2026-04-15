import { cn } from "@/lib/utils";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: "surface" | "container" | "glass";
}

export function Card({ children, className, variant = "surface" }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl p-6",
        {
          "bg-surface-container-lowest border border-primary/5": variant === "surface",
          "bg-surface-container-low": variant === "container",
          "glass-panel shadow-glass": variant === "glass",
        },
        className
      )}
    >
      {children}
    </div>
  );
}
