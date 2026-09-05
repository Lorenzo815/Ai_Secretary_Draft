"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void Promise.all([
        navigator.serviceWorker.getRegistrations().then((registrations) => (
          Promise.all(registrations.map((registration) => registration.unregister()))
        )),
        caches.keys().then((keys) => (
          Promise.all(keys.filter((key) => key.startsWith("oria-")).map((key) => caches.delete(key)))
        )),
      ]);
      return;
    }

    void navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  }, []);

  return null;
}
