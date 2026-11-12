/* OL Portal · the Claude model the portal's own features run on.

   optimist.mjs and guides.mjs each carry their own copy of this string.
   Email intake is the third caller, so it reads from here; moving the other
   two over is a one-line change each and is left for a change that is about
   them. */
export const MODEL = "claude-sonnet-5";
