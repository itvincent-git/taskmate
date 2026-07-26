export type AppView = "home" | "settings" | "logs";
export type Language = "en" | "zh";
export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "restarting"
  | "current"
  | "error"
  | "disabled";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
  percent: number | null;
}
