import { AzureResultImporterConfig, TestReport } from "./types.js";
import { ITestApi } from "azure-devops-node-api/TestApi.js";
import { AzureTestRunStatus } from "./constants.js";
import { TestAttachmentReference, TestCaseResult } from "azure-devops-node-api/interfaces/TestInterfaces.js";
import path from "node:path";
import url from "node:url";
import fs from "node:fs";
import Ajv, { Schema } from "ajv";
import addFormats from "ajv-formats";
import axios, { AxiosInstance } from "axios";
import { UpdateTestCaseData, UpdateTestResults } from "./interfaces.js";
import { createTestRun, setRunStatus } from "./run.js";
import { getUpdatingTestResult, uploadScreenshots } from "./result.js";
import { getTestCasesByPlanID } from "./plan.js";
import { filterExecutedTestCase } from "./case.js";
import { createAzureAPIClients } from "./client.js";
import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi.js";

export interface AzureAPIClients {
  testAPIClient: ITestApi;
  workItemTrackingAPIClient: IWorkItemTrackingApi;
}

class AzureDevopsResultImporter {
  private azureApiClients?: AzureAPIClients;
  private axiosClient?: AxiosInstance;
  private ajv: Ajv;
  private testReportSchema: Schema;
  private configSchema: Schema;

  constructor() {
    this.ajv = new Ajv();
    addFormats(this.ajv);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const dirname = url.fileURLToPath(new URL(".", import.meta.url)) ?? __dirname;
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
      const configurationMergedReports: TestReport[] = await this.mergeReportByConfigId(validFormatReports);
      const azureApiClients = await this.getAzureAPIClients(config);
      const azureTestApiClient = azureApiClients.testAPIClient;
      const axiosClient = await this.getAxiosClient(config);

      const executedConfigurationIds: number[] = configurationMergedReports.map((report: TestReport) =>
        Number(report.azureConfigurationId)
      );

      const executedTestCaseIds: string[] = testReports
        .map((report: TestReport) => report.testResults)
        .flat()
        .filter((result) => result)
        .map((result: TestCaseResult) => result.testCase?.id ?? "");
      const testCasesOnPlan = await getTestCasesByPlanID(axiosClient, config.planId, config.suiteId);
      const updatingTestCases = config.override
        ? testCasesOnPlan
        : filterExecutedTestCase(testCasesOnPlan, executedTestCaseIds);
      const testRun = await createTestRun(
        azureTestApiClient,
        updatingTestCases,
        config,
        executedConfigurationIds
      );
      if (!testRun.id) {
        throw new Error("Failed to create test Run!");
      }
      await setRunStatus(azureTestApiClient, config, testRun.id, AzureTestRunStatus.INPROGRESS);

      const updatingResult: UpdateTestCaseData = await getUpdatingTestResult(
        azureApiClients,
        configurationMergedReports,
        config.project,
        testRun.id,
        updatingTestCases
      );

      let importedTestResults: TestCaseResult[] = [];
      try {
        importedTestResults = await azureTestApiClient.updateTestResults(
          updatingResult.testCaseResults,
          config.project,
          testRun.id
        );
      } catch (error: unknown) {
        await setRunStatus(azureTestApiClient, config, testRun.id, AzureTestRunStatus.ABORTED);
        throw new Error(
          "Failed to import result into the created Test Run! with the following error: \n" + error
        );
      }

      await setRunStatus(azureTestApiClient, config, testRun.id, AzureTestRunStatus.COMPLETED);

      let uploadedScreenshot: TestAttachmentReference[] = [];
      try {
        uploadedScreenshot = await uploadScreenshots(
          azureTestApiClient,
          config.project,
          updatingResult.screenshots,
          testRun.id
        );
      } catch (error: unknown) {
        await setRunStatus(azureTestApiClient, config, testRun.id, AzureTestRunStatus.ABORTED);
        throw new Error(
          "Failed to upload screenshot(s) into the created Test Run! with the following error: \n" + error
        );
      }
      return { testCaseResults: importedTestResults, attachments: uploadedScreenshot };
    }
    return { testCaseResults: [], attachments: [] };
  }

  private async getAzureAPIClients(config: AzureResultImporterConfig): Promise<AzureAPIClients> {
    if (!this.azureApiClients) {
      this.azureApiClients = await createAzureAPIClients(config.pat, config.organizationUrl);
    }
    return this.azureApiClients;
  }

  private async getAxiosClient(config: AzureResultImporterConfig): Promise<AxiosInstance> {
    if (!this.axiosClient) {
      this.axiosClient = axios.create({
        headers: {
          Authorization: "Basic " + Buffer.from(":" + config.pat).toString("base64"),
        },
        params: {
          Authorization: "Basic " + config.pat,
        },
        baseURL: `${config.organizationUrl}/${config.project}/_apis`,
      });
    }
    return this.axiosClient;
  }

  private async mergeReportByConfigId(reports: TestReport[]): Promise<TestReport[]> {
    const mergedReports: TestReport[] = [];
    reports.forEach((report: TestReport) => {
      if (report.azureConfigurationId) {
        const mergedReport = mergedReports.find(
          (mergedReport: TestReport) => mergedReport.azureConfigurationId === report.azureConfigurationId
        );
        if (mergedReport) {
          mergedReport.testResults.push(...report.testResults);
          mergedReport.screenshots.push(...report.screenshots);
        } else {
          mergedReports.push(report);
        }
      }
    });
    return mergedReports;
  }
}

export default new AzureDevopsResultImporter();
