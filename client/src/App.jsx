import { Route, Routes } from 'react-router-dom';
import AppLayout from './layouts/AppLayout.jsx';
import HomePage from './pages/HomePage.jsx';
import ExplorePage from './pages/ExplorePage.jsx';
import ClaimPage from './pages/ClaimPage.jsx';
import SourcesPage from './pages/SourcesPage.jsx';
import LiveFeedPage from './pages/LiveFeedPage.jsx';
import DatabaseLabPage from './pages/DatabaseLabPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="dashboard" element={<HomePage />} />
        <Route path="explore" element={<ExplorePage />} />
        <Route path="claims/:id" element={<ClaimPage />} />
        <Route path="sources" element={<SourcesPage />} />
        <Route path="live" element={<LiveFeedPage />} />
        <Route path="lab" element={<DatabaseLabPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
