import { validator } from "hono/validator";
import * as z from "zod";

import { errorResponse } from "../../http/errors.ts";

const querySchema = z.object({
  url: z.url({
    protocol: /^https?$/,
    error: "'url' must be a valid HTTP or HTTPS URL",
  }),
  output: z.enum(["json", "md"]).default("json"),
});

export const validateQuery = validator("query", (value, c) => {
  const result = querySchema.safeParse(value);

  if (!result.success) {
    return errorResponse(c, "INVALID_QUERY", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
});
