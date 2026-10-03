/** The public website shown before sign-in: the store, the services and the support page under one header. */
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from '../router.tsx';
import { About } from './About.tsx';
import { CartDrawer, QuickView, SizeGuide, WishlistDrawer } from './Panels.tsx';
import { Services } from './Services.tsx';
import { Store } from './Storefront.tsx';
import { Support } from './Support.tsx';
import { SHOP_CONTACT, type Product } from './products.ts';
import { ShopProvider, useShop } from './store.tsx';

/** The addresses this site answers before sign-in; every other one asks staff to sign in. */
export const SITE_PATHS = ['/', '/services', '/about', '/support'];
export type Panel = 'cart' | 'wishlist' | 'sizes' | null;
export interface SiteControls { openPanel: (p: Panel) => void; view: (p: Product) => void; toast: (text: string) => void }

const NAV: [string, string][] = [['/', 'Shop'], ['/services', 'Services'], ['/about', 'About us'], ['/support', 'Support']];

function Layout() {
  const shop = useShop();
  const [path = '/', query = ''] = useLocation().split('?');
  const [panel, setPanel] = useState<Panel>(null);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [toast, setToast] = useState('');
  const showToast = (text: string) => { setToast(text); setTimeout(() => setToast((t) => (t === text ? '' : t)), 2500); };
  const controls: SiteControls = { openPanel: setPanel, view: setViewing, toast: showToast };
  const page: ReactNode = path === '/services' ? <Services /> : path === '/about' ? <About /> : path === '/support' ? <Support key={query} query={query} /> : <Store {...controls} />;
  const icon = 'relative grid size-10 place-items-center rounded-full hover:bg-slate-100';

  return (
    <div className="min-h-screen bg-[#fafaf8] text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3 sm:flex-nowrap sm:gap-5 sm:px-6">
          <Link to="/" className="flex shrink-0 items-center" aria-label="Virtus Garments home"><img src="/virtus-logo.png" alt="Virtus" className="h-9 w-auto" /></Link>
          {/* On a phone the links get a row of their own under the logo. */}
          <nav className="order-last -mx-1 flex w-full items-center gap-0.5 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto sm:gap-1" aria-label="Website">
            {NAV.map(([to, label]) => <Link key={to} to={to} aria-current={path === to ? 'page' : undefined}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold sm:px-3.5 ${path === to ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>{label}</Link>)}
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <button type="button" onClick={() => setPanel('wishlist')} className={icon} aria-label={`Wishlist, ${shop.wishlist.length} saved`}>
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true"><path d="M12 20s-7-4.4-9.2-8.6C1.2 8.2 3.2 4.5 6.8 4.5c2 0 3.4 1.1 4.2 2.4h2c.8-1.3 2.2-2.4 4.2-2.4 3.6 0 5.6 3.7 4 6.9C19 15.6 12 20 12 20Z" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
              {shop.wishlist.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full bg-rose-600 text-[10px] font-bold text-white">{shop.wishlist.length}</span>}
            </button>
            <button type="button" onClick={() => setPanel('cart')} className={icon} aria-label={`Cart, ${shop.cartCount} pieces`}>
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true"><path d="M5 7h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 7Zm3 0a4 4 0 0 1 8 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
              {shop.cartCount > 0 && <span className="absolute -right-1 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white">{shop.cartCount > 99 ? '99+' : shop.cartCount}</span>}
            </button>
            <Link to="/sign-in" className="ml-1 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold hover:border-slate-900">Staff sign in</Link>
          </div>
        </div>
      </header>

      <main>{page}</main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 text-sm text-slate-600 sm:grid-cols-3 sm:px-6">
          <div><img src="/virtus-logo.png" alt="Virtus" className="h-9 w-auto" /><p className="mt-3">Team wear, uniforms and custom garments, made to order.</p></div>
          <div className="space-y-1.5"><p className="font-bold text-slate-900">Visit the site</p>{NAV.map(([to, label]) => <p key={to}><Link to={to} className="hover:text-slate-900">{label}</Link></p>)}<p><Link to="/sign-in" className="hover:text-slate-900">Staff sign in</Link></p></div>
          <div className="space-y-1.5"><p className="font-bold text-slate-900">Talk to us</p><p>{SHOP_CONTACT.email}</p><p>{SHOP_CONTACT.phone}</p><p>{SHOP_CONTACT.hours}</p></div>
        </div>
        <p className="border-t border-slate-100 py-5 text-center text-xs text-slate-500">© Virtus Garments · Prices shown are starting prices; your quotation is final.</p>
      </footer>

      {viewing && <QuickView key={viewing.id} product={viewing} onClose={() => setViewing(null)} onSizeGuide={() => setPanel('sizes')}
        onAdded={() => { setViewing(null); showToast(`Added ${viewing.name} to your cart`); }} />}
      {panel === 'sizes' && <SizeGuide onClose={() => setPanel(null)} />}
      {panel === 'cart' && <CartDrawer onClose={() => setPanel(null)} />}
      {panel === 'wishlist' && <WishlistDrawer onClose={() => setPanel(null)} onOpen={(p) => { setPanel(null); setViewing(p); }} />}
      {toast && <div role="status" className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xl">{toast} · <button type="button" className="underline" onClick={() => { setToast(''); setPanel('cart'); }}>View cart</button></div>}
    </div>
  );
}

export function Site() {
  return <ShopProvider><Layout /></ShopProvider>;
}
