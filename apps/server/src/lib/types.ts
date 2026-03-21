export type ToolApprovalResult =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string };

export type ToolApprovalResolver = {
  resolve: (result: ToolApprovalResult) => void;
  input: Record<string, unknown>;
};
