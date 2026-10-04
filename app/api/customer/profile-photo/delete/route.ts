import { NextResponse } from "next/server";
import { requireFirebaseUser } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/httpError";
import { createHash } from "node:crypto";

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "df1j4s8cu";
const API_KEY = process.env.CLOUDINARY_API_KEY || "";
const API_SECRET = process.env.CLOUDINARY_API_SECRET || "";

function getPublicIdFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const marker = "/image/upload/";
    const index = url.pathname.indexOf(marker);
    if (index < 0) return null;

    let path = url.pathname.slice(index + marker.length).replace(/^\/+/, "");
    const segments = path.split("/").filter(Boolean);
    if (!segments.length) return null;

    // Remove delivery transformations and version segments when present.
    const versionIndex = segments.findIndex((segment) => /^v\d+$/.test(segment));
    if (versionIndex >= 0) {
      segments.splice(0, versionIndex + 1);
    } else if (segments[0]?.includes(",") || /^(?:c|w|h|q|f|ar|dpr|g|r|e|fl)_/.test(segments[0] || "")) {
      while (segments.length && (/^(?:c|w|h|q|f|ar|dpr|g|r|e|fl)_/.test(segments[0]) || segments[0].includes(","))) {
        segments.shift();
      }
    }

    if (!segments.length) return null;
    const last = segments[segments.length - 1];
    segments[segments.length - 1] = last.replace(/\.[^.]+$/, "");
    return segments.join("/") || null;
  } catch {
    return null;
  }
}

function sign(publicId: string, timestamp: number): string {
  return createHash("sha1")
    .update(`public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`)
    .digest("hex");
}

export async function POST(request: Request) {
  try {
    await requireFirebaseUser(request);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  if (!API_KEY || !API_SECRET) {
    return NextResponse.json(
      { error: "Cloudinary deletion is not configured on the server." },
      { status: 500 }
    );
  }

  let body: { url?: string };
  try {
    body = (await request.json()) as { url?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const url = String(body.url || "").trim();
  if (!url) return NextResponse.json({ error: "Photo URL is required." }, { status: 400 });

  const publicId = getPublicIdFromUrl(url);
  if (!publicId) return NextResponse.json({ error: "Invalid Cloudinary photo URL." }, { status: 400 });

  const timestamp = Math.floor(Date.now() / 1000);
  const formData = new URLSearchParams();
  formData.set("public_id", publicId);
  formData.set("timestamp", String(timestamp));
  formData.set("api_key", API_KEY);
  formData.set("signature", sign(publicId, timestamp));

  const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/destroy`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
    cache: "no-store",
  });

  const result = (await response.json().catch(() => null)) as { result?: string; error?: { message?: string } } | null;
  if (!response.ok || !result || (result.result !== "ok" && result.result !== "not found")) {
    return NextResponse.json(
      { error: result?.error?.message || "Cloudinary photo deletion failed." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, result: result.result });
}
