import { ITestApi } from "azure-devops-node-api/TestApi";
import { TestRun, TestPoint, RunUpdateModel } from "azure-devops-node-api/interfaces/TestInterfaces";
import { AzureTestRunStatus } from "./constants.js";
import { getSuiteIdsByPlanId, getTestPoints } from "./plan.js";
import { AzureResultImporterConfig } from "./types.js";
import { AxiosInstance } from "axios";

export async function createTestRun(
  azureClient: ITestApi,
  axiosClient: AxiosInstance,
  config: AzureResultImporterConfig,
  configurationIds: number[]
): Promise<TestRun> {
  const suiteIds: number[] = await getSuiteIdsByPlanId(axiosClient, config.planId, config.suiteId);
  const testPoints: TestPoint[] = await getTestPoints(azureClient, config.project, config.planId, suiteIds);

  const automatedTestPoints: TestPoint[] = testPoints.filter((points: TestPoint) =>
    points.workItemProperties.find((workItem: unknown) => {
      if (workItem instanceof Object) {
        const workItemObject = Object.entries(workItem).find(([key]) => key === "workItem");
        const key = String(workItemObject?.[1].key);
        const value = String(workItemObject?.[1].value);
        return key.includes("AutomationStatus") && value === (config.automatedStatus ?? "Planned");
      }
      return false;
    })
  );
  const testPointIds: number[] = automatedTestPoints.map((testPoint: TestPoint) => testPoint.id);

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
