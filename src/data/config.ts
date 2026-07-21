// OAuth client IDs are public by design — this is not a secret. Override via
// VITE_GOOGLE_CLIENT_ID for a different deployment.
export const GOOGLE_CLIENT_ID: string =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ??
  "996945252569-0fhinopjkdr5udal57gn000k4f44ffrv.apps.googleusercontent.com";

// Browser API key used only to read *public* Drive files (published gardens),
// where there is no signed-in user to authorize a `files.get`. Like the client
// ID it is public by design; lock it down with an HTTP-referrer restriction in
// the Google Cloud console rather than treating it as a secret. Absent when no
// key has been provisioned — public-garden viewing is simply unavailable then.
export const GOOGLE_API_KEY: string | undefined = import.meta.env.VITE_GOOGLE_API_KEY;
