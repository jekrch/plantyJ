// OAuth client IDs are public by design — this is not a secret. Override via
// VITE_GOOGLE_CLIENT_ID for a different deployment.
export const GOOGLE_CLIENT_ID: string =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ??
  "996945252569-0fhinopjkdr5udal57gn000k4f44ffrv.apps.googleusercontent.com";
