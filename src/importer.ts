import { AzureResultImporterConfig, TestReport } from "./types.js";
import { ITestApi } from "azure-devops-node-api/TestApi.js";
import * as azureNodeApi from "azure-devops-node-api";
import { AzureTestRunStatus, AzureTestResultOutcome } from "./constants.js";
import {
  RunUpdateModel,
  TestCaseResult,
  TestPoint,
  TestRun,
} from "azure-devops-node-api/interfaces/TestInterfaces.js";

class AzureDevopsResultImporter {
  private azureTestApiClient!: ITestApi;

  public async importTestResultToTestRun(
    testReports: TestReport[],
    config: AzureResultImporterConfig
  ): Promise<TestCaseResult[]> {
    await this.createAzureTestAPIClient(config.pat, config.organizationUrl);

    const executedConfigurationIds: number[] = testReports.map((report: TestReport) =>
      Number(report.azureConfigurationId)
    );

    const testRun = await this.createTestRun(this.azureTestApiClient, config, executedConfigurationIds);
    if (!testRun.id) {
      throw new Error("Failed to create test Run!");
    }
    await this.setRunStatus(this.azureTestApiClient, config, testRun.id, AzureTestRunStatus.INPROGRESS);

    const updatingResults: TestCaseResult[] = await this.getUpdatingTestResult(
      testReports,
      config.project,
      testRun.id
    );

    let importedTestResults: TestCaseResult[] = [];
    try {
      importedTestResults = await this.azureTestApiClient.updateTestResults(
        updatingResults,
        config.project,
        testRun.id
      );
    } catch (error: unknown) {
      await this.setRunStatus(this.azureTestApiClient, config, testRun.id, AzureTestRunStatus.ABORTED);
      throw new Error(
        "Failed to import result into the created Test Run! with the following error: \n" + error
      );
    }

    await this.setRunStatus(this.azureTestApiClient, config, testRun.id, AzureTestRunStatus.COMPLETED);
    return importedTestResults;
  }

  private async getUpdatingTestResult(
    testReports: TestReport[],
    project: string,
    testRunId: number
  ): Promise<TestCaseResult[]> {
    const createdTestResults: TestCaseResult[] = await this.azureTestApiClient.getTestResults(
      project,
      testRunId
    );

    const updatingResults: TestCaseResult[] = [];
    testReports.forEach((report: TestReport) => {
      createdTestResults
        .filter(
          (testResult: TestCaseResult) =>
            testResult.configuration?.id && testResult.configuration.id === report.azureConfigurationId
        )
        .forEach((configFilteredCreatedResult: TestCaseResult) => {
          const executedResult = report.testResults.find(
            (result: TestCaseResult) =>
              result.testCase?.id && result.testCase.id === configFilteredCreatedResult.testCase?.id
          );
          if (executedResult) {
            updatingResults.push({ ...configFilteredCreatedResult, ...executedResult });
          } else {
            updatingResults.push({
              ...configFilteredCreatedResult,
              ...{ outcome: AzureTestResultOutcome.NotExecuted, state: AzureTestRunStatus.COMPLETED },
            });
          }
        });
    });
    return updatingResults;
  }

  private async createAzureTestAPIClient(pat: string, organizationUrl: string): Promise<void> {
    if (!this.azureTestApiClient) {
      const authHandler = azureNodeApi.getPersonalAccessTokenHandler(pat);
      const connection = new azureNodeApi.WebApi(organizationUrl, authHandler);
      this.azureTestApiClient = await connection.getTestApi();
    }
  }

  private async createTestRun(
    azureClient: ITestApi,
    config: AzureResultImporterConfig,
    configurationIds: number[]
  ): Promise<TestRun> {
    const testPoints: TestPoint[] = await azureClient.getPoints(
      config.project,
      config.planId,
      config.suiteId
    );

    const testPointIds: number[] = testPoints.map((testPoint: TestPoint) => testPoint.id);

    const testRun = await azureClient.createTestRun(
      {
        name: config.runName,
        pointIds: testPointIds.filter((id: number) => id),
        configurationIds: configurationIds,
        plan: {
          id: `${config.planId}`,
          name: config.runName,
        },
        automated: false,
      },
      config.project
    );

    return testRun;
  }

  private async setRunStatus(
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
}

export default new AzureDevopsResultImporter();
