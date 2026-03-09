"use client";

import { useState, useEffect, useCallback } from "react";
import { useCADStore } from "@/lib/cad/store";
import {
  Upload,
  Sparkles,
  MousePointerClick,
  Wand2,
  ChevronRight,
  X,
  Lightbulb,
  ArrowDown,
} from "lucide-react";

const ONBOARDING_KEY = "energylink-flex-onboarding-complete";
const HINT_DISMISSED_KEY = "energylink-flex-hints-dismissed";

interface Step {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  /** CSS selector or element ref to highlight (for future spotlight feature) */
  target?: string;
}

const WORKFLOW_STEPS: Step[] = [
  {
    id: "upload",
    icon: <Upload className="w-5 h-5" />,
    title: "Upload a Drawing",
    description: "Start by uploading a DXF, DWG, or PDF engineering drawing. We support SCR/CO system layouts, general arrangement drawings, and more.",
  },
  {
    id: "analyze",
    icon: <Sparkles className="w-5 h-5" />,
    title: "AI Analysis",
    description: "Click the Analyze button to let AI identify components like stacks, silencers, ducts, and nozzles — and map dimensions to each part.",
  },
  {
    id: "edit",
    icon: <MousePointerClick className="w-5 h-5" />,
    title: "Click to Edit Dimensions",
    description: "Click any dimension label on the drawing to open the editor. Change the value and the geometry updates instantly with smart cascade suggestions.",
  },
  {
    id: "intent",
    icon: <Wand2 className="w-5 h-5" />,
    title: "Natural Language Editing",
    description: "Use the command bar at the bottom to describe changes in plain English, like \"make the stack 5 feet taller\" — AI figures out which dimensions to change.",
  },
];

/**
 * Full onboarding overlay — shown once for first-time users.
 * Teaches the 4-step workflow with a slideshow.
 */
