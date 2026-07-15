import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';

function MainLayout({ activePage, onNavigate, children, adminSearchQuery = '', onAdminSearchChange }) {
  return (
    <div className="app-shell">
      <Sidebar activeItem={activePage} onSelect={onNavigate} />
      <main className="content-area">
        <Navbar title={activePage} searchValue={adminSearchQuery} onSearchChange={onAdminSearchChange} />
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}

export default MainLayout;
