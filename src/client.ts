import axios, { AxiosInstance } from "axios";
import * as azureNodeApi from "azure-devops-node-api";
import { AzureAPIClients } from "./importer";

export async function createAzureAPIClients(pat: string, organizationUrl: string): Promise<AzureAPIClients> {
  const authHandler = azureNodeApi.getPersonalAccessTokenHandler(pat);
  const connection = new azureNodeApi.WebApi(organizationUrl, authHandler);
  const azureTestApiClient = await connection.getTestApi();
  const azureWorkItemTrackingApiClient = await connection.getWorkItemTrackingApi();
  return { testAPIClient: azureTestApiClient, workItemTrackingAPIClient: azureWorkItemTrackingApiClient };
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
