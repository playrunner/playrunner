export const PORT = process.env.MCP_PORT || "3013";

/**
 * Base URL of the Playrunner API this server wraps.
 *
 * On cloud this must be the public URL, not an internal address: run metering
 * lives in the gateway that fronts the API, so a run started through an
 * internal route would consume compute without being counted against the
 * account's quota.
 */
export const PLAYRUNNER_API_URL = (
  process.env.PLAYRUNNER_API_URL || "http://localhost:3011"
).replace(/\/+$/, "");
