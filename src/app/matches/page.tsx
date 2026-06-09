// The full match schedule has been merged into the main page ("/").
// This redirect keeps any bookmarked /matches links working.
import { redirect } from "next/navigation";

export default function MatchesPage() {
  redirect("/");
}
