import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { HomePage } from './pages/HomePage';
import { JobProgressPage } from './pages/JobProgressPage';
import { DownloadPage } from './pages/DownloadPage';
import { RecentConversionsPage } from './pages/RecentConversionsPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/builds/:buildId" element={<JobProgressPage />} />
          <Route path="/builds/:buildId/download" element={<DownloadPage />} />
          <Route path="/recent" element={<RecentConversionsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
};

export default App;