export function OnboardingOverlay() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const done = localStorage.getItem(ONBOARDING_KEY);
    if (!done) setVisible(true);
  }, []);

  const dismiss = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setVisible(false);
  }, []);

  const next = () => {
    if (step < WORKFLOW_STEPS.length - 1) setStep(step + 1);
    else dismiss();
  };

  if (!visible) return null;

  const current = WORKFLOW_STEPS[step];

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header gradient */}
        <div className="bg-gradient-to-br from-[#93C90F] to-[#5A7D00] px-6 py-8 text-white text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center mb-4">
            {current.icon}
          </div>
          <h2 className="text-xl font-bold">{current.title}</h2>
          <p className="text-sm text-white/80 mt-2 leading-relaxed">
            {current.description}
          </p>
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-2 py-4">
          {WORKFLOW_STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={`w-2 h-2 rounded-full transition-all ${
                i === step
                  ? "bg-[#93C90F] w-6"
                  : i < step
                    ? "bg-[#93C90F]/40"
                    : "bg-[#D4D4D4]"
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-6 pb-6">
          <button
            onClick={dismiss}
            className="text-sm text-[#999] hover:text-[#666] transition-colors"
          >
            Skip tour
          </button>
          <button
            onClick={next}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-[#93C90F] hover:bg-[#7AB00D] text-white rounded-lg font-medium text-sm transition-colors"
          >
            {step < WORKFLOW_STEPS.length - 1 ? (
              <>
                Next <ChevronRight className="w-4 h-4" />
              </>
            ) : (
              "Get Started"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Contextual hint banner — shown after specific actions to guide next steps.
 * Auto-dismisses and remembers which hints were seen.
 */
export function ContextualHints() {
  const drawing = useCADStore((s) => s.drawing);
  const dimensions = useCADStore((s) => s.dimensions);
  const componentGraph = useCADStore((s) => s.componentGraph);
  const lastModification = useCADStore((s) => s.lastModification);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [autoDismissTimer, setAutoDismissTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(HINT_DISMISSED_KEY);
      if (stored) setDismissed(new Set(JSON.parse(stored)));
    } catch {
      // ignore
    }
  }, []);

  const dismissHint = useCallback(
    (id: string) => {
      setDismissed((prev) => {
        const next = new Set(prev);
        next.add(id);
        localStorage.setItem(HINT_DISMISSED_KEY, JSON.stringify([...next]));
        return next;
      });
    },
    []
  );

  // Determine which hint to show (priority order)
  let hint: { id: string; message: string; icon: React.ReactNode } | null = null;

  if (drawing && dimensions.length > 0 && !componentGraph && !dismissed.has("analyze-hint")) {
    hint = {
      id: "analyze-hint",
      message: "Drawing loaded! Click the Analyze button to identify components and enable smart editing.",
      icon: <Sparkles className="w-4 h-4 text-[#93C90F]" />,
    };
  } else if (componentGraph && !lastModification && !dismissed.has("edit-hint")) {
    hint = {
      id: "edit-hint",
      message: "Components identified! Click any dimension label on the drawing to start editing.",
      icon: <MousePointerClick className="w-4 h-4 text-[#93C90F]" />,
    };
  } else if (lastModification && !dismissed.has("cascade-hint")) {
    hint = {
      id: "cascade-hint",
      message: "Dimension changed! Check the cascade suggestions panel to apply related adjustments.",
      icon: <Lightbulb className="w-4 h-4 text-[#93C90F]" />,
    };
  }

  // Auto-dismiss after 12 seconds
  useEffect(() => {
    if (hint) {
      if (autoDismissTimer) clearTimeout(autoDismissTimer);
      const timer = setTimeout(() => {
        if (hint) dismissHint(hint.id);
      }, 12000);
      setAutoDismissTimer(timer);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint?.id]);

  if (!hint) return null;

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 animate-in fade-in-0 slide-in-from-top-2 duration-300">
      <div className="flex items-center gap-2.5 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-[#D4D4D4] px-4 py-2.5 max-w-[480px]">
        {hint.icon}
        <span className="text-xs text-[#333] leading-relaxed">{hint.message}</span>
        <button
          onClick={() => dismissHint(hint!.id)}
          className="p-0.5 rounded hover:bg-[#EBEBEB] text-[#999] hover:text-[#666] transition-colors flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Empty canvas state with guided next steps
 */
export function EmptyCanvasGuide({ onUploadClick }: { onUploadClick?: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-[#93C90F]/10 flex items-center justify-center mb-4">
          <Upload className="w-8 h-8 text-[#93C90F]/60" />
        </div>
        <h3 className="text-lg font-semibold text-[#333] mb-2">No Drawing Loaded</h3>
        <p className="text-sm text-[#888] mb-6 leading-relaxed">
          Upload a DXF, DWG, or PDF engineering drawing to start viewing
          and editing dimensions.
        </p>
        {onUploadClick && (
          <button
            onClick={onUploadClick}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#93C90F] hover:bg-[#7AB00D] text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <Upload className="w-4 h-4" />
            Upload Drawing
          </button>
        )}
        <div className="mt-8 text-left space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999]">Supported formats</p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="p-2 rounded-lg bg-[#93C90F]/5 border border-[#93C90F]/20 text-center">
              <span className="font-bold text-[#93C90F]">.DXF</span>
              <p className="text-[10px] text-[#999] mt-0.5">AutoCAD</p>
            </div>
            <div className="p-2 rounded-lg bg-blue-50 border border-blue-200 text-center">
              <span className="font-bold text-blue-500">.DWG</span>
              <p className="text-[10px] text-[#999] mt-0.5">AutoCAD</p>
            </div>
            <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-center">
              <span className="font-bold text-red-400">.PDF</span>
              <p className="text-[10px] text-[#999] mt-0.5">Multi-page</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Quick-start workflow bar — shown after drawing loads when no analysis is done.
 * Shows the recommended next steps as clickable chips.
 */
export function WorkflowBar() {
  const drawing = useCADStore((s) => s.drawing);
  const dimensions = useCADStore((s) => s.dimensions);
  const componentGraph = useCADStore((s) => s.componentGraph);
  const isRecognizing = useCADStore((s) => s.isRecognizing);
  const { recognizeComponents } = useCADStore();
  const [dismissed, setDismissed] = useState(false);

  if (!drawing || dismissed) return null;

  // Don't show if analysis is done or in progress
  if (componentGraph || isRecognizing) return null;

  // Don't show if no dimensions detected
  if (dimensions.length === 0) return null;

  return (
    <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-20 animate-in fade-in-0 slide-in-from-bottom-2 duration-500">
      <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-[#D4D4D4] px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-[#666]">
          <ArrowDown className="w-3.5 h-3.5 text-[#93C90F] animate-bounce" />
          <span className="font-medium">Next step:</span>
        </div>
        <button
          onClick={() => {
            recognizeComponents();
            setDismissed(true);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#93C90F]/10 hover:bg-[#93C90F]/20 text-[#5A7D00] rounded-lg text-xs font-medium transition-colors border border-[#93C90F]/30"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Run AI Analysis
        </button>
        <span className="text-[10px] text-[#999]">
          Identifies {dimensions.length} dimensions across components
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="p-0.5 rounded hover:bg-[#EBEBEB] text-[#999] ml-1"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
