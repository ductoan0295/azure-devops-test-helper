import { Capabilities } from "@wdio/types";
import { TestCaseResult } from "azure-devops-node-api/interfaces/TestInterfaces";

export interface AzureResultImporterConfig {
  pat: string;
  organizationUrl: string;
  project: string;
  planId: number;
  suiteId: number;
  runName: string;
}

export interface AzureConfigurationCapability {
  azureConfigId: string;
  capabilities: Capabilities.DesiredCapabilities;
}

export interface TestReport {
  azureConfigurationId: string;
  testResults: TestCaseResult[];
}
