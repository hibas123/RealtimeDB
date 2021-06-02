export type Operations = "read" | "write" | "list"; // | "update" | "create" | "delete" | "list";

export interface IRuleEngine {
   hasPermission(path: string[], operation: Operations, context: any): boolean;
}
