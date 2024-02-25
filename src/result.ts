import { ITestApi } from "azure-devops-node-api/TestApi";
import {
  TestActionResultModel,
  TestAttachmentReference,
  TestCaseResult,
  TestIterationDetailsModel,
} from "azure-devops-node-api/interfaces/TestInterfaces";
import { AzureTestResultOutcome, AzureTestRunStatus } from "./constants.js";
import { UpdateTestCaseData } from "./interfaces.js";
import { TestReport, Screenshot } from "./types.js";
import { Step, getTestCaseSteps } from "./case.js";
import { AzureAPIClients } from "./importer.js";

export async function getUpdatingTestResult(
  azureClients: AzureAPIClients,
  testReports: TestReport[],
  project: string,
  testRunId: number,
  testCases: unknown[]
): Promise<UpdateTestCaseData> {
  let createdTestResults: TestCaseResult[] = await azureClients.testAPIClient.getTestResults(
    project,
    testRunId
  );
  createdTestResults = createdTestResults.map((result: TestCaseResult) => ({
    ...result,
    ...{ outcome: AzureTestResultOutcome.NotExecuted, state: AzureTestRunStatus.COMPLETED },
  }));

  const updatingResults: TestCaseResult[] = [];
  const screenshots: Screenshot[] = [];

  const testCaseStepMap = await getTestCaseSteps(testCases, azureClients);

  createdTestResults.forEach((createdResult: TestCaseResult) => {
    const configMatchedReport = testReports.find(
      (report: TestReport) =>
        createdResult.configuration?.id && createdResult.configuration?.id === report.azureConfigurationId
    );

    if (configMatchedReport) {
      const executedResult = configMatchedReport.testResults.find(
        (result: TestCaseResult) => result.testCase?.id && result.testCase.id === createdResult.testCase?.id
      );

      if (executedResult) {
        const correctActionPathData = setActionPath(
          createdResult,
          executedResult,
          testCaseStepMap,
          configMatchedReport.screenshots
        );
        updatingResults.push({ ...createdResult, ...correctActionPathData.result });

        const testCaseId = executedResult?.testCase?.id;
        correctActionPathData.screenshots.forEach((screenshot: Screenshot) => {
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
      }
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

function setActionPath(
  createdTestCaseResult: TestCaseResult,
  executedTestCaseResult: TestCaseResult,
  testCaseStepMap: Map<string, Step[]>,
  screenshots?: Screenshot[]
): { result: TestCaseResult; screenshots: Screenshot[] } {
  const testCaseID = createdTestCaseResult.testCase?.id;
  const cloneExecutedTestCaseResult = { ...executedTestCaseResult };
  const correctActionPathScreenshots: Screenshot[] = [];

  if (testCaseID && testCaseStepMap.get(testCaseID) && cloneExecutedTestCaseResult.iterationDetails) {
    cloneExecutedTestCaseResult.iterationDetails.forEach((iterationDetail) => {
      let actionIndex = 0;
      const steps = testCaseStepMap.get(testCaseID);
      const actionPathCorrectionMap: Map<string, string> = new Map<string, string>();
      steps?.forEach((step) => {
        if (iterationDetail.actionResults && actionIndex < iterationDetail.actionResults.length) {
          const sharedStepActionResults: TestActionResultModel[] = [];

          const actionPath = convertIdToAzureActionPathId(Number(step.id));

          if (step.children && step.children.length && step.revision) {
            const sharedStepActionResult: TestActionResultModel = {
              sharedStepModel: { id: Number(step.ref), revision: step.revision },
              actionPath: actionPath,
              iterationId: iterationDetail.id,
              stepIdentifier: `${step.id}`,
              outcome: AzureTestResultOutcome.Passed,
            };

            for (const childStep of step.children) {
              const unsetActionResult = iterationDetail.actionResults[actionIndex];
              actionPathCorrectionMap.set(String(unsetActionResult.actionPath), actionPath);
              actionIndex++;
              unsetActionResult.stepIdentifier = `${step.id};${childStep.id}`;
              unsetActionResult.actionPath = `${actionPath}${convertIdToAzureActionPathId(
                Number(childStep.id)
              )}`;

              if (unsetActionResult.outcome === AzureTestResultOutcome.Failed) {
                sharedStepActionResult.outcome === AzureTestResultOutcome.Failed;
              }

              if (
                unsetActionResult.outcome === AzureTestResultOutcome.NotExecuted &&
                sharedStepActionResult.outcome !== AzureTestResultOutcome.Failed
              ) {
                sharedStepActionResult.outcome === AzureTestResultOutcome.NotExecuted;
              }

              if (step.children.indexOf(childStep) === 0) {
                sharedStepActionResult.startedDate = unsetActionResult.startedDate;
              }

              if (step.children.indexOf(childStep) === step.children.length - 1) {
                sharedStepActionResult.completedDate = unsetActionResult.completedDate;
              }
            }

            sharedStepActionResults.push(sharedStepActionResult);
          }

          iterationDetail.actionResults.push(...sharedStepActionResults);

          if (!step.children || step.children.length === 0) {
            const unsetActionResult = iterationDetail.actionResults[actionIndex];
            unsetActionResult.stepIdentifier = step.id;
            actionPathCorrectionMap.set(String(unsetActionResult.actionPath), actionPath);
            unsetActionResult.actionPath = actionPath;
            actionIndex++;
          }
        }
      });

      const iterationScreenshots: Screenshot[] =
        screenshots
          ?.filter(
            (screenshot: Screenshot) =>
              screenshot.testCaseId === testCaseID && screenshot.iterationId === iterationDetail.id
          )
          .map((screenshot: Screenshot) => {
            return {
              ...screenshot,
              ...{ actionPath: String(actionPathCorrectionMap.get(screenshot.actionPath)) },
            };
          }) ?? [];
      if (iterationScreenshots) correctActionPathScreenshots.push(...iterationScreenshots);
    });
  }

  return { result: cloneExecutedTestCaseResult, screenshots: correctActionPathScreenshots };
}

function convertIdToAzureActionPathId(id: number): string {
  const actionPathIdLength = 8;
  return id.toString(16).toUpperCase().padStart(actionPathIdLength, "0");
}
