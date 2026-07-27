import type { Context } from "hono";

const ERROR_DEFINITIONS = {
  INVALID_QUERY: {
    status: 400,
    message: "Invalid query parameters",
  },
  NOT_FOUND: {
    status: 404,
    message: "Route not found",
  },
  CONTENT_NOT_READABLE: {
    status: 422,
    message: "Could not extract readable content",
  },
  UPSTREAM_TIMEOUT: {
    status: 504,
    message: "Timed out while loading page",
  },
  UPSTREAM_FAILURE: {
    status: 502,
    message: "Failed to load page",
  },
  INTERNAL_ERROR: {
    status: 500,
    message: "An internal error occurred",
  },
} as const;

type ErrorCode = keyof typeof ERROR_DEFINITIONS;

export function errorResponse<C extends ErrorCode>(
  c: Context,
  code: C,
  details: Record<string, unknown> = {},
) {
  const definition = ERROR_DEFINITIONS[code];

  return c.json(
    {
      error: {
        ...details,
        code,
        message: definition.message,
      },
    },
    definition.status,
  );
}
