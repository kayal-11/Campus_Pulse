import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';

function MainLayout({ activePage, onNavigate, children }) {
  return (
    <div className="app-shell">
      <Sidebar activeItem={activePage} onSelect={onNavigate} />
      <main className="content-area">
        <Navbar title={activePage} />
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}

export default MainLayout;
