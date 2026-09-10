import { PLAYRUNNER_API_URL, PORT } from "./config";
import { createMcpApp } from "./server";

const server = createMcpApp().listen(PORT, () => {
  console.log(
    `Playrunner MCP server running on port ${PORT} (API ${PLAYRUNNER_API_URL})`,
  );
});

const shutdown = () => server.close();
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
