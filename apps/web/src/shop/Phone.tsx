/**
 * The website on a phone, like a shopping app (the owner's request, Nov 2026): a top bar with the search always open, a
 * tab bar along the bottom, round shortcuts on the home page, and a "More" sheet with every link and detail the
 * computer's header and footer have. Phones only (under md); the computer's website stays exactly as it is.
 */
import type { FormEvent, ReactNode } from 'react';
import { Link, navigate } from '../router.tsx';
import { rememberedOrders } from './Checkout.tsx';
import { browserSaysNo } from './insights.ts';
import { Overlay } from './Panels.tsx';
import { SHOP_CONTACT, isSoldOut, percentOff, type Product } from './products.ts';
import type { Panel } from './Site.tsx';
import { useShop } from './store.tsx';

const Icon = ({ d, className = 'size-6' }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const PATH = {
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 2-4-4',
  heart: 'M12 20s-7-4.4-9.2-8.6C1.2 8.2 3.2 4.5 6.8 4.5c2 0 3.4 1.1 4.2 2.4h2c.8-1.3 2.2-2.4 4.2-2.4 3.6 0 5.6 3.7 4 6.9C19 15.6 12 20 12 20Z',
  bag: 'M5 7h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 7Zm3 0a4 4 0 0 1 8 0',
  shop: 'M4 9.5 5.5 4h13L20 9.5M4 9.5h16M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12.5V20h13v-7.5M10 20v-4.5h4V20',
  needle: 'M4 20 15.5 8.5M14 4l6 6M12.5 5.5l6 6',
  box: 'M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Zm0 0L12 12m0 0 8.5-4.5M12 12v9',
  chat: 'M7.5 9h9M7.5 12.5H13M4 5.5h16v11h-8.5L7 20v-3.5H4v-11Z',
  more: 'M5 6h14M5 12h14M5 18h14',
  tag: 'M3.5 12.5 11 5h8v8l-7.5 7.5-8-8Zm11.5-4a.5.5 0 1 0 0 .01',
  shirt: 'M8 4 4 6.5l1.5 4 2-.8V20h9V9.7l2 .8 1.5-4L16 4a4 4 0 0 1-8 0Z',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  ruler: 'M3 16.5 16.5 3 21 7.5 7.5 21 3 16.5Zm4-4 2 2m1-5 2 2m1-5 2 2',
  quote: 'M7 3.5h7l4 4V20.5H7v-17Zm7 0v4h4M10 12h5m-5 3.5h5',
  phone: 'M5 4h4l1.5 4.5-2.3 1.4a11 11 0 0 0 6 6l1.4-2.3L20 15v4a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z',
  mail: 'M3.5 6h17v12h-17V6Zm0 0 8.5 7 8.5-7',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4.5l3 2',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v5.5M12 8h.01',
  doc: 'M7 3.5h10v17H7v-17Zm3 5h4m-4 3.5h4m-4 3.5h2',
  key: 'M14.5 9.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-1.2 2.8L20 19m-2.5-2.5L19 15',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
};

const badge = (n: number, tone: string) => n > 0 && (
  <span className={`absolute -right-1 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-bold text-white ring-2 ring-white ${tone}`}>{n > 99 ? '99+' : n}</span>
);

/** The phone's top bar: the logo, the search box (always open, as a shopping app), the wishlist and the cart. */
export function PhoneTopBar({ home, text, setText, search, openPanel, staff }: {
  home: string; text: string; setText: (t: string) => void; search: (e: FormEvent) => void; openPanel: (p: Panel) => void; staff: boolean;
}) {
  const shop = useShop();
  const icon = 'relative grid size-10 shrink-0 place-items-center rounded-full text-slate-800 active:bg-slate-100';
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/95 backdrop-blur-md md:hidden">
      <div className="flex items-center gap-1.5 px-3 py-2">
        <Link to={home} className="shrink-0 pr-1" aria-label="Virtus Garments home"><img src="/virtus-logo.png" alt="Virtus" className="h-8 w-auto" /></Link>
        <form onSubmit={search} role="search" className="relative min-w-0 flex-1">
          <Icon d={PATH.search} className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-slate-400" />
          {/* 16px text, so a phone does not zoom in when it is tapped. */}
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search garments…" aria-label="Search garments" enterKeyHint="search"
            className="w-full rounded-full bg-slate-100 py-2 pl-9 pr-3 text-base outline-none ring-indigo-500 placeholder:text-slate-400 focus:bg-white focus:ring-2" />
        </form>
        <button type="button" onClick={() => openPanel('wishlist')} className={icon} aria-label={`Wishlist, ${shop.wishlist.length} saved`}>
          <Icon d={PATH.heart} />{badge(shop.wishlist.length, 'bg-rose-600')}
        </button>
        <button type="button" onClick={() => openPanel('cart')} className={icon} aria-label={`Cart, ${shop.cartCount} pieces`}>
          <Icon d={PATH.bag} />{badge(shop.cartCount, 'bg-indigo-600')}
        </button>
        {staff && <Link to="/" className="shrink-0 rounded-full bg-slate-900 px-3 py-2 text-xs font-bold text-white">ERP</Link>}
      </div>
    </header>
  );
}

