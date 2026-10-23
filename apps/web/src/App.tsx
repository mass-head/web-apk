import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { HomePage } from './pages/HomePage';
import { JobProgressPage } from './pages/JobProgressPage';
import { DownloadPage } from './pages/DownloadPage';
import { MobileDownloadPage } from './pages/MobileDownloadPage';
import { RecentConversionsPage } from './pages/RecentConversionsPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* Dedicated clean mobile download pages (minimalist for QR code scans on phones) */}
        <Route path="/d/:buildId" element={<MobileDownloadPage />} />
        <Route path="/download/:buildId" element={<MobileDownloadPage />} />

        {/* Standard dashboard layout */}
        <Route
          path="/*"
          element={
            <Layout>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/builds/:buildId" element={<JobProgressPage />} />
                <Route path="/builds/:buildId/download" element={<DownloadPage />} />
                <Route path="/recent" element={<RecentConversionsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          }
        />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
