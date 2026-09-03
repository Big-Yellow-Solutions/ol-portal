/* The portal opens on Community.

   There used to be a dashboard here — a digest, a pipeline card and a
   presence list — and it is gone rather than hidden: everything it showed has
   a screen of its own that draws it properly, and a landing page that
   re-plots the pipeline is a second place for the same numbers to be wrong.

   Community's implementation stays at app/(portal)/community, and this route
   renders it, so the deep links already pointing at /community (the People
   footnote's ?tab=members, a digest's ?post=) keep resolving. The nav treats
   both paths as the same destination.
*/
export { default } from "@/app/(portal)/community/page";
