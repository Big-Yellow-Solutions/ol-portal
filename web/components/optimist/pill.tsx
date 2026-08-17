import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// The redesign's rounded-full chip/button family — distinct from the shadcn
// Button's own size/radius scale, so it isn't forced through those variants.
// Every pill in the handoff (quick replies, footer actions, dialog actions,
// the sent screen) reduces to one of these tone/size combinations.
const pillVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors outline-none disabled:pointer-events-none focus-visible:ring-3 focus-visible:ring-violet/30",
  {
    variants: {
      tone: {
        primary: "bg-violet-deep text-white hover:bg-violet-deep/90 disabled:bg-violet-deep/30",
        outline: "border border-violet/28 bg-white text-ink hover:bg-violet-pale/40",
        subtle: "bg-violet-pale text-violet-deep hover:bg-violet-pale/70",
        dashed: "border border-dashed border-ink/20 bg-transparent text-ink-mute hover:bg-black/[.02]",
        onViolet: "bg-white text-violet-deep hover:bg-white/90",
        ghostOnViolet: "border border-white/35 bg-transparent text-white hover:bg-white/10",
      },
      size: {
        sm: "px-3.5 py-1.5 text-[12px]",
        md: "px-5 py-[10px] text-[13px]",
        lg: "px-6 py-3 text-[14px]",
      },
    },
    defaultVariants: { tone: "outline", size: "sm" },
  }
);

interface PillProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof pillVariants> {}

export function Pill({ className, tone, size, ...props }: PillProps) {
  return <button type="button" className={cn(pillVariants({ tone, size }), className)} {...props} />;
}

export { pillVariants };
