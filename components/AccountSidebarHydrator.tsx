"use client";

import { useEffect } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { clearStoredCustomerMobile, getStoredCustomerMobile } from "@/lib/clientOnboarding";
import { getCustomerAccount } from "@/lib/customerAccount";

/**
 * Keeps the logged-in Account navigation and shared welcome header consistent
 * on every Account page. This is intentionally UI-only.
 */
export default function AccountSidebarHydrator() {
  useEffect(() => {
    let alive = true;

    const addWelcomeHeader = (shell: HTMLElement) => {
      const container = shell.parentElement;
      if (!container || container.querySelector(":scope > .account-welcome")) return;

      const welcome = document.createElement("div");
      welcome.className = "account-title account-welcome";
      welcome.innerHTML = `
        <div>
          <div class="eyebrow">My Account</div>
          <h1>Welcome back</h1>
          <p class="muted">Manage your orders, subscriptions, deliveries and addresses.</p>
        </div>`;
      container.insertBefore(welcome, shell);
    };

    const addLogout = (side: HTMLElement) => {
      if (side.querySelector("[data-account-logout]")) return;

      const logout = document.createElement("button");
      logout.type = "button";
      logout.dataset.accountLogout = "true";
      logout.className = "account-logout";
      logout.textContent = "↪ Logout";
      logout.setAttribute("aria-label", "Logout");

      const profile = Array.from(side.querySelectorAll<HTMLAnchorElement>("a")).find((a) =>
        (a.getAttribute("href") || "").includes("profile")
      );

      if (profile) profile.insertAdjacentElement("afterend", logout);
      else side.appendChild(logout);

      logout.addEventListener("click", async () => {
        logout.disabled = true;
        logout.textContent = "Logging out…";
        try {
          clearStoredCustomerMobile();
          // Do not make logout feel blocked by a slow auth persistence round-trip.
          // Sign out locally and navigate immediately; Firebase completes the local state change.
          await Promise.race([
            signOut(auth),
            new Promise<void>((resolve) => window.setTimeout(resolve, 800)),
          ]);
          window.location.assign("/account");
        } catch (error) {
          console.error("Customer logout failed", error);
          logout.disabled = false;
          logout.textContent = "↪ Logout";
        }
      });
    };

    const wire = () => {
      const sidebars = document.querySelectorAll<HTMLElement>(".account-side");
      if (!sidebars.length) return;

      sidebars.forEach((side) => {
        addLogout(side);
        const shell = side.closest<HTMLElement>(".account-shell");
        if (shell) addWelcomeHeader(shell);
      });
    };

    const updateCustomerName = async () => {
      const mobile = getStoredCustomerMobile();
      if (!mobile || !auth.currentUser) return;

      try {
        const account = await getCustomerAccount(mobile);
        if (!alive) return;
        const name = account?.name?.trim() || "Customer";
        document.querySelectorAll<HTMLElement>(".account-welcome h1").forEach((heading) => {
          const nextText = `Welcome back, ${name}`;
          if (heading.textContent !== nextText) heading.textContent = nextText;
        });
      } catch (error) {
        console.warn("Account welcome header could not be hydrated", error);
      }
    };

    wire();
    void updateCustomerName();

    // Auth state can hydrate after the static Account HTML is rendered.
    // Re-run the shared welcome-name hydration when Firebase finishes restoring the session.
    const unsubscribeAuth = auth.onAuthStateChanged(() => {
      if (alive) void updateCustomerName();
    });

    // Observe only for newly rendered Account sidebars. Do not run the name
    // hydration from this observer because changing the heading itself creates
    // another DOM mutation and can cause an infinite MutationObserver loop.
    const observer = new MutationObserver(() => {
      wire();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      alive = false;
      observer.disconnect();
      unsubscribeAuth();
    };
  }, []);

  return null;
}
