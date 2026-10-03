import type { HostedRequest, HostedResponse } from "./http.js";
import { secureJson } from "./http.js";

export default function health(request: HostedRequest, response: HostedResponse): void {
  secureJson(response);
  if (request.method !== "GET") {
    response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    return;
  }
  response.status(200).json({ status: "ready", service: "verus-hosted-scanner", version: 1 });
}
