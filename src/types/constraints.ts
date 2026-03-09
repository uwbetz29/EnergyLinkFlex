// Constraint engine types for parametric dimension validation

export type ConstraintType = "sum" | "min" | "max" | "clearance";

export interface Constraint {
  id: string;
  label: string;
  type: ConstraintType;
  dimensionIds: string[];
  threshold: number;
  /** For clearance constraints — two component IDs to check gap between */
  componentIds?: [string, string];
  severity: "warning" | "error";
}

export interface ConstraintViolation {
  constraintId: string;
  label: string;
  message: string;
  currentValue: number;
  threshold: number;
  severity: "warning" | "error";
}
