"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { auth } from "@/lib/firebase";
import { getStoredCustomerMobile } from "@/lib/clientOnboarding";
import { getCachedCustomerAccount, getCustomerAccount, updateCustomerProfile, updateCustomerProfilePhoto } from "@/lib/customerAccount";
import { deleteFromCloudinary, uploadToCloudinary } from "@/lib/cloudinary";

const FIXED_DELIVERY_DAY = "Saturday";
const PLACEHOLDER = "Not provided";

function renderLogin(root: HTMLElement) {
  root.innerHTML = `<main class="section"><div class="container"><section class="auth-wrap"><div class="auth-card"><span class="eyebrow">My Profile</span><h1>Sign in to view your profile</h1><p>Your profile information is available after you sign in.</p><button class="btn primary" type="button" data-profile-login>Login</button></div></section></div></main>`;
  root.querySelector<HTMLButtonElement>("[data-profile-login]")?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("seedlings-open-login", { detail: { redirectTo: "/profile" } }));
  });
}

export default function ProfileHydrator({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let alive = true;

    const hydrate = async () => {
      // The mobile number saved at login is the customer identity for the website.
      // Do not wait for Firebase Auth restoration before rendering the profile.
      const mobile = getStoredCustomerMobile();
      if (!mobile) {
        renderLogin(root);
        return;
      }

      const form = root.querySelector(".account-main .form") as HTMLElement | null;
      if (!form) return;

      const inputs = Array.from(form.querySelectorAll("input")) as HTMLInputElement[];
      const nameInput = inputs[0] || null;
      const mobileInput = inputs[1] || null;
      const emailInput = inputs[2] || null;
      const daySelect = form.querySelector("select") as HTMLSelectElement | null;
      const saveButton = form.querySelector("button") as HTMLButtonElement | null;
      const photoInput = root.querySelector<HTMLInputElement>("[data-profile-photo-input]");
      const photoPreview = root.querySelector<HTMLElement>("[data-profile-photo-preview]");
      const photoChoose = root.querySelector<HTMLButtonElement>("[data-profile-photo-choose]");
      const photoRemove = root.querySelector<HTMLButtonElement>("[data-profile-photo-remove]");
      const photoMessage = root.querySelector<HTMLElement>("[data-profile-photo-message]");
      if (!nameInput || !mobileInput || !emailInput || !daySelect || !saveButton || !photoInput || !photoPreview || !photoChoose || !photoRemove || !photoMessage) return;

      // Phase 1 has Saturday as the only delivery day. This is not a customer
      // preference selector yet; it is a fixed business rule.
      daySelect.innerHTML = `<option value="Saturday">Saturday</option>`;
      daySelect.value = FIXED_DELIVERY_DAY;
      daySelect.disabled = true;
      daySelect.setAttribute("aria-label", "Preferred delivery day: Saturday");

      // Mobile is always known from the login session and must never be blank.
      mobileInput.value = `+91 ${mobile}`;
      mobileInput.placeholder = "Mobile number";
      mobileInput.disabled = true;

      let customerPhotoUrl = "";

      const renderPhoto = (url: string) => {
        if (!photoPreview) return;
        const safeUrl = String(url || "").trim();
        photoPreview.innerHTML = safeUrl ? `<img src="${safeUrl.replace(/"/g, '&quot;')}" alt="Profile photo">` : `<img src="/profile-default.jpg" alt="Default profile photo">`;
        photoRemove.hidden = !safeUrl;
        photoChoose.textContent = safeUrl ? "Change photo" : "Upload photo";
      };

      const applyCustomer = (customer: Awaited<ReturnType<typeof getCustomerAccount>> | null) => {
        if (!alive) return;
        nameInput.value = customer?.name?.trim() || "";
        nameInput.placeholder = PLACEHOLDER;
        emailInput.value = customer?.email?.trim() || "";
        emailInput.placeholder = PLACEHOLDER;
        mobileInput.value = customer?.phoneE164 || customer?.mobileNumber || customer?.mobile || `+91 ${mobile}`;
        daySelect.value = FIXED_DELIVERY_DAY;
        customerPhotoUrl = customer?.profilePhotoUrl?.trim() || "";
        renderPhoto(customerPhotoUrl);
      };

      let message = form.querySelector("[data-profile-message]") as HTMLElement | null;
      if (!message) {
        message = document.createElement("p");
        message.dataset.profileMessage = "true";
        message.style.cssText = "margin:12px 0 0;font-size:13px";
        form.appendChild(message);
      }
      const setMessage = (text: string, error = false) => {
        if (!message) return;
        message.textContent = text;
        message.style.color = error ? "#a43f35" : "";
      };

      // Cache-first. A cached record is shown immediately; if no cache exists,
      // leave editable fields blank so their placeholders are visible.
      const cached = getCachedCustomerAccount(mobile);
      applyCustomer(cached === undefined ? null : cached);

      if (photoChoose.dataset.profileWired !== "true") {
        photoChoose.dataset.profileWired = "true";
        photoChoose.addEventListener("click", () => photoInput.click());
        photoInput.addEventListener("change", async () => {
          const file = photoInput.files?.[0];
          if (!file) return;
          photoMessage.textContent = "";
          if (!file.type.startsWith("image/")) { photoMessage.textContent = "Please select an image file."; photoInput.value = ""; return; }
          if (file.size > 5 * 1024 * 1024) { photoMessage.textContent = "Profile photo must be 5 MB or smaller."; photoInput.value = ""; return; }
          const previous = photoChoose.textContent;
          photoChoose.disabled = true;
          photoRemove.disabled = true;
          photoChoose.textContent = "Uploading…";
          try {
            const previousUrl = customerPhotoUrl;
            const url = await uploadToCloudinary(file);
            await updateCustomerProfilePhoto(mobile, url);

            if (previousUrl && previousUrl !== url) {
              try {
                await deleteFromCloudinary(previousUrl);
              } catch (deleteError) {
                // Do not leave the customer pointing at the new image while the old
                // Cloudinary asset remains. Restore the previous reference and try
                // to clean up the newly uploaded asset as well.
                try { await updateCustomerProfilePhoto(mobile, previousUrl); } catch {}
                try { await deleteFromCloudinary(url); } catch {}
                throw deleteError;
              }
            }

            customerPhotoUrl = url;
            renderPhoto(url);
            photoMessage.textContent = "Profile photo updated successfully.";
            window.dispatchEvent(new CustomEvent("seedlings-customer-authenticated", { detail: { mobile } }));
          } catch (error) {
            console.error("Profile photo upload failed", error);
            photoMessage.textContent = error instanceof Error ? error.message : "Unable to upload your profile photo.";
          } finally {
            photoChoose.disabled = false;
            photoRemove.disabled = false;
            photoChoose.textContent = previous || "Upload photo";
            photoInput.value = "";
          }
        });
        photoRemove.addEventListener("click", async () => {
          photoMessage.textContent = "";
          photoChoose.disabled = true;
          photoRemove.disabled = true;
          photoRemove.textContent = "Removing…";
          try {
            const previousUrl = customerPhotoUrl;
            if (previousUrl) {
              // Clear the profile reference first, then delete the asset. If the
              // Cloudinary deletion fails, restore the old reference so the
              // customer never loses a working photo.
              await updateCustomerProfilePhoto(mobile, "");
              try {
                await deleteFromCloudinary(previousUrl);
              } catch (deleteError) {
                try { await updateCustomerProfilePhoto(mobile, previousUrl); } catch {}
                throw deleteError;
              }
            } else {
              await updateCustomerProfilePhoto(mobile, "");
            }
            customerPhotoUrl = "";
            renderPhoto("");
            photoMessage.textContent = "Profile photo removed.";
            window.dispatchEvent(new CustomEvent("seedlings-customer-authenticated", { detail: { mobile } }));
          } catch (error) {
            console.error("Profile photo removal failed", error);
            photoMessage.textContent = error instanceof Error ? error.message : "Unable to remove your profile photo.";
          } finally {
            photoChoose.disabled = false;
            photoRemove.disabled = false;
            photoRemove.textContent = "Remove photo";
          }
        });
      }

      if (saveButton.dataset.profileWired !== "true") {
        saveButton.dataset.profileWired = "true";
        saveButton.addEventListener("click", async () => {
          setMessage("");
          const name = nameInput.value.trim();
          const email = emailInput.value.trim();
          if (!name) {
            setMessage("Please enter your full name.", true);
            nameInput.focus();
            return;
          }
          if (email && !/^\S+@\S+\.\S+$/.test(email)) {
            setMessage("Please enter a valid email address.", true);
            emailInput.focus();
            return;
          }

          saveButton.disabled = true;
          saveButton.textContent = "Saving…";
          try {
            await updateCustomerProfile(mobile, name, email, FIXED_DELIVERY_DAY);
            const updated = await getCustomerAccount(mobile, { bypassCache: true });
            if (!alive) return;
            applyCustomer(updated);
            setMessage("Profile updated successfully.");
          } catch (error) {
            console.error("Customer profile update failed", error);
            setMessage(error instanceof Error ? error.message : "Unable to save your profile.", true);
          } finally {
            if (alive) {
              saveButton.disabled = false;
              saveButton.textContent = "Save changes";
            }
          }
        });
      }

      // Always refresh from Firestore in the background. This guarantees that
      // existing customer data (including name/email) is displayed even when
      // the cache is empty or stale.
      try {
        const customer = await getCustomerAccount(mobile, { bypassCache: true });
        if (!alive) return;
        applyCustomer(customer);
      } catch (error) {
        console.error("Customer profile load failed", error);
        if (alive && cached === undefined) {
          setMessage("Profile details could not be loaded right now.", true);
        }
      }
    };

    void hydrate();

    return () => {
      alive = false;
    };
  }, []);



  return <div ref={ref}>{children}</div>;
}
