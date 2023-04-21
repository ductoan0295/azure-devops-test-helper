import { ITestApi } from "azure-devops-node-api/TestApi";
import { TestRun, RunUpdateModel } from "azure-devops-node-api/interfaces/TestInterfaces";
import { AzureTestRunStatus } from "./constants.js";
import { AzureResultImporterConfig } from "./types.js";
import { getAutomatedTestPointIds } from "./case.js";

export async function createTestRun(
  azureClient: ITestApi,
  testCases: unknown[],
  config: AzureResultImporterConfig,
  configurationIds: number[]
): Promise<TestRun> {
  const testPointIds: number[] = getAutomatedTestPointIds(testCases, config.automatedStatus ?? "Planned");

  const testRun = await azureClient.createTestRun(
    {
      name: config.runName,
      pointIds: testPointIds.filter((id: number) => id),
      configurationIds: configurationIds,
      plan: {
        id: `${config.planId}`,
        name: config.runName,
      },
      automated: true,
      build: {
        id: String(config.buildId),
      },
      comment: config.comment,
    },
    config.project
  );

  return testRun;
}

export async function setRunStatus(
  azureClient: ITestApi,
  config: AzureResultImporterConfig,
  testRunId: number,
  status: AzureTestRunStatus
): Promise<TestRun> {
  const inProgressRunModel: RunUpdateModel = {
    state: status,
  };

  return azureClient.updateTestRun(inProgressRunModel, config.project, testRunId);
}