/** The tab bar along the bottom of the phone: the website's pages, and "More" for the rest. */
export function PhoneTabBar({ path, home, openMore }: { path: string; home: string; openMore: () => void }) {
  const orders = rememberedOrders().length > 0 ? '/orders' : '/track';
  const tabs: [string, string, string, boolean][] = [
    [home, 'Shop', PATH.shop, path === '/' || path === '/shop'],
    ['/services', 'Services', PATH.needle, path === '/services'],
    [orders, 'Orders', PATH.box, path === '/orders' || path === '/track' || path.startsWith('/order/') || path === '/checkout'],
    ['/support', 'Help', PATH.chat, path === '/support'],
  ];
  const tab = (on: boolean) => `flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px] font-semibold ${on ? 'text-indigo-700' : 'text-slate-500 active:text-slate-900'}`;
  return (
    <nav aria-label="Website" className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
      <div className="flex">
        {tabs.map(([to, label, d, on]) => (
          <Link key={label} to={to} aria-current={on ? 'page' : undefined} className={tab(on)}>
            <Icon d={d} className={`size-6 ${on ? 'stroke-[2.2]' : ''}`} />{label}
          </Link>
        ))}
        <button type="button" onClick={openMore} className={tab(path === '/about' || path === '/terms')} aria-haspopup="dialog"><Icon d={PATH.more} />More</button>
      </div>
    </nav>
  );
}

