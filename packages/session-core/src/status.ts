// The api's session statuses and their labels (the plan's status table). Anything else shows as "Unknown", so a new
// status from the api never breaks the page.
export const STATUS_LABELS: Record<string, string> = {
  starting: "Starting",
  joining: "Joining",
  in_meeting: "In the meeting",
  ended: "Ended",
  failed: "Failed",
  start_failed: "Didn't start",
  start_unknown: "Check the meeting",
};

// Own keys only, so a status such as "constructor" reads as "Unknown" instead of finding the object's own methods.
export function isKnownStatus(status: string): boolean {
  return Object.hasOwn(STATUS_LABELS, status);
}

export function statusLabel(status: string): string {
  return isKnownStatus(status) ? STATUS_LABELS[status]! : "Unknown";
}

// Statuses still on their way: drawn dashed, the product's own rule.
export function isInProgress(status: string): boolean {
  return status === "starting" || status === "joining";
}
