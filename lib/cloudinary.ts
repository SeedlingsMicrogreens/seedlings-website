"use client";

export async function uploadToCloudinary(file: File): Promise<string> {
  const cloudName = "df1j4s8cu";
  const uploadPreset = "seedlings_unsigned";
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: "POST", body: formData });
  if (!res.ok) throw new Error("Cloudinary upload failed");
  const data = await res.json();
  if (!data?.secure_url) throw new Error("Cloudinary did not return an image URL.");
  return data.secure_url as string;
}

export async function deleteFromCloudinary(url: string): Promise<void> {
  const { auth } = await import("@/lib/firebase");
  const user = auth.currentUser;
  if (!user) throw new Error("Your login session expired. Please sign in again.");
  const idToken = await user.getIdToken();

  const response = await fetch("/api/customer/profile-photo/delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ url }),
  });
  const result = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(result?.error || "Unable to delete the profile photo.");
}
