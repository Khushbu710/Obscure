import { ApiError, NetworkError, ResponseShapeError } from "../../lib/api/client";
import { Icon } from "../common/Icon";

/** Renders the ACTUAL backend error code/message - never a generic "something went wrong" that hides what happened, and never silently treated as success. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  let title = "Something went wrong";
  let detail = "An unexpected error occurred.";

  if (error instanceof ApiError) {
    title = error.code;
    detail = error.message;
  } else if (error instanceof NetworkError) {
    title = "Connection problem";
    detail = error.message;
  } else if (error instanceof ResponseShapeError) {
    title = "Unexpected response";
    detail = "The backend returned a response this version of the frontend doesn't understand. " + error.message;
  } else if (error instanceof Error) {
    detail = error.message;
  }

  return (
    <div className="error-state">
      <Icon name="alert" />
      <div>
        <b>{title}</b>
        <p>{detail}</p>
        {onRetry && (
          <button className="text-button" style={{ marginTop: 10 }} onClick={onRetry}>
            Try again <Icon name="arrow" />
          </button>
        )}
      </div>
    </div>
  );
}
