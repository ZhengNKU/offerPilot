export interface SmoothTaskProgressController {
  setTarget: (progress: number) => void;
  complete: (finalStep?: string) => void;
  stop: () => void;
}

interface SmoothTaskProgressOptions {
  steps: string[];
  setProgress: (progress: number) => void;
  setStep: (step: string) => void;
  initialProgress?: number;
  maxBeforeComplete?: number;
  tickMs?: number;
}

export function startSmoothTaskProgress({
  steps,
  setProgress,
  setStep,
  initialProgress = 1,
  maxBeforeComplete = 98,
  tickMs = 400,
}: SmoothTaskProgressOptions): SmoothTaskProgressController {
  let progress = initialProgress;
  let targetProgress = initialProgress;
  let stopped = false;

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const syncStep = () => {
    if (steps.length === 0) return;
    const idx = clamp(Math.floor((progress / 100) * steps.length), 0, steps.length - 1);
    setStep(steps[idx]);
  };

  const renderProgress = () => {
    setProgress(Math.floor(clamp(progress, 0, 100)));
    syncStep();
  };

  renderProgress();

  const timer = setInterval(() => {
    if (stopped || progress >= maxBeforeComplete) return;

    const naturalInc = progress < 45 ? 1.2 : progress < 70 ? 0.8 : progress < 88 ? 0.5 : 0.2;
    const catchupInc = targetProgress > progress
      ? Math.min(4, Math.max(naturalInc, (targetProgress - progress) * 0.22))
      : naturalInc;

    progress = Math.min(maxBeforeComplete, progress + catchupInc);
    renderProgress();
  }, tickMs);

  return {
    setTarget(nextProgress: number) {
      targetProgress = Math.max(targetProgress, clamp(nextProgress, initialProgress, maxBeforeComplete));
    },
    complete(finalStep?: string) {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      progress = 100;
      setProgress(100);
      if (finalStep) setStep(finalStep);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
