import { AxiosInstance } from "axios";
import { ITestApi } from "azure-devops-node-api/TestApi";
import { TestSuite, TestPoint, SuiteTestCase } from "azure-devops-node-api/interfaces/TestInterfaces";

async function getTestSuitesByPlanID(axiosClient: AxiosInstance, planId: number): Promise<TestSuite[]> {
  let continuationToken = "";
  let suites: TestSuite[] = [];
  do {
    const response = await axiosClient
      .get(
        `testplan/Plans/${planId}/suites?continuationToken=${continuationToken}&asTreeView=true&api-version=7.0`
      )
      .catch((error) => {
        throw new Error(error);
      });

    const testSuites: TestSuite[] = response.data.value;
    suites = [...suites, ...testSuites];
    continuationToken = response.headers["x-ms-continuationtoken"];
  } while (continuationToken !== undefined);
  return suites;
}

async function getSuiteIds(suites: TestSuite[], suiteId?: number): Promise<number[]> {
  let suiteIds: number[] = [];
  for (const suite of suites) {
    let childrenSuitIds: number[] = [];
    if (!suiteId || (suiteId && suiteId === suite.id)) {
      suiteIds.push(suite.id);
      childrenSuitIds = await getSuiteIds(suite.children ?? []);
    } else {
      childrenSuitIds = await getSuiteIds(suite.children ?? [], suiteId);
    }
    suiteIds = [...suiteIds, ...childrenSuitIds];
  }
  return suiteIds;
}

export async function getSuiteIdsByPlanId(axiosClient: AxiosInstance, planId: number, suiteId?: number) {
  const testSuites: TestSuite[] = await getTestSuitesByPlanID(axiosClient, planId);
  const suiteIds: number[] = await getSuiteIds(testSuites, suiteId);
  return suiteIds;
}

export async function getTestPoints(
  azureClient: ITestApi,
  project: string,
  planId: number,
  suiteIds: number[]
): Promise<TestPoint[]> {
  let result: TestPoint[] = [];
  for (const suiteId of suiteIds) {
    const testPoints: TestPoint[] = await azureClient.getPoints(project, planId, suiteId);
    result = [...result, ...testPoints];
  }
  return result;
}

export async function getTestCases(
  azureClient: ITestApi,
  project: string,
  planId: number,
  suiteIds: number[]
): Promise<SuiteTestCase[]> {
  let result: SuiteTestCase[] = [];
  for (const suiteId of suiteIds) {
    const testCases: SuiteTestCase[] = await azureClient.getTestCases(project, planId, suiteId);
    result = [...result, ...testCases];
  }
  return result;
}
