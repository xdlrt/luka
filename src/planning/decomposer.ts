import type { TodoItem } from "./todo.js";

const MIN_STEPS = 3;
const MAX_STEPS = 7;

export function buildDecompositionPrompt(
  task: string,
  projectContext: string
): string {
  const normalizedTask = task.trim();
  const normalizedContext = projectContext.trim();
  return `
Break the user task into ${MIN_STEPS}-${MAX_STEPS} ordered implementation steps.
Each step must be independently verifiable and concrete enough to become a TODO item.
Return only a numbered list, one step per line, with no extra commentary.

Task:
${normalizedTask}

Project context:
${normalizedContext === "" ? "(none provided)" : normalizedContext}
`.trim();
}

export function parseDecompositionResponse(response: string): TodoItem[] {
  const items = response
    .split(/\r?\n/)
    .map((line) => parseStepLine(line))
    .filter((content): content is string => content !== undefined)
    .map((content, index) => ({
      id: `todo-${index + 1}`,
      content,
      status: "pending" as const,
    }));

  if (items.length === 0) {
    throw new Error("decomposition response did not contain any todo steps");
  }

  return items;
}

function parseStepLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;

  const numbered = trimmed.match(/^\d+[\.)]\s+(.+)$/);
  if (numbered?.[1] !== undefined) return cleanStep(numbered[1]);

  const checkbox = trimmed.match(/^[-*]\s+\[[ xX~-]\]\s+(.+)$/);
  if (checkbox?.[1] !== undefined) return cleanStep(checkbox[1]);

  const bullet = trimmed.match(/^[-*]\s+(.+)$/);
  if (bullet?.[1] !== undefined) return cleanStep(bullet[1]);

  return undefined;
}

function cleanStep(value: string): string {
  return value.trim();
}
