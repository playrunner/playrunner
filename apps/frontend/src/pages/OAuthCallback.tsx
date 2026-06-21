import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

export default function OAuthCallback() {
  useEffect(() => {
    // Post a message to the parent window with the OAuth params, then
    // listen for an explicit 'oauth_close' from the parent. As a fallback,
    // auto-close after 3 seconds so the popup never gets stuck open.
    if (window.opener) {
      const urlParams = new URLSearchParams(window.location.search);
      const params = Object.fromEntries(urlParams.entries());

      // Fallback: close the popup after 3 seconds regardless of parent response.
      const autoCloseTimer = setTimeout(() => {
        window.close();
      }, 3000);

      const messageListener = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;

        if (event.data?.type === 'oauth_install_redirect' && event.data?.url) {
          clearTimeout(autoCloseTimer);
          window.location.href = event.data.url;
        } else if (event.data?.type === 'oauth_close') {
          clearTimeout(autoCloseTimer);
          window.close();
        }
      };

      window.addEventListener('message', messageListener);

      window.opener.postMessage(
        { type: 'oauth_callback', success: true, params },
        window.location.origin,
      );

      return () => {
        clearTimeout(autoCloseTimer);
        window.removeEventListener('message', messageListener);
      };
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[var(--background)]">
      <Loader2 className="w-8 h-8 text-[var(--accent)] animate-spin mb-4" />
      <p className="text-[var(--foreground)] font-medium">
        Authentication successful! Please wait...
      </p>
      <p className="text-muted text-sm mt-4">
        You can safely close this window if nothing happens after a few seconds.
      </p>
    </div>
  );
}
