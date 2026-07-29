import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL));
  }

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/instagram/oauth/callback`;
  const scope = [
    "instagram_basic",
    "instagram_manage_comments",
    "pages_show_list",
    "pages_read_engagement",
  ].join(",");

  const authUrl =
    `https://www.facebook.com/v20.0/dialog/oauth` +
    `?client_id=${process.env.INSTAGRAM_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scope}` +
    `&response_type=code`;

  return NextResponse.redirect(authUrl);
}
