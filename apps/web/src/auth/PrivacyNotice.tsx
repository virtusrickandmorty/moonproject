/** The privacy notice on the sign-in pages (Data Privacy Act of 2012, RA 10173; PLAN C6 privacy row). */
import { useState } from 'react';
import { Button, Dialog } from '../components/ui.tsx';

const SECTIONS: [heading: string, body: string][] = [
  ['Who keeps your data', 'Virtus Garments, Inc. runs Virtus on its own computer in the shop. Your data stays on that computer and on the shop\'s encrypted backups. It is not sent to an outside service.'],
  ['What we record about you', 'Your name, username and roles; your passphrase, kept only as a one-way scrambled code that nobody can read back; each sign-in attempt with its time and the network address of the device; and a history of what you record, change or print, with the time.'],
  ['Why', 'To let you in, to protect the shop\'s books, to show who did what, and to keep the records the BIR and other laws require.'],
  ['Customer and staff data', 'You will see personal data about customers and co-workers, such as names, phone numbers, measurements and pay. Use it only for your work at the shop. Do not copy it, photograph it or share it outside the shop.'],
  ['Who can see it', 'Each person sees only what their role allows. Salaries are visible only to people allowed to see pay rates.'],
  ['How long', 'Business records are never deleted, because the law requires them to be kept. When you leave, your account is switched off and you can no longer sign in.'],
  ['Your rights', 'You may ask the shop Owner to show you the personal data kept about you and to correct anything that is wrong. Questions or complaints about your data go to the Owner first. You may also contact the National Privacy Commission (privacy.gov.ph).'],
];

export function PrivacyNotice() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="mt-4 text-center text-xs text-slate-500">
        By signing in you agree to our{' '}
        <button type="button" className="font-medium text-indigo-700 underline hover:text-indigo-900" onClick={() => setOpen(true)}>Privacy notice</button>.
      </p>
      {open && (
        <Dialog title="Privacy notice" onClose={() => setOpen(false)}>
          {SECTIONS.map(([heading, body]) => (
            <section key={heading} className="space-y-1">
              <h3 className="text-sm font-semibold">{heading}</h3>
              <p className="text-sm text-slate-600">{body}</p>
            </section>
          ))}
          <div className="flex justify-end">
            <Button type="button" tone="primary" onClick={() => setOpen(false)}>Close</Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
