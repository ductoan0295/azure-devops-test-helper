import { SuiteTestCase } from "azure-devops-node-api/interfaces/TestInterfaces.js";
import { createAxiosClient, createAzureTestAPIClient } from "./client.js";
import { getSuiteIdsByPlanId, getTestCases } from "./plan.js";

export async function getTestCaseIdsByPlanId(planInfo: {
  pat: string;
  organizationUrl: string;
  project: string;
  planId: number;
  suiteId?: number;
}): Promise<string[]> {
  const azureTestApiClient = await createAzureTestAPIClient(planInfo.pat, planInfo.organizationUrl);
  const axiosClient = await createAxiosClient(planInfo.pat, planInfo.organizationUrl, planInfo.project);
  const suiteIds: number[] = await getSuiteIdsByPlanId(axiosClient, planInfo.planId, planInfo.suiteId);
  const testCases = await getTestCases(azureTestApiClient, planInfo.project, planInfo.planId, suiteIds);
  return testCases
    .map((testCase: SuiteTestCase) => testCase.testCase?.id ?? "")
    .filter((id: string | undefined) => id);
}
