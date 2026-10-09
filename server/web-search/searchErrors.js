/** Raised when live web search cannot run; the message is safe to show users. */
export class WebSearchUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.code = 'WEB_SEARCH_UNAVAILABLE';
  }
}
