/**
 * Phone notifications (the owner's request, Nov 2026): turn them on or off for this phone (or computer). On, the app's
 * service worker gets a push whenever something new comes up in the person's bell. An iPhone takes them only once Virtus
 * is on the Home Screen; a browser that cannot, or a person who blocked them, is told what to do instead.
 */
import { useEffect, useState } from 'react';
import { api } from '../api.ts';

type State = 'checking' | 'unsupported' | 'add-to-home' | 'blocked' | 'off' | 'on';

const keyBytes = (base64url: string) => {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const installed = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const device = () => (isIos() ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'Computer');

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export function PushToggle({ className = '', where = 'phone' }: { className?: string; where?: 'phone' | 'computer' }) {
  const [state, setState] = useState<State>('checking');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState(isIos() && !installed() ? 'add-to-home' : 'unsupported');
      return;
    }
    if (Notification.permission === 'denied') { setState('blocked'); return; }
    void currentSubscription().then((s) => setState(s ? 'on' : 'off'), () => setState('off'));
  }, []);

  const turnOn = async () => {
    setBusy(true); setNote('');
    try {
      if ((await Notification.requestPermission()) !== 'granted') { setState('blocked'); return; }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
      const { publicKey } = await api.pushKey();
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api.pushSubscribe({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }, device: device() });
      setState('on');
      const t = await api.pushTest();
      setNote(t.sent ? 'On. A test notification is on its way.' : `On, but the test did not arrive. Check this ${where}'s notification settings for Virtus.`);
    } catch (e) {
      setNote(`Could not turn them on: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };
  const turnOff = async () => {
    setBusy(true); setNote('');
    try {
      const sub = await currentSubscription();
      if (sub) { await api.pushUnsubscribe(sub.endpoint); await sub.unsubscribe(); }
      setState('off');
    } catch (e) {
      setNote(`Could not turn them off: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const words: Record<State, string> = {
    checking: '', unsupported: 'This browser cannot show notifications from Virtus.',
    'add-to-home': 'On an iPhone, add Virtus to the Home Screen first (Share › Add to Home Screen), open it from there, then turn notifications on here.',
    blocked: `Notifications are blocked for Virtus. Allow them in this ${where === 'phone' ? "phone's" : "browser's"} settings, then come back.`,
    off: `Get a notification on this ${where} when something new needs doing.`, on: `On for this ${where}: new things in your bell come here too.`,
  };
  if (state === 'checking') return null;
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-700">{words[state]}</span>
        {(state === 'off' || state === 'on') && (
          <button type="button" role="switch" aria-checked={state === 'on'} aria-label={`Notifications on this ${where}`} disabled={busy}
            onClick={() => void (state === 'on' ? turnOff() : turnOn())}
            className={`flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition-colors disabled:opacity-60 ${state === 'on' ? 'justify-end bg-indigo-600' : 'justify-start bg-slate-300'}`}>
            <span className="size-6 rounded-full bg-white shadow" />
          </button>
        )}
      </div>
      {note && <p role="status" className="text-xs text-slate-600">{note}</p>}
    </div>
  );
}
