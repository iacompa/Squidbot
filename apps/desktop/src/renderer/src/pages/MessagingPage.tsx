import { MessagingSection } from "../components/MessagingSection";

export function MessagingPage() {
  return (
    <main className="page-panel eval-page">
      <header className="page-header">
        <div>
          <p className="section-label">Messaging Gateway</p>
          <h2>Channels</h2>
        </div>
      </header>
      <MessagingSection />
    </main>
  );
}
