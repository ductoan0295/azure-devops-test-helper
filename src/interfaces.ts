import { TestAttachmentReference, TestCaseResult } from "azure-devops-node-api/interfaces/TestInterfaces";
import { Screenshot } from "./types";

export interface UpdateTestCaseData {
  testCaseResults: TestCaseResult[];
  screenshots: Screenshot[];
}

export interface UpdateTestResults {
  testCaseResults: TestCaseResult[];
  attachments: TestAttachmentReference[];
}
