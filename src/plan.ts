import { AxiosInstance } from "axios";

export async function getTestCasesByPlanID(
  axiosClient: AxiosInstance,
  planId: number,
  suiteId: number
): Promise<unknown[]> {
  let continuationToken = "";
  const testCases: unknown[] = [];
  do {
    const response = await axiosClient
      .get(
        `testplan/Plans/${planId}/Suites/${suiteId}/TestCase?isRecursive=true&continuationToken=${continuationToken}&api-version=7.0`
      )
      .catch((error) => {
        throw new Error(error);
      });
    testCases.push(...response.data.value);
    continuationToken = response.headers["x-ms-continuationtoken"];
  } while (continuationToken !== undefined);
  return testCases;
}
