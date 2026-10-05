/**
 * Answers each message on the port that comes with it: "pong", or for "create-policy" whether
 * code here can create a Trusted Types policy of its own. The Content-Security-Policy allows
 * only the platform's worker policy, so that answer must never be "created" (ADR 0011).
 */
export function respondToMessages(): void {
  self.addEventListener("message", (event) => {
    event.ports[0]?.postMessage(event.data === "create-policy" ? createOtherPolicy() : "pong");
  });
}

function createOtherPolicy(): "created" | "refused" | "unsupported" {
  const trustedTypes: unknown = Reflect.get(globalThis, "trustedTypes");
  if (
    typeof trustedTypes !== "object" ||
    trustedTypes === null ||
    !("createPolicy" in trustedTypes) ||
    typeof trustedTypes.createPolicy !== "function"
  ) {
    return "unsupported";
  }
  try {
    Reflect.apply(trustedTypes.createPolicy, trustedTypes, ["other", {}]);
    return "created";
  } catch {
    return "refused";
  }
}
