export type ErrorCode =
  | "INVALID_QUERY"
  | "CONTENT_NOT_READABLE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_FAILURE"
  | "INTERNAL_ERROR";

export type ErrorBody<C extends ErrorCode = ErrorCode> = {
  error: {
    code: C;
    message: string;
  };
};

export function apiError<C extends ErrorCode>(code: C, message: string): ErrorBody<C> {
  return {
    error: {
      code,
      message,
    },
  };
}
