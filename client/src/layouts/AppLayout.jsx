import { Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Navbar from '../components/layout/Navbar.jsx';
import Footer from '../components/layout/Footer.jsx';
import BackgroundShapes from '../components/layout/BackgroundShapes.jsx';
import RefreshToast from '../components/ui/Toast.jsx';

export default function AppLayout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="relative flex min-h-screen flex-col">
      <BackgroundShapes />
      <Navbar />
      <main className="relative z-10 mx-auto w-full overflow-x-clip max-w-page flex-1 px-4 pb-6 pt-8 sm:px-6 md:pt-10">
        <Outlet />
      </main>
      <Footer />
      <RefreshToast />
    </div>
  );
}
