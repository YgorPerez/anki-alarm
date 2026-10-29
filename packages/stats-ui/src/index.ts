// The stats screens' shared half. Core computes the stats; this turns them into sections, text
// and chart definitions, and each app lays them out and draws them with its own host.
export {
  chartDefinition,
  GRADE_INK,
  GRADES,
  type BarChart,
  type CountChart,
  type GradeChart,
  type GradeName,
  type Paint,
  type Token,
} from "./charts.ts";
export { statsCopy, type StatsCopy } from "./copy.ts";
export {
  retentionTable,
  STATS_PERIODS,
  studySections,
  type RetentionTable,
  type StudySection,
} from "./sections.ts";
export { wakeUpScopes, type WakeUpScope } from "./wakeup.ts";
