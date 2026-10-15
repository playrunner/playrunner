import { readFileSync } from "node:fs";
import { join } from "node:path";

export const WORKFLOW_EDITOR_URI = "ui://playrunner/workflow-editor-v1.html";
export const workflowEditorResource = {
  uri: WORKFLOW_EDITOR_URI,
  name: "Playrunner workflow editor",
  mimeType: "text/html;profile=mcp-app",
};
export function readWorkflowEditorResource() {
  return {
    contents: [
      {
        ...workflowEditorResource,
        text: readFileSync(join(__dirname, "workflow-editor.html"), "utf8"),
        _meta: {
          ui: {
            prefersBorder: true,
            csp: { connectDomains: [], resourceDomains: [] },
          },
        },
      },
    ],
  };
}
