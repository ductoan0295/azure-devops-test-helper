import axios, { AxiosInstance } from "axios";
import * as azureNodeApi from "azure-devops-node-api";
import { ITestApi } from "azure-devops-node-api/TestApi";

export async function createAzureTestAPIClient(pat: string, organizationUrl: string): Promise<ITestApi> {
  const authHandler = azureNodeApi.getPersonalAccessTokenHandler(pat);
  const connection = new azureNodeApi.WebApi(organizationUrl, authHandler);
  const azureTestApiClient = await connection.getTestApi();
  return azureTestApiClient;
}

export async function createAxiosClient(
  pat: string,
  organizationUrl: string,
  project: string
): Promise<AxiosInstance> {
  const axiosClient = axios.create({
    headers: {
      Authorization: "Basic " + Buffer.from(":" + pat).toString("base64"),
    },
    params: {
      Authorization: "Basic " + pat,
    },
    baseURL: `${organizationUrl}/${project}/_apis`,
  });
  return axiosClient;
}
