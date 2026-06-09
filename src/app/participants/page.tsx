import { redirect } from "next/navigation";

// The participants list is no longer a standalone page.
// Names in the leaderboard link directly to each participant's prediction sheet.
export default function ParticipantsPage() {
  redirect("/leaderboard");
}
