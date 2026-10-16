// The workspace package's checked-in declaration output may lag its generated source.
// Keep the frontend typecheck aligned with the current generated API exports.
import "@workspace/api-client-react";
declare module "@workspace/api-client-react" {
  export const getGetBootstrapStatusQueryKey: () => readonly ["/api/auth/bootstrap-status"];
  export function useGetBootstrapStatus(options?: any): any;
  export function useBootstrapAdmin(options?: any): any;
  export function useUpdatePilotProfile(options?: any): any;
  export function useImportSimbriefPlan(options?: any): any;
  export function useUpdateAdminUser(options?: any): any;
}
