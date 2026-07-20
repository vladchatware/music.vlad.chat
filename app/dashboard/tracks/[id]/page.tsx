import { permanentRedirect } from "next/navigation";

export default async function LegacyTrackDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  permanentRedirect(`/tracks/${id}/backroom`);
}
