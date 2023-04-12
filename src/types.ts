import { Capabilities } from "@wdio/types";
import { TestCaseResult } from "azure-devops-node-api/interfaces/TestInterfaces";

export interface AzureResultImporterConfig {
  pat: string;
  organizationUrl: string;
  project: string;
  planId: number;
  suiteId: number;
  runName: string;
  automatedStatus?: string;
  buildId?: number;
  comment?: string;
}

export interface AzureConfigurationCapability {
  azureConfigId: string;
  capabilities: Capabilities.DesiredCapabilities;
}

export interface Screenshot {
  testCaseId?: string;
  testCaseResultId?: number;
  iterationId: number;
  actionPath: string;
  base64encodedContent: string;
}

export interface TestReport {
  azureConfigurationId: string;
  testResults: TestCaseResult[];
  screenshots?: Screenshot[];
}
