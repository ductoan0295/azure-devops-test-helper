import { AzureResultImporterConfig, Screenshot, TestReport } from "./types.js";
import { ITestApi } from "azure-devops-node-api/TestApi.js";
import * as azureNodeApi from "azure-devops-node-api";
import { AzureTestRunStatus, AzureTestResultOutcome } from "./constants.js";
import {
  RunUpdateModel,
  TestAttachmentReference,
  TestCaseResult,
  TestPoint,
  TestRun,
} from "azure-devops-node-api/interfaces/TestInterfaces.js";
import path from "node:path";
import url from "node:url";
import fs from "node:fs";
import Ajv, { Schema } from "ajv";
import addFormats from "ajv-formats";
import { TestIterationDetailsModel } from "azure-devops-node-api/interfaces/TestInterfaces.js";

class AzureDevopsResultImporter {
  private azureTestApiClient!: ITestApi;
  private ajv: Ajv;
  private testReportSchema: Schema;
  private configSchema: Schema;

  constructor() {
    this.ajv = new Ajv();
    addFormats(this.ajv);
    const dirname = url.fileURLToPath(new URL(".", import.meta.url));
    this.testReportSchema = JSON.parse(
      fs.readFileSync(path.join(dirname, "./schema/TestReportSchema.json")).toString()
    );

    this.configSchema = JSON.parse(
      fs.readFileSync(path.join(dirname, "./schema/AzureResultImporterConfigSchema.json")).toString()
    );
  }

  public async importReportFilesToTestRun(
    reportAbsoluteDir: string,
    config: AzureResultImporterConfig
  ): Promise<UpdateTestResults> {
    if (!this.ajv.validate(this.configSchema, config)) {
      throw new Error("Invalid configuration options!!!");
    }

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

    const results: UpdateTestResults = await this.importTestResultToTestRun(reports, config);
    console.log("Report uploading process successfully!!");

    const resultPath = path.join(reportAbsoluteDir, "uploadedData.json");
    fs.writeFile(resultPath, JSON.stringify(results, null, 2), "utf-8", () => {
      console.log(`Uploaded data can be found at ${resultPath}`);
    });
    return results;
  }

  public async importTestResultToTestRun(
    testReports: TestReport[],
    config: AzureResultImporterConfig
  ): Promise<UpdateTestResults> {
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

      const updatingResult: UpdateTestCaseData = await this.getUpdatingTestResult(
        this.azureTestApiClient,
        validFormatReports,
        config.project,
        testRun.id
      );

      let importedTestResults: TestCaseResult[] = [];
      try {
        importedTestResults = await this.azureTestApiClient.updateTestResults(
          updatingResult.testCaseResults,
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

      let uploadedScreenshot: TestAttachmentReference[] = [];
      try {
        uploadedScreenshot = await this.uploadScreenshots(
          this.azureTestApiClient,
          config,
          updatingResult.screenshots,
          testRun.id
        );
      } catch (error: unknown) {
        await this.setRunStatus(this.azureTestApiClient, config, testRun.id, AzureTestRunStatus.ABORTED);
        throw new Error(
          "Failed to upload screenshot(s) into the created Test Run! with the following error: \n" + error
        );
      }
      return { testCaseResults: importedTestResults, attachments: uploadedScreenshot };
    }
    return { testCaseResults: [], attachments: [] };
  }

  private async getUpdatingTestResult(
    azureClient: ITestApi,
    testReports: TestReport[],
    project: string,
    testRunId: number
  ): Promise<UpdateTestCaseData> {
    let createdTestResults: TestCaseResult[] = await azureClient.getTestResults(project, testRunId);
    createdTestResults = createdTestResults.map((result: TestCaseResult) => ({
      ...result,
      ...{ outcome: AzureTestResultOutcome.NotExecuted, state: AzureTestRunStatus.COMPLETED },
    }));

    const updatingResults: TestCaseResult[] = [];
    const screenshots: Screenshot[] = [];

    createdTestResults.forEach((createdResult: TestCaseResult) => {
      const configMatchedReport = testReports.find(
        (report: TestReport) =>
          createdResult.configuration?.id && createdResult.configuration?.id === report.azureConfigurationId
      );

      if (configMatchedReport) {
        const executedResult = configMatchedReport.testResults.find(
          (result: TestCaseResult) => result.testCase?.id && result.testCase.id === createdResult.testCase?.id
        );

        updatingResults.push({ ...createdResult, ...executedResult });
        const testCaseId = executedResult?.testCase?.id;

        configMatchedReport.screenshots?.forEach((screenshot: Screenshot) => {
          if (
            screenshot.testCaseId === testCaseId &&
            executedResult?.iterationDetails?.find(
              (iteration: TestIterationDetailsModel) => screenshot.iterationId === iteration.id
            )
          )
            screenshots.push({
              ...screenshot,
              ...{ testCaseResultId: createdResult.id },
            });
        });
      } else {
        updatingResults.push(createdResult);
      }
    });
    return { testCaseResults: updatingResults, screenshots: screenshots };
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

  private async uploadScreenshots(
    azureClient: ITestApi,
    config: AzureResultImporterConfig,
    screenshots: Screenshot[],
    testRunId: number
  ): Promise<TestAttachmentReference[]> {
    const uploadedTestAttachmentReferences: TestAttachmentReference[] = [];
    for (const screenshot of screenshots) {
      if (screenshot.testCaseResultId) {
        const attachmentReference: TestAttachmentReference =
          await azureClient.createTestIterationResultAttachment(
            {
              fileName: `CaseID-${screenshot.testCaseId}-runid-${testRunId}.png`,
              stream: screenshot.base64encodedContent,
            },
            config.project,
            testRunId,
            screenshot.testCaseResultId,
            screenshot.iterationId,
            screenshot.actionPath
          );
        uploadedTestAttachmentReferences.push(attachmentReference);
      }
    }
    return uploadedTestAttachmentReferences;
  }
}

interface UpdateTestCaseData {
  testCaseResults: TestCaseResult[];
  screenshots: Screenshot[];
}

interface UpdateTestResults {
  testCaseResults: TestCaseResult[];
  attachments: TestAttachmentReference[];
}

export default new AzureDevopsResultImporter();
