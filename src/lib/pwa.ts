export function registerSW({ onNeedRefresh }: {
  onNeedRefresh: () => void;
}) {
  let registration: ServiceWorkerRegistration | undefined;
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').then(r => {
      registration = r;
      if (r.waiting)
        onNeedRefresh();
      r.addEventListener('updatefound', () => {
        r.installing?.addEventListener('statechange', () => {
          if (r.waiting && navigator.serviceWorker.controller)
            onNeedRefresh();
        });
      });
    }).catch(error => console.warn('Offline support could not start:', error));
  }
  return async (reload = false) => {
    if (reload) {
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
      registration?.waiting?.postMessage('SKIP_WAITING');
    }
  };
}
