export type ToolApprovalResult =
  | { behavior: "allow" }
  | { behavior: "deny"; message: string };

export type ToolApprovalResolver = {
  resolve: (result: ToolApprovalResult) => void;
};
