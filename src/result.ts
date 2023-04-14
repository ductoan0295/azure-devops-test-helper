import { ITestApi } from "azure-devops-node-api/TestApi";
import {
  TestAttachmentReference,
  TestCaseResult,
  TestIterationDetailsModel,
} from "azure-devops-node-api/interfaces/TestInterfaces";
import { AzureTestResultOutcome, AzureTestRunStatus } from "./constants.js";
import { UpdateTestCaseData } from "./interfaces.js";
import { TestReport, Screenshot } from "./types.js";

export async function getUpdatingTestResult(
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

export async function uploadScreenshots(
  azureClient: ITestApi,
  project: string,
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
          project,
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
