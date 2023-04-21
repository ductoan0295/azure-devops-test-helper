import { createAxiosClient } from "./client.js";
import { getTestCasesByPlanID } from "./plan.js";
import { getAutomatedTestCaseIds } from "./case.js";

export async function getTestCaseIdsByPlanId(planInfo: {
  pat: string;
  organizationUrl: string;
  project: string;
  planId: number;
  suiteId: number;
  automatedStatus?: string;
}): Promise<string[]> {
  const axiosClient = await createAxiosClient(planInfo.pat, planInfo.organizationUrl, planInfo.project);
  const testCases = await getTestCasesByPlanID(axiosClient, planInfo.planId, planInfo.suiteId);

  const testCaseIds = getAutomatedTestCaseIds(testCases, planInfo.automatedStatus ?? "Planned");
  return testCaseIds;
}
