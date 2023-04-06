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
import path from "node:path";
import url from "node:url";
import fs from "node:fs";
import Ajv, { Schema } from "ajv";
import addFormats from "ajv-formats";

class AzureDevopsResultImporter {
  private azureTestApiClient!: ITestApi;
  private ajv: Ajv;
  private testReportSchema: Schema;

  constructor() {
    this.ajv = new Ajv();
    addFormats(this.ajv);
    this.testReportSchema = JSON.parse(
      fs
        .readFileSync(
          path.join(url.fileURLToPath(new URL(".", import.meta.url)), "./schema/TestReportSchema.json")
        )
        .toString()
    );
  }

  public async importReportFilesToTestRun(
    reportAbsoluteDir: string,
    config: AzureResultImporterConfig
  ): Promise<TestCaseResult[]> {
    if (!fs.existsSync(reportAbsoluteDir) || !path.isAbsolute(reportAbsoluteDir)) {
      throw new Error("Report directory does not exist or is not an absolute path!!!");
    }
    const reportFiles = fs
      .readdirSync(reportAbsoluteDir)
      .filter((file: string) => path.extname(file) === ".json");

    const reports: TestReport[] = [];
    reportFiles.forEach((file: string) => {
      const fileData = fs.readFileSync(path.join(reportAbsoluteDir, file));
      reports.push(JSON.parse(fileData.toString()));
    });

    const importedTestResults: TestCaseResult[] = await this.importTestResultToTestRun(reports, config);
    return importedTestResults;
  }

  public async importTestResultToTestRun(
    testReports: TestReport[],
    config: AzureResultImporterConfig
  ): Promise<TestCaseResult[]> {
    const validFormatReports = testReports.filter((report: TestReport) =>
      this.ajv.validate(this.testReportSchema, report)
    );

    if (validFormatReports.length > 0) {
      await this.createAzureTestAPIClient(config.pat, config.organizationUrl);

      const executedConfigurationIds: number[] = validFormatReports.map((report: TestReport) =>
        Number(report.azureConfigurationId)
      );

      const testRun = await this.createTestRun(this.azureTestApiClient, config, executedConfigurationIds);
      if (!testRun.id) {
        throw new Error("Failed to create test Run!");
      }
      await this.setRunStatus(this.azureTestApiClient, config, testRun.id, AzureTestRunStatus.INPROGRESS);

      const updatingResults: TestCaseResult[] = await this.getUpdatingTestResult(
        validFormatReports,
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
    return [];
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
