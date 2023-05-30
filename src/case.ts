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

export function getStepStartingValueByTestCaseId(
  testCases: unknown[],
  testCaseId: string | undefined
): number | undefined {
  if (testCaseId) {
    for (const testCase of testCases) {
      if (testCase && typeof testCase === "object") {
        const workItemId = Object.entries(testCase).find((entry) => entry[0] === "workItem")?.[1].id;

        if (String(workItemId) === testCaseId) {
          const workItemFields = Object.entries(testCase).find((entry) => entry[0] === "workItem")?.[1]
            .workItemFields;
          const step = getWorkItemField(workItemFields, "Steps");
          const firstStepId = step.match(/id="\d"/g)?.[1].match(/\d/)?.[0];
          const startingValue = Number(firstStepId);
          return Number.isNaN(startingValue) ? undefined : startingValue;
        }
      }
    }
  }
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
