import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "error";
  className?: string;
}

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold",
        {
          "bg-surface-container text-on-surface-variant": variant === "default",
          "bg-primary-container text-on-primary-container": variant === "success",
          "bg-tertiary-container text-on-tertiary-container": variant === "warning",
          "bg-error-container text-on-error-container": variant === "error",
        },
        className
      )}
    >
      {children}
    </span>
  );
}
