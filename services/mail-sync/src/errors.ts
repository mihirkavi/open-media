/** An error whose message was written by us for people to read; it never contains credentials. */
export class UserFacingError extends Error {
  override name = 'UserFacingError';
}
