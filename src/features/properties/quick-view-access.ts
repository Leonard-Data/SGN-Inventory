// Whether a row's quick view can open. The drawer states the caller's own permissions, which only
// this surface's session can state, so it opens under that session's scope and no other. A list
// painted from the catalogue the browser holds can show its rows before that read answers (issue
// #265), so in that window the row's controls state themselves unavailable rather than accepting a
// click that opens nothing; they become live the moment the session answers.
export function quickViewAvailable(sessionScope: string | null): boolean {
  return sessionScope !== null;
}
