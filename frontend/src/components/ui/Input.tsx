import { cn } from "@/lib/utils";
import { InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={cn(
            "w-full bg-surface-container-low/30 border-none focus:ring-2 focus:ring-primary/20 rounded-xl px-4 py-3 text-sm font-body text-on-surface",
            className
          )}
          {...props}
        />
      </div>
    );
  }
);
Input.displayName = "Input";
