export enum AzureTestRunStatus {
  INPROGRESS = "InProgress",
  COMPLETED = "Completed",
  ABORTED = "Aborted",
}

export enum AzureTestResultOutcome {
  Unspecified = "Unspecified",
  None = "None",
  Passed = "Passed",
  Failed = "Failed",
  Inconclusive = "Inconclusive",
  Timeout = "Timeout",
  Aborted = "Aborted",
  Blocked = "Blocked",
  NotExecuted = "NotExecuted",
  Warning = "Warning",
  Error = "Error",
  NotApplicable = "NotApplicable",
  Paused = "Paused",
  InProgress = "InProgress",
  NotImpacted = "NotImpacted",
}
