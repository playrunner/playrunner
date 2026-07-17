import { Router } from "express";

export const playwrightRouter = Router();

export const playwrightApiContribution = {
  id: "playwright",
  mountPath: "/api/playwright",
  router: playwrightRouter,
};

export default playwrightApiContribution;
