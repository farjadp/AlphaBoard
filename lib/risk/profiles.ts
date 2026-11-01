/**
 * Entry selectivity per session risk profile. Only how picky the desk is about entering changes here;
 * position size, stop distance and every loss limit are the same in every profile.
 */
export type RiskProfile = "conservative" | "balanced";

export const RISK_PROFILES: readonly RiskProfile[] = ["conservative", "balanced"];

export interface EntryRules {
  /** Strategist conviction needed to open. */
  minConviction: number;
  /** "agree": the market analyst must read the entry's direction; "not_against": anything but the opposite read. */
  analyst: "agree" | "not_against";
  /** Confidence the analyst's read needs to count (agree), or to block (not_against). */
  analystConfidence: number;
  /** With nothing open, the strategist runs only if some market note is directional at this confidence. */
  setupConfidence: number;
  /** Required target / stop distance from the price; null = a target is optional. */
  minRewardRisk: number | null;
  /** Losing closes in a row before entries stop for the day (form preset; the mandate value is what counts). */
  maxConsecLosses: number;
}

export const ENTRY_RULES: Record<RiskProfile, EntryRules> = {
  conservative: { minConviction: 0.7, analyst: "agree", analystConfidence: 0.6, setupConfidence: 0.6, minRewardRisk: null, maxConsecLosses: 2 },
  balanced: { minConviction: 0.6, analyst: "not_against", analystConfidence: 0.6, setupConfidence: 0.5, minRewardRisk: 1.5, maxConsecLosses: 3 },
};

/** Sessions stored before profiles existed have no riskProfile and keep the conservative rules. */
export const entryRules = (m: { riskProfile?: RiskProfile | null }): EntryRules => ENTRY_RULES[m.riskProfile ?? "conservative"];
