export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

const STATUS_MARKERS: Record<TodoStatus, string> = {
  pending: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
};

export class TodoManager {
  private todos: TodoItem[] = [];

  update(todos: TodoItem[]): void {
    const nextTodos = todos.map((todo, index) => validateTodoItem(todo, index));
    const inProgressCount = nextTodos.filter(
      (todo) => todo.status === "in_progress"
    ).length;
    if (inProgressCount > 1) {
      throw new Error("todo_write allows at most one in_progress item");
    }
    this.todos = nextTodos;
  }

  getAll(): TodoItem[] {
    return this.todos.map((todo) => ({ ...todo }));
  }

  formatForDisplay(): string {
    if (this.todos.length === 0) return "";
    const completed = this.todos.filter(
      (todo) => todo.status === "completed"
    ).length;
    const lines = [
      `Progress: ${completed}/${this.todos.length} completed`,
      ...this.todos.map(
        (todo) => `${STATUS_MARKERS[todo.status]} ${todo.content}`
      ),
    ];
    return lines.join("\n");
  }

  formatForModel(): string {
    const display = this.formatForDisplay();
    if (display === "") return "";
    return `Current TODO state:\n${display}`;
  }
}

export function parseTodoItems(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) {
    throw new Error("todo_write requires todos to be an array");
  }
  return value.map((item, index) => validateTodoItem(item, index));
}

function validateTodoItem(value: unknown, index: number): TodoItem {
  if (!isRecord(value)) {
    throw new Error(`todo item ${index + 1} must be an object`);
  }

  const id = value.id;
  const content = value.content;
  const status = value.status;

  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`todo item ${index + 1} requires a non-empty string id`);
  }
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error(
      `todo item ${index + 1} requires a non-empty string content`
    );
  }
  if (!isTodoStatus(status)) {
    throw new Error(
      `todo item ${index + 1} status must be pending, in_progress, or completed`
    );
  }

  return {
    id,
    content,
    status,
  };
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return value === "pending" || value === "in_progress" || value === "completed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
