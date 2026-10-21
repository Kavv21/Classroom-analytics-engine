/**
 * Professor-facing wording for a `provisioning_failures.error_code`
 * (supabase/migrations/0030). The raw Postgres message names constraints
 * and is useless to a professor; it is logged server-side instead.
 */
export function describeProvisioningFailure(errorCode: string): string {
  switch (errorCode) {
    case "DUPLICATE_AUTH_ACCOUNTS":
      return "More than one sign-in account uses this email, so it wasn't linked automatically. They're on the roster but can't get in yet — an administrator needs to look at it.";
    case "23505":
      return "This email clashes with an existing account. They're on the roster but can't get in yet — an administrator needs to look at it.";
    default:
      return "This student couldn't be set up automatically. They're on the roster but can't get in yet — an administrator needs to look at it.";
  }
}
