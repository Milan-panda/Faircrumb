import { useEffect, useRef, useState } from 'react';
type InstallChoice = { outcome: 'accepted' | 'dismissed' };
export type InstallPrompt = Event & { prompt: () => Promise<InstallChoice | void>; userChoice?: Promise<InstallChoice> };
function standalone() { return !!window.matchMedia?.('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone; }
function device() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return { ios, mobile: ios || /Android|Mobile/.test(navigator.userAgent) || !!window.matchMedia?.('(max-width: 760px)').matches };
}
export function usePwaInstall() {
  const [installed, setInstalled] = useState(standalone);
  const [available, setAvailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [platform, setPlatform] = useState(device);
  const prompt = useRef<InstallPrompt | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const display = window.matchMedia?.('(display-mode: standalone)');
    const viewport = window.matchMedia?.('(max-width: 760px)');
    const onViewport = () => setPlatform(device());
    const beforeInstall = (event: Event) => { event.preventDefault(); prompt.current = event as InstallPrompt; setAvailable(true); setMessage(''); };
    const onInstalled = () => { prompt.current = null; setAvailable(false); setInstalled(true); setMessage('faircrumb has been added to your apps.'); };
    const onDisplay = () => setInstalled(standalone());
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    display?.addEventListener('change', onDisplay);
    viewport?.addEventListener('change', onViewport);
    return () => { alive.current = false; window.removeEventListener('beforeinstallprompt', beforeInstall); window.removeEventListener('appinstalled', onInstalled); display?.removeEventListener('change', onDisplay); viewport?.removeEventListener('change', onViewport); };
  }, []);
  async function request(): Promise<'manual' | 'accepted' | 'dismissed' | 'busy' | 'installed'> {
    if (installed || standalone()) return 'installed';
    if (busy.current) return 'busy';
    const event = prompt.current;
    if (!event) return 'manual';
    // A beforeinstallprompt event is single-use. Consume it before awaiting anything.
    prompt.current = null; busy.current = true; setPending(true); setAvailable(false);
    try {
      const result = await event.prompt();
      const choice = result || (event.userChoice ? await event.userChoice : undefined);
      if (alive.current) setMessage(choice?.outcome === 'accepted' ? 'Installation requested. Look for faircrumb on your home screen.' : 'You can install later using your browser’s menu.');
      return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
    } catch {
      if (alive.current) setMessage('The browser could not open its install prompt. Use the installation steps below.');
      return 'manual';
    } finally {
      busy.current = false; if (alive.current) setPending(false);
    }
  }
  return { installed, available, pending, message, ...platform, request };
}
export type InstallController = ReturnType<typeof usePwaInstall>;