/** Everything the computer's header and footer hold that the tab bar does not: one sheet, a tap away. */
export function MoreSheet({ onClose, openPanel, staff, counting, setCounting }: {
  onClose: () => void; openPanel: (p: Panel) => void; staff: boolean; counting: 'yes' | 'no' | null; setCounting: (v: 'yes' | 'no') => void;
}) {
  const { wishlist } = useShop();
  const go = (to: string) => () => { onClose(); navigate(to); };
  const row = (d: string, label: ReactNode, act: () => void, note?: string) => (
    <li><button type="button" onClick={act} className="flex w-full items-center gap-3 px-5 py-3.5 text-left active:bg-slate-50">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700"><Icon d={d} className="size-5" /></span>
      <span className="min-w-0 flex-1"><span className="block font-semibold">{label}</span>{note && <span className="block text-sm text-slate-500">{note}</span>}</span>
      <span className="text-slate-300" aria-hidden="true">›</span>
    </button></li>
  );
  const head = (t: string) => <p className="px-5 pb-1 pt-4 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{t}</p>;
  return (
    <Overlay title="More" onClose={onClose}>
      <div className="pb-6">
        {head('Shop')}
        <ul className="divide-y divide-slate-100">
          {row(PATH.heart, `Wishlist${wishlist.length ? ` (${wishlist.length})` : ''}`, () => openPanel('wishlist'), 'The garments you saved with the heart')}
          {row(PATH.ruler, 'Size guide', () => openPanel('sizes'), 'Body measurements in inches or cm')}
          {rememberedOrders().length > 0 && row(PATH.box, 'My orders', go('/orders'), 'Orders placed from this phone')}
          {row(PATH.pin, 'Track an order', go('/track'), 'By its order or job order number')}
          {row(PATH.quote, 'Get a quotation', go('/support?type=quotation'), 'Send your list and design; a free design proof')}
        </ul>
        {head('Company')}
        <ul className="divide-y divide-slate-100">
          {row(PATH.needle, 'Our services', go('/services'))}
          {row(PATH.info, 'About us', go('/about'))}
          {row(PATH.chat, 'Customer support', go('/support'))}
          {row(PATH.doc, 'Terms and conditions', go('/terms'))}
        </ul>
        {head('Talk to us')}
        <ul className="divide-y divide-slate-100">
          <li><a href={`tel:${SHOP_CONTACT.phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-3 px-5 py-3.5 active:bg-slate-50"><span className="grid size-9 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Icon d={PATH.phone} className="size-5" /></span><span className="font-semibold">{SHOP_CONTACT.phone}</span></a></li>
          <li><a href={`mailto:${SHOP_CONTACT.email}`} className="flex items-center gap-3 px-5 py-3.5 active:bg-slate-50"><span className="grid size-9 place-items-center rounded-full bg-indigo-50 text-indigo-700"><Icon d={PATH.mail} className="size-5" /></span><span className="min-w-0 break-all font-semibold">{SHOP_CONTACT.email}</span></a></li>
          <li className="flex items-center gap-3 px-5 py-3.5"><span className="grid size-9 place-items-center rounded-full bg-slate-100 text-slate-700"><Icon d={PATH.clock} className="size-5" /></span><span className="text-slate-700">{SHOP_CONTACT.hours}</span></li>
        </ul>
        <ul className="mt-2 divide-y divide-slate-100 border-t border-slate-100">
          {row(PATH.key, staff ? 'Back to the ERP' : 'Staff sign in', go(staff ? '/' : '/sign-in'))}
          {!staff && !browserSaysNo() && row(PATH.eye, counting === 'no' ? 'Count my visits' : "Don't count me", () => setCounting(counting === 'no' ? 'yes' : 'no'),
            `Visit counting is ${counting === 'no' ? 'off' : 'on'} (no names kept)`)}
        </ul>
        <p className="px-5 pt-4 text-xs leading-relaxed text-slate-500">© Virtus Garments · Ready-stock prices are final and include VAT; made-to-order prices are confirmed on your quotation.</p>
      </div>
    </Overlay>
  );
}

/** The round shortcuts under the phone's banner, as a shopping app's: each one only when the shop has it. */
export function PhoneShortcuts({ products, toShop, showSale, openPanel }: {
  products: readonly Product[]; toShop: (kind: 'ready' | 'made') => void; showSale: () => void; openPanel: (p: Panel) => void;
}) {
  const sale = products.filter((p) => percentOff(p) > 0 && !isSoldOut(p)).length;
  const items: [string, string, string, () => void][] = [
    ...(products.some((p) => !p.madeToOrder) ? [['Ready stock', PATH.shirt, 'bg-emerald-500', () => toShop('ready')] as [string, string, string, () => void]] : []),
    ...(products.some((p) => p.madeToOrder) ? [['Made to order', PATH.pencil, 'bg-amber-500', () => toShop('made')] as [string, string, string, () => void]] : []),
    ...(sale ? [[`Sale (${sale})`, PATH.tag, 'bg-rose-500', showSale] as [string, string, string, () => void]] : []),
    ['Get a quote', PATH.quote, 'bg-indigo-600', () => navigate('/support?type=quotation')],
    ['Track order', PATH.pin, 'bg-sky-500', () => navigate('/track')],
    ['Size guide', PATH.ruler, 'bg-violet-500', () => openPanel('sizes')],
    ['Services', PATH.needle, 'bg-slate-800', () => navigate('/services')],
  ];
  return (
    <section aria-label="Shortcuts" className="md:hidden" data-no-reveal>
      <ul className="flex gap-1 overflow-x-auto px-2 pb-1 pt-4 [scrollbar-width:none]">
        {items.map(([label, d, tone, act]) => (
          <li key={label} className="w-[19%] min-w-[4.25rem] shrink-0">
            <button type="button" onClick={act} className="flex w-full flex-col items-center gap-1.5 rounded-2xl py-1 active:bg-slate-100">
              <span className={`grid size-12 place-items-center rounded-2xl text-white shadow-sm ${tone}`}><Icon d={d} /></span>
              <span className="text-center text-[11px] font-semibold leading-tight text-slate-700">{label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
