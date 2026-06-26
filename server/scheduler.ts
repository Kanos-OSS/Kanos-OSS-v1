import { storage } from "./storage";
import type { ScheduledAnalysis } from "@shared/schema";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let schedulerStarted = false;

type RunAnalysisFn = (analysisId: number, productInput: string, files: Express.Multer.File[]) => Promise<void>;

let _runAnalysis: RunAnalysisFn | null = null;

export function registerRunAnalysis(fn: RunAnalysisFn) {
  _runAnalysis = fn;
}

function computeNextRun(frequency: "daily" | "weekly" | "monthly", from: Date = new Date()): Date {
  const next = new Date(from);
  switch (frequency) {
    case "daily":
      next.setDate(next.getDate() + 1);
      break;
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      break;
  }
  return next;
}

export { computeNextRun };

async function processDueSchedules() {
  if (!_runAnalysis) return;

  try {
    const dueSchedules = await storage.getDueSchedules();
    for (const schedule of dueSchedules) {
      try {
        console.log(`[Scheduler] Running scheduled analysis for "${schedule.productInput}" (id=${schedule.id})`);

        const analysis = await storage.createAnalysis({
          productInput: schedule.productInput,
          status: "analyzing",
          hasInternalData: 0,
        });

        await storage.updateSchedule(schedule.id, {
          lastRunAt: new Date(),
          lastAnalysisId: analysis.id,
          nextRunAt: computeNextRun(schedule.frequency as "daily" | "weekly" | "monthly"),
        });

        _runAnalysis(analysis.id, schedule.productInput, []).catch(err => {
          console.error(`[Scheduler] Analysis failed for schedule ${schedule.id}:`, err);
          storage.updateAnalysis(analysis.id, { status: "failed" });
        });
      } catch (err) {
        console.error(`[Scheduler] Error processing schedule ${schedule.id}:`, err);
      }
    }
  } catch (err) {
    console.error("[Scheduler] Error fetching due schedules:", err);
  }
}

export function startScheduler() {
  if (schedulerInterval || schedulerStarted) return;
  schedulerStarted = true;
  console.log("[Scheduler] Started — checking for due analyses every 60 seconds");
  schedulerInterval = setInterval(processDueSchedules, 60 * 1000);
  setTimeout(processDueSchedules, 5000);
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
