import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL));
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(
      new URL("/dashboard?error=no_code", process.env.NEXTAUTH_URL)
    );
  }

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/instagram/oauth/callback`;
  const appId = process.env.INSTAGRAM_APP_ID!;
  const appSecret = process.env.INSTAGRAM_APP_SECRET!;

  try {
    // Step 1: exchange code for a short-lived token
    const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
    });
    const shortData = await shortRes.json();
    const shortToken = shortData.access_token;
    const igUserId = shortData.user_id;
    if (!shortToken) throw new Error(JSON.stringify(shortData));

    // Step 2: exchange for a long-lived token (~60 days)
    const longRes = await fetch(
      `https://graph.instagram.com/access_token` +
        `?grant_type=ig_exchange_token` +
        `&client_secret=${appSecret}` +
        `&access_token=${shortToken}`
    );
    const longData = await longRes.json();
    const longToken = longData.access_token;
    if (!longToken) throw new Error(JSON.stringify(longData));

    // Step 3: get the username
    const meRes = await fetch(
      `https://graph.instagram.com/me?fields=id,username&access_token=${longToken}`
    );
    const meData = await meRes.json();

    // Step 4: save it
    await prisma.instagramAccount.upsert({
      where: {
        userId_igUserId: { userId: (session.user as any).id, igUserId: String(igUserId) },
      },
      update: { username: meData.username, accessToken: longToken },
      create: {
        userId: (session.user as any).id,
        igUserId: String(igUserId),
        username: meData.username,
        accessToken: longToken,
      },
    });

    return NextResponse.redirect(new URL("/dashboard?connected=1", process.env.NEXTAUTH_URL));
  } catch (err) {
    console.error("Instagram OAuth error", err);
    return NextResponse.redirect(
      new URL("/dashboard?error=oauth_failed", process.env.NEXTAUTH_URL)
    );
  }
}
