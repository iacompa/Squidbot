import { likePattern } from "./internal.js";

export function permissionAllows(permission: string, action: string): boolean {
  if (permission === "*") {
    return true;
  }
  return likePattern(permission, action);
}

export function anyPermissionAllows(permissions: string[], action: string): boolean {
  return permissions.some((permission) => permissionAllows(permission, action));
}

export function isWriteLikeAction(action: string): boolean {
  return /(write|createPatch|promote|push|merge|delete|remove|update|createPullRequest|connector\..*\.(create|update|delete|merge|push|trigger|close)|secret\.reveal|audit\.export|evolve\.promote)/i.test(action);
}

export function isHighRiskAction(action: string, riskLevel?: string): boolean {
  return riskLevel === "high" || riskLevel === "critical" || /(promote|merge|push|delete|secret\.reveal|connector\..*\.(merge|push|delete|trigger)|evolve\.promote|sandbox\.promote)/i.test(action);
}
