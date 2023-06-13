import xmlparser from "./xmlparser.js";
import { AzureAPIClients } from "./importer.js";
import { IWorkItemTrackingApi } from "azure-devops-node-api/WorkItemTrackingApi.js";
import { WorkItem } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js";

export interface MSStep {
  compref?: unknown;
  step?: unknown;
  attr_prefix_id?: string;
  attr_prefix_ref?: string;
}

export interface Step {
  id: string;
  ref?: string;
  revision?: number;
  children?: Step[];
}

export function getAutomatedTestPointIds(
  testCases: unknown[],
  automatedStatus: string,
  executedConfigurationIds?: number[],
  override = false
): number[] {
  const result: number[] = [];
  for (const testCase of testCases) {
    if (testCase && typeof testCase === "object") {
      const workItemFields = Object.entries(testCase).find((entry) => entry[0] === "workItem")?.[1]
        .workItemFields;
      const automationStatus = getWorkItemField(workItemFields, "AutomationStatus");

      if (automationStatus === automatedStatus) {
        const pointAssignments: unknown[] = Object.entries(testCase).find(
          (entry) => entry[0] === "pointAssignments"
        )?.[1];

        pointAssignments.forEach((pointAssignment) => {
          if (pointAssignment && typeof pointAssignment === "object") {
            const configurationId = Object.entries(pointAssignment).find(
              (entry) => entry[0] === "configurationId"
            )?.[1];
            const id = Object.entries(pointAssignment).find((entry) => entry[0] === "id")?.[1];

            if (
              override ||
              (executedConfigurationIds &&
                configurationId &&
                executedConfigurationIds.includes(configurationId))
            ) {
              result.push(Number(id));
            }
          }
        });
      }
    }
  }
  return result;
}

export function filterExecutedTestCase(testCases: unknown[], executedTestCaseIds: string[]): unknown[] {
  const result: unknown[] = testCases.filter((testCase) => {
    if (testCase && typeof testCase === "object") {
      const workItem = Object.entries(testCase).find((entry) => entry[0] === "workItem")?.[1];
      const workItemId = workItem?.id;
      if (workItemId && executedTestCaseIds.includes(String(workItemId))) return true;
      return false;
    }
  });
  return result;
}

export function getAutomatedTestCaseIds(testCases: unknown[], automatedStatus: string): string[] {
  const result: string[] = [];
  for (const testCase of testCases) {
    if (testCase && typeof testCase === "object") {
      const workItem = Object.entries(testCase).find((entry) => entry[0] === "workItem")?.[1];
      const workItemId = workItem?.id;
      const workItemFields = workItem?.workItemFields;
      const automationStatus = getWorkItemField(workItemFields, "AutomationStatus");

      if (automationStatus === automatedStatus) {
        result.push(String(workItemId));
      }
    }
  }
  return result;
}

export async function getTestCaseSteps(
  testCases: unknown[],
  azureAPIClients: AzureAPIClients
): Promise<Map<string, Step[]>> {
  const testCaseStepMap = new Map<string, Step[]>();
  for (const testCase of testCases) {
    if (testCase && typeof testCase === "object") {
      const workItem = Object.entries(testCase).find((entry) => entry[0] === "workItem")?.[1];
      const steps = parseStepsFromWorkItem(workItem?.workItemFields);
      testCaseStepMap.set(String(workItem?.id), steps);
    }
  }

  const sharedStepIds: string[] = [];
  for (const testCaseStep of testCaseStepMap.entries()) {
    const steps = testCaseStep[1];
    steps.forEach((step) => {
      if (step.ref && !sharedStepIds.includes(step.ref)) sharedStepIds.push(step.ref);
    });
  }
  const sharedSteps = await getSharedSteps(azureAPIClients.workItemTrackingAPIClient, sharedStepIds);

  for (const testCaseStep of testCaseStepMap.entries()) {
    const steps = testCaseStep[1];
    steps.forEach((step) => {
      if (step.ref && sharedSteps.get(step.ref)) {
        const sharedStepData = sharedSteps.get(step.ref);
        step.children = sharedStepData?.childSteps;
        step.revision = sharedStepData?.revision;
      }
    });
  }

  return testCaseStepMap;
}

function parseStepsFromWorkItem(workItemFields: unknown[]) {
  const stepsXML = getWorkItemField(workItemFields, "Steps");
  const stepsData = xmlparser.parse(stepsXML.replace(/\\"/, `"`));
  const steps = parseSteps(stepsData.steps);
  return steps;
}

function parseSteps(msstep: MSStep, result: Step[] = []): Step[] {
  for (const [key, object] of Object.entries(msstep)) {
    if (key === "compref") {
      result.push({ id: object["attr_prefix_id"], ref: object["attr_prefix_ref"] });
      result = parseSteps(object, result);
    }

    if (key === "step") {
      if (object["attr_prefix_id"]) {
        result.push({ id: object["attr_prefix_id"] });
      } else if (Array.isArray(object)) {
        object.forEach((step) => {
          result.push({ id: step["attr_prefix_id"] });
        });
      }
    }
  }
  return result;
}

function getWorkItemField(workItemFields: unknown[], field: string): string {
  for (const workItemField of workItemFields) {
    if (typeof workItemField === "object" && workItemField) {
      const fieldValue = Object.entries(workItemField).find((entry) => entry[0].includes(field))?.[1];
      if (fieldValue) return fieldValue ?? "";
    }
  }
  return "";
}

async function getWorkItems(
  workItemTrackingAPIClient: IWorkItemTrackingApi,
  workItemIDs: string[]
): Promise<WorkItem[]> {
  const ids = workItemIDs
    .map((value: string) => Number(value))
    .filter((value: number) => value && !isNaN(value));
  const workItems: WorkItem[] = [];

  let batch = ids.splice(0, 199);
  while (batch.length) {
    const workItemArray = await workItemTrackingAPIClient.getWorkItemsBatch({ ids: batch });
    workItems.push(...workItemArray);
    batch = ids.splice(0, 199);
  }

  return workItems;
}

async function getSharedSteps(
  workItemTrackingAPIClient: IWorkItemTrackingApi,
  workItemIDs: string[]
): Promise<Map<string, { childSteps: Step[]; revision: number }>> {
  const testCaseStepMap = new Map<string, { childSteps: Step[]; revision: number }>();
  const workItems = await getWorkItems(workItemTrackingAPIClient, workItemIDs);
  for (const workItem of workItems) {
    if (workItem.id && workItem.fields) {
      const steps = parseStepsFromWorkItem([workItem.fields]);
      testCaseStepMap.set(String(workItem.id), { childSteps: steps, revision: workItem.rev ?? 1 });
    }
  }
  return testCaseStepMap;
}
