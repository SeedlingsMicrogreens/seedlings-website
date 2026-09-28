"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { auth } from "@/lib/firebase";
import { getStoredCustomerMobile } from "@/lib/clientOnboarding";
import { getCachedCustomerAccount, getCustomerAccount, updateCustomerProfile } from "@/lib/customerAccount";

const FIXED_DELIVERY_DAY = "Saturday";
const PLACEHOLDER = "Not provided";

function renderLogin(root: HTMLElement) {
  root.innerHTML = `<main class="section"><div class="container"><section class="auth-wrap"><div class="auth-card"><span class="eyebrow">My Profile</span><h1>Sign in to view your profile</h1><p>Your profile information is available after you sign in.</p><a class="btn primary" href="/account">Go to Account</a></div></section></div></main>`;
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
      if (!nameInput || !mobileInput || !emailInput || !daySelect || !saveButton) return;

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

      const applyCustomer = (customer: Awaited<ReturnType<typeof getCustomerAccount>> | null) => {
        if (!alive) return;
        nameInput.value = customer?.name?.trim() || "";
        nameInput.placeholder = PLACEHOLDER;
        emailInput.value = customer?.email?.trim() || "";
        emailInput.placeholder = PLACEHOLDER;
        mobileInput.value = customer?.phoneE164 || customer?.mobileNumber || customer?.mobile || `+91 ${mobile}`;
        daySelect.value = FIXED_DELIVERY_DAY;
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
